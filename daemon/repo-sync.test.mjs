// Proves the deposit sync moves the right bytes, and only once.
//
// WHY A STUB AND NOT THE REAL ARCHIVE. The alternative way to find out
// whether this works is depositing into somebody's real repository, which is
// not a test -- it is a side effect on a researcher's own data that a
// withdrawal record then has to explain. So the stub speaks the Archive API's
// contract exactly (GET /files returns hashes, POST /files takes bytes) and
// repo-sync points at it through PSYNTIENT_ARCHIVE_URL.
//
// WHAT IS ACTUALLY WORTH ASSERTING HERE is not that the function returns a
// shape. It is that the BYTES ARRIVE INTACT -- streaming a file body out of
// Node's fetch has sharp edges (duplex, content-length, a ReadStream that must
// not be buffered) and every one of them fails by delivering a truncated or
// empty body while the call still reports 201. So the stub digests what it
// received and the test compares it with the file on disk.
//
// Run: node --test daemon/repo-sync.test.mjs  (or `npm test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** A stub Archive API. Records what actually arrived, byte for byte. */
async function startStub() {
  const held = [];
  const received = [];
  let failNext = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname.endsWith("/files")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ count: held.length, files: held }));
    }
    if (req.method === "POST" && url.pathname.endsWith("/files")) {
      const name = url.searchParams.get("filename");
      const declared = Number(req.headers["content-length"] || 0);
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (failNext) {
          failNext = false;
          res.writeHead(500, { "content-type": "application/json" });
          return res.end(JSON.stringify({ detail: "stub refused this one" }));
        }
        const body = Buffer.concat(chunks);
        received.push({ name, declared, bytes: body.length, sha: sha(body) });
        held.push({
          object_id: `obj${held.length}`,
          filename: name,
          sha256: sha(body),
          bytes: body.length,
        });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ object_id: `obj${held.length - 1}` }));
      });
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    held,
    received,
    refuseNext: () => {
      failNext = true;
    },
    close: () => server.close(),
  };
}

/** Real files on disk, handed to the sync through its `files` seam. */
function makeFiles(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repo-sync-"));
  return Object.entries(spec).map(([name, body]) => {
    const full = path.join(dir, name);
    fs.writeFileSync(full, body);
    return { area: "sessions", filename: name, path: full, bytes: body.length };
  });
}

async function loadSync(stubUrl) {
  process.env.PSYNTIENT_ARCHIVE_URL = stubUrl;
  // Fresh module per test: ARCHIVE_BASE_URL is read at module scope, so a
  // cached copy would keep the first test's stub URL for every later one.
  return import(`./repo-sync.mjs?t=${Date.now()}${Math.random()}`);
}

// authHeaders() reads the real node key, and there is deliberately no way to
// fake one: a test that could mint a credential is a test that teaches the
// code to accept a minted credential. So these skip on an unpaired machine
// and say so, rather than passing vacuously.
const { readNodeKey } = await import("./pairing.mjs");
const unpaired = readNodeKey()?.node_token ? false : "needs a paired Node";

test("the bytes that arrive are the bytes on disk", { skip: unpaired }, async (t) => {
  const stub = await startStub();
  t.after(() => stub.close());
  // Past a single chunk on purpose: streaming a file body out of Node's fetch
  // fails by delivering a truncated or empty body while still returning 201,
  // so a payload that fits in one chunk would prove nothing.
  const big = Buffer.alloc(300 * 1024, 7);
  const files = makeFiles({ "rec.edf": big, "notes.csv": Buffer.from("a,b\n1,2\n") });
  const rs = await loadSync(stub.url);

  const out = await rs.syncProjectToRepo("proj", { force: true, files });
  assert.deepEqual(out.failed, []);
  assert.equal(out.uploaded.length, 2);

  const arrived = stub.received.find((r) => r.name === "rec.edf");
  assert.equal(arrived.bytes, big.length, "a truncated body still returns 201");
  assert.equal(arrived.sha, sha(big), "the digest must match the file on disk");
  assert.equal(arrived.declared, big.length, "content-length must be honest");
});

test("a second run moves nothing", { skip: unpaired }, async (t) => {
  const stub = await startStub();
  t.after(() => stub.close());
  const files = makeFiles({ "rec.edf": Buffer.from("xyz") });
  const rs = await loadSync(stub.url);

  await rs.syncProjectToRepo("proj", { force: true, files });
  const second = await rs.syncProjectToRepo("proj", { force: true, files });
  assert.deepEqual(second.uploaded, []);
  assert.deepEqual(second.skipped, ["rec.edf"]);
  assert.equal(stub.received.length, 1, "the bytes must not travel twice");
});

test("the same bytes under another name are still sent", { skip: unpaired }, async (t) => {
  // The Repo keys deposits on name AND digest, so the Node must not decide on
  // content alone either -- the two have to agree about what a duplicate is.
  const stub = await startStub();
  t.after(() => stub.close());
  const files = makeFiles({ "a.edf": Buffer.from("same"), "b.edf": Buffer.from("same") });
  const rs = await loadSync(stub.url);

  const out = await rs.syncProjectToRepo("proj", { force: true, files });
  assert.equal(out.uploaded.length, 2, "identical bytes under two names are two deposits");
});

test("one refused file does not stop the rest", { skip: unpaired }, async (t) => {
  // A deposit of two hundred recordings where one is refused must still
  // deliver the other hundred and ninety-nine, and must say which one failed
  // rather than reporting a clean run.
  const stub = await startStub();
  t.after(() => stub.close());
  const files = makeFiles({ "a.edf": Buffer.from("aaa"), "b.edf": Buffer.from("bbb") });
  const rs = await loadSync(stub.url);

  stub.refuseNext();
  const out = await rs.syncProjectToRepo("proj", { force: true, files });
  assert.equal(out.uploaded.length, 1);
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].filename, "a.edf");
  assert.match(out.failed[0].error, /stub refused/);
});

test("an unreadable file is reported, not fatal", { skip: unpaired }, async (t) => {
  const stub = await startStub();
  t.after(() => stub.close());
  const files = makeFiles({ "good.edf": Buffer.from("ok") });
  files.push({ area: "sessions", filename: "gone.edf",
               path: path.join(path.dirname(files[0].path), "not-there.edf"), bytes: 9 });
  const rs = await loadSync(stub.url);

  const out = await rs.syncProjectToRepo("proj", { force: true, files });
  assert.deepEqual(out.uploaded, ["good.edf"]);
  assert.equal(out.failed[0].filename, "gone.edf");
  assert.match(out.failed[0].error, /unreadable/);
});

test("deposit is off unless the project opted in", async (t) => {
  // Not a preference check: this is what stops a watched folder being pushed
  // into shared storage as a side effect of turning on auto-import. No skip --
  // it must hold on an unpaired machine too, and it never reaches the network.
  const stub = await startStub();
  t.after(() => stub.close());
  const rs = await loadSync(stub.url);

  const out = await rs.syncProjectToRepo("a-project-that-has-not-opted-in");
  assert.equal(out.enabled, false);
  assert.deepEqual(out.uploaded, []);
  assert.equal(stub.received.length, 0, "nothing may leave without opting in");
});
