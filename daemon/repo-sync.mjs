// Depositing a project's Vault files into the Psyntient Repo.
//
// THE MISSING LINK IN A CHAIN THAT WAS OTHERWISE COMPLETE. A researcher can
// already point a project at a folder on their own machine (project-watch.mjs)
// and everything that lands there is imported into the Vault. And a project's
// staged packets already reach the Archive's ingestion queue
// (archive-sync.mjs). What had no path at all was the raw files themselves
// reaching the Repo -- the recordings a deposit actually consists of. So the
// folder filled up, the Vault filled up, and the deposit page stayed empty
// unless somebody uploaded each file by hand through a browser.
//
// THIS IS NOT THE PACKET PIPELINE AND MUST NOT BE CONFUSED WITH IT.
// archive-sync.mjs submits observation packets for the Archive's curated
// editions -- reviewed, triaged, possibly rejected. This deposits raw files
// into the researcher's own project in the Repo, which is storage they own,
// not a submission anyone judges. A file deposited here is not "in the
// Archive"; it is in their repository, and publishing it is a separate,
// deliberate act on the Repo's own pages.
//
// WHY IT GOES THROUGH THE ARCHIVE API AND NOT STRAIGHT TO THE REPO. A Node
// holds a credential for psyntient.io, not for the Repo, and a header it set
// naming an account would be an assertion by the caller rather than by the
// shim. The Archive API already verifies node tokens and knows which account
// one belongs to, so it asks on the Node's behalf and passes the account it
// VERIFIED. The same reasoning already governs reading projects; this is the
// write half of it.
//
// OFF BY DEFAULT, PER PROJECT. The Repo is where research is deposited and
// eventually published under a licence with a DOI. Pushing a watched folder
// there because a flag was left unset would move a researcher's raw
// recordings into shared storage as a side effect of turning on auto-import,
// which is a different decision and has to be made as one.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { vaultProjectDir, assertSafeId } from "./working-memory.mjs";
import { readNodeKey } from "./pairing.mjs";

// Overridable so the upload path can be exercised against a local stub.
// Streaming a file body out of Node's fetch has enough sharp edges --
// duplex, content-length, a ReadStream that must not be buffered -- that
// "it compiles" is not evidence it works, and the alternative way to find
// out is depositing into somebody's real repository.
const ARCHIVE_BASE_URL =
  process.env.PSYNTIENT_ARCHIVE_URL || "https://archive.psyntient.io/api/v1";
const PROJECT_JSON = ".project.json";
const DEPOSIT_STATE = ".repo-deposit.json";

// Where a deposit's files live. Deliberately not notes/ or analyses/: those
// are AUTHORED material with their own meaning and their own writers, and
// project-import.mjs already refuses to land imported files in them. What a
// deposit consists of is capture volume and the exports made from it.
const DEPOSIT_AREAS = ["sessions", "exports", "images", "Syncable_Data_Files"];

function authHeaders() {
  const key = readNodeKey();
  if (!key?.node_token) {
    throw new Error(
      "This Node is not paired. Pairing is what tells the Repo whose account " +
        "a deposit belongs to, so it is required before anything can be sent.",
    );
  }
  return { authorization: `Bearer ${key.node_token}` };
}

function readProjectJson(projectId) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(vaultProjectDir(projectId), PROJECT_JSON), "utf8"),
    );
  } catch {
    return {};
  }
}

function writeProjectJson(projectId, meta) {
  fs.writeFileSync(
    path.join(vaultProjectDir(projectId), PROJECT_JSON),
    JSON.stringify(meta, null, 2) + "\n",
  );
}

/**
 * Turn Repo deposit on or off for one project.
 *
 * Separate from the watch binding on purpose: "import this folder into my
 * Vault" and "put my Vault files in the repository" are two decisions, and a
 * researcher may well want the first without the second -- working locally
 * for months before depositing anything is the normal shape of research.
 */
export function setRepoSync(projectId, enabled) {
  assertSafeId(projectId);
  const meta = readProjectJson(projectId);
  meta.repoSync = Boolean(enabled);
  writeProjectJson(projectId, meta);
  return { projectId, repoSync: meta.repoSync };
}

export function repoSyncEnabled(projectId) {
  return readProjectJson(projectId).repoSync === true;
}

/**
 * What this Node believes it has already deposited.
 *
 * A CACHE FOR DISPLAY, NEVER THE DECISION. The authoritative answer to "does
 * the Repo have this file" is the Repo's own listing, and syncProjectToRepo
 * always asks it. This exists so the Vault page can say "12 of 14 deposited"
 * without a network call -- opening a project should not depend on another
 * droplet being reachable, and a page that hangs because the Archive is
 * rebooting is worse than one that shows a slightly stale count.
 *
 * Keyed the same way the sync compares -- digest and filename together --
 * because a display that disagreed with the decision would be a second
 * opinion about what has been sent.
 */
export function depositState(projectId) {
  assertSafeId(projectId);
  try {
    const raw = fs.readFileSync(
      path.join(vaultProjectDir(projectId), DEPOSIT_STATE),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    return {
      deposited: parsed.deposited ?? {},
      lastRunAt: parsed.lastRunAt ?? null,
      lastError: parsed.lastError ?? null,
    };
  } catch {
    return { deposited: {}, lastRunAt: null, lastError: null };
  }
}

function writeDepositState(projectId, state) {
  try {
    fs.writeFileSync(
      path.join(vaultProjectDir(projectId), DEPOSIT_STATE),
      JSON.stringify(state, null, 2) + "\n",
    );
  } catch {
    // A display cache that cannot be written is not worth failing a deposit
    // over. The next run recomputes it from the Repo's listing anyway.
  }
}

/**
 * What turning this on would send, right now.
 *
 * THE NUMBER THAT HAS TO BE SHOWN BEFORE THE SWITCH IS FLIPPED. Enabling
 * deposit does not only affect files that arrive later -- it sends everything
 * already in the project. On work that has been accumulating for months that
 * can be many gigabytes leaving for shared storage because a box was ticked,
 * and "I didn't know it would do that" is not a complaint anyone should have
 * to make. Local only, so the confirmation never waits on a network call.
 */
export function pendingDeposit(projectId) {
  const { deposited } = depositState(projectId);
  let files = 0;
  let bytes = 0;
  let total = 0;
  let totalBytes = 0;
  for (const f of depositableFiles(projectId)) {
    total += 1;
    totalBytes += f.bytes;
    // Matched on name alone here, deliberately: hashing every recording to
    // render a page would read tens of gigabytes off disk to draw a number.
    // The sync itself still hashes and still decides.
    const already = Object.values(deposited).some((d) => d.filename === f.filename);
    if (!already) {
      files += 1;
      bytes += f.bytes;
    }
  }
  return { pending: files, pendingBytes: bytes, total, totalBytes };
}

/** Every depositable file in a project's Vault directory, with its digest. */
export function depositableFiles(projectId) {
  assertSafeId(projectId);
  const root = vaultProjectDir(projectId);
  const out = [];
  for (const area of DEPOSIT_AREAS) {
    const dir = path.join(root, area);
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of names) {
      // One level deep, matching how project-import.mjs lands files. A
      // recursive walk would also pick up whatever a researcher's own tooling
      // nested in there, which is theirs and not part of the deposit.
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({ area, filename: entry.name, path: full, bytes: stat.size });
    }
  }
  return out;
}

/** sha256 of a file, streamed -- these are recordings, not documents. */
export function digest(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/** What the Repo already holds for this project. Hashes, never bytes. */
export async function remoteFiles(projectId) {
  const res = await fetch(
    `${ARCHIVE_BASE_URL}/projects/${encodeURIComponent(projectId)}/files`,
    { headers: authHeaders(), signal: AbortSignal.timeout(30000) },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.detail || `HTTP ${res.status}`);
  }
  return body.files ?? [];
}

async function uploadOne(projectId, file) {
  const res = await fetch(
    `${ARCHIVE_BASE_URL}/projects/${encodeURIComponent(projectId)}/files` +
      `?filename=${encodeURIComponent(file.filename)}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "content-type": "application/octet-stream",
        "content-length": String(file.bytes),
      },
      // A stream, so a 40 GB recording is never held in this process's memory.
      body: fs.createReadStream(file.path),
      duplex: "half",
      // No timeout. A large recording over a domestic uplink legitimately
      // takes hours, and a timeout here would abort transfers that were
      // succeeding -- the failure this has to survive is a slow link, not a
      // hung one, and a hung one surfaces as a socket error anyway.
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.detail || `HTTP ${res.status}` };
  }
  return { ok: true, objectId: body.object_id ?? null };
}

/**
 * Deposit whatever this project has that the Repo does not.
 *
 * RESUMABLE AND IDEMPOTENT, because it will be interrupted -- this moves
 * recordings over a domestic uplink and the first version of anything like
 * this always assumes one clean run. The comparison is by sha256 rather than
 * by filename: two instruments both write subject01.edf, and a researcher
 * renaming a file has not created a new recording. A file already at the far
 * end with a matching digest is skipped without reading its bytes.
 *
 * Never throws for one bad file. A single unreadable recording must not stop
 * the other two hundred, so failures are collected and reported.
 */
export async function syncProjectToRepo(
  projectId,
  { force = false, files = null } = {},
) {
  assertSafeId(projectId);
  if (!force && !repoSyncEnabled(projectId)) {
    return { projectId, enabled: false, uploaded: [], skipped: [], failed: [] };
  }
  // Gather, then decide, then act. `files` exists so the diff-and-upload half
  // can be exercised without a Vault on disk -- what is worth testing here is
  // that the right bytes move exactly once, and tying that to a real Vault
  // root would mean the only way to test it is to have one.
  const local = files ?? depositableFiles(projectId);

  let remote;
  try {
    remote = await remoteFiles(projectId);
  } catch (err) {
    const message = `could not read what the Repo already holds: ${err.message}`;
    const state = depositState(projectId);
    writeDepositState(projectId, { ...state, lastRunAt: new Date().toISOString(),
                                   lastError: message });
    return {
      projectId,
      enabled: true,
      error: message,
      uploaded: [],
      skipped: [],
      failed: [],
    };
  }
  // KEYED ON NAME AND DIGEST, matching what the Repo treats as a duplicate.
  // Digest alone was written first and is wrong in the same way it was wrong
  // there: identical bytes under two names is an ordinary shape -- headers,
  // placeholders, a template exported per subject -- and skipping the second
  // would leave a file the researcher deposited sitting on their disk forever,
  // with a sync that reported success. The two sides have to agree about what
  // a duplicate is, or one of them silently drops work.
  const key = (sha, filename) => `${sha}\u0000${filename}`;
  const have = new Set(
    remote.filter((r) => r.sha256).map((r) => key(r.sha256, r.filename)),
  );

  const uploaded = [];
  const skipped = [];
  const failed = [];
  // Rebuilt from the Repo's own listing rather than merged into the old file:
  // the remote is the truth, and a cache that only ever grew would keep
  // claiming a withdrawn file was still deposited.
  const deposited = {};
  for (const r of remote) {
    if (r.sha256) {
      deposited[key(r.sha256, r.filename)] = {
        filename: r.filename, bytes: r.bytes, at: null,
      };
    }
  }
  for (const file of local) {
    let sha;
    try {
      sha = await digest(file.path);
    } catch (err) {
      failed.push({ filename: file.filename, error: `unreadable: ${err.message}` });
      continue;
    }
    if (have.has(key(sha, file.filename))) {
      skipped.push(file.filename);
      continue;
    }
    let result;
    try {
      result = await uploadOne(projectId, file);
    } catch (err) {
      failed.push({ filename: file.filename, error: err.message });
      continue;
    }
    if (result.ok) {
      uploaded.push(file.filename);
      // Added to the local view immediately: two areas can legitimately hold
      // the same file, and without this the second copy would be uploaded
      // again in the same pass.
      have.add(key(sha, file.filename));
      deposited[key(sha, file.filename)] = {
        filename: file.filename, bytes: file.bytes,
        at: new Date().toISOString(),
      };
    } else {
      failed.push({ filename: file.filename, error: result.error });
    }
  }
  writeDepositState(projectId, {
    deposited,
    lastRunAt: new Date().toISOString(),
    lastError: failed.length ? `${failed.length} file(s) failed` : null,
  });
  return { projectId, enabled: true, uploaded, skipped, failed };
}

/** Every project with Repo deposit turned on. */
export async function syncAllProjectsToRepo(listProjects) {
  const results = [];
  for (const project of listProjects()) {
    if (!repoSyncEnabled(project.projectId)) continue;
    try {
      results.push(await syncProjectToRepo(project.projectId));
    } catch (err) {
      results.push({
        projectId: project.projectId,
        enabled: true,
        error: err.message,
        uploaded: [],
        skipped: [],
        failed: [],
      });
    }
  }
  return results;
}
