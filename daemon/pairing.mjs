// Psyntient.io device pairing. Implements Plane B of daemon/docs/AUTH_FLOW.md
// (v1.0, "source of truth" — read that file for the full protocol) plus
// daemon/docs/MIGRATION_GUIDE.md's additions on top of it (404 added to
// the treat-as-revoked bucket, success page redirects to the Interface).
// This is an implementation of those specs, not a second one.
//
// Filename resolution, settled by AUTH_FLOW.md section 7: the canonical
// pairing file is ~/.psyntient/node.key (node_token/node_id/context_id/
// base_url/paired_at). The node_key/node_token/config.json files found on
// this machine earlier belong to AUTH_FLOW.md's explicitly deprecated
// install-code/device-code model ("remain live only for machines paired
// before the /link-node flow") — left untouched (they're not debris, just
// superseded), but no longer treated as pairing state.
//
// Continuous ~5-minute heartbeat loop: built separately, see
// daemon/heartbeat-loop.mjs + daemon/heartbeat-control.mjs. This module
// only exposes the single heartbeat() call the loop uses.
//
// NOT implemented here (real, scoped gap, not an oversight): Plane C
// (Interface <-> daemon local session, AUTH_FLOW.md section 4:
// /pair-interface, noetic_session cookie). Separate concern from Node
// pairing (this file) — the spec itself notes an already-paired Node
// does not need this to keep chatting. Deferred as its own follow-up.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openInBrowser } from "./open-browser.mjs";
import { deviceName } from "./device-name.mjs";

const PSYNTIENT_DIR = path.join(os.homedir(), ".psyntient");
const NODE_KEY_PATH = path.join(PSYNTIENT_DIR, "node.key");
const BASE_URL = (process.env.PSYNTIENT_BASE_URL || "https://psyntient.io").trim();
const CALLBACK_PORT = 47123;

export function isPaired() {
  const key = readNodeKey();
  return Boolean(key?.node_token && key?.node_id && key?.context_id);
}

export function readNodeKey() {
  try {
    return JSON.parse(fs.readFileSync(NODE_KEY_PATH, "utf8"));
  } catch {
    return null;
  }
}

function writeNodeKey(data) {
  fs.mkdirSync(PSYNTIENT_DIR, { recursive: true });
  fs.writeFileSync(NODE_KEY_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

function unpair(reason) {
  try {
    fs.unlinkSync(NODE_KEY_PATH);
  } catch {
    // already gone
  }
  console.log(`Node unpaired: ${reason}`);
}

// AUTH_FLOW.md 2.4 point 3 / MIGRATION_GUIDE.md section 2.6 originally
// called for the success page to redirect to the local Interface — the
// right call when pairing could be triggered without anything else
// waiting on it (the old non-blocking pairIfNeeded() flow that used to
// call this). Now that pairing only ever happens from inside the
// onboarding wizard's own tab (which is already awaiting this exact
// pairStart() call and advances itself the moment it resolves), that
// redirect just opens a confusing second copy of the Interface in this
// browser-opened tab. Closes itself instead when possible (works when
// the browser actually let a script-initiated tab close itself, which
// isn't guaranteed) and always shows a static "you can close this"
// message as the fallback -- no redirect either way.
function htmlPage(message, { closeSelf = false } = {}) {
  const closeScript = closeSelf
    ? `<script>setTimeout(function(){window.close()},900)</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Psyntient Node</title></head><body style="font-family:system-ui;background:#0C0A1D;color:#FEF4E3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>${message}</p>${closeScript}</body></html>`;
}

// Opens the browser to /link-node and listens on the loopback callback
// port until the user approves/denies or timeoutMs elapses. Per
// AUTH_FLOW.md 2.2-2.4. Called from the onboarding wizard's pairing
// step via the `pair-start` CLI subcommand below, which awaits this
// directly (the wizard's own request just stays open for however long
// the user takes in their browser) — no separate polling/job system.
export function pairStart({ timeoutMs = 5 * 60 * 1000 } = {}) {
  const sessionNonce = crypto.randomBytes(24).toString("base64url");
  const device = deviceName();
  const osInfo = `${process.platform} ${os.release()} ${process.arch}`.slice(0, 120);

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);
      if (url.pathname !== "/pair/return") {
        res.writeHead(404).end();
        return;
      }
      const params = url.searchParams;

      if (params.get("denied")) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(htmlPage("Pairing cancelled. You can close this tab.", { closeSelf: true }));
        finish(() => resolve({ ok: false, denied: true }));
        return;
      }

      if (params.get("session_nonce") !== sessionNonce) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(htmlPage("Pairing failed: session mismatch. Please try again."));
        finish(() => reject(new Error("session_nonce mismatch on pairing callback")));
        return;
      }

      const node_token = params.get("node_token");
      const node_id = params.get("node_id");
      const context_id = params.get("context_id");
      if (!node_token || !node_id || !context_id) {
        res.writeHead(400, { "content-type": "text/html" });
        res.end(htmlPage("Pairing failed: incomplete response from psyntient.io."));
        finish(() => reject(new Error("incomplete pairing callback params")));
        return;
      }

      writeNodeKey({
        node_token,
        node_id,
        context_id,
        base_url: BASE_URL,
        paired_at: new Date().toISOString(),
      });
      res.writeHead(200, { "content-type": "text/html" });
      res.end(htmlPage("Paired! You can close this tab.", { closeSelf: true }));
      finish(() => resolve({ ok: true, node_id, context_id }));
    });

    function finish(action) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => action());
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Pairing timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    server.listen(CALLBACK_PORT, "127.0.0.1", () => {
      const pairUrl = new URL("/link-node", BASE_URL);
      pairUrl.searchParams.set("callback", `http://127.0.0.1:${CALLBACK_PORT}/pair/return`);
      pairUrl.searchParams.set("session_nonce", sessionNonce);
      pairUrl.searchParams.set("device_name", device);
      pairUrl.searchParams.set("os_info", osInfo);
      if (process.env.PAIRING_DEBUG_LOG_URL) console.log("PAIR_URL:", pairUrl.toString());
      openInBrowser(pairUrl.toString());
    });

    server.on("error", (err) => {
      finish(() => reject(err));
    });
  });
}

// AUTH_FLOW.md 3.1 + Migration Guide section 4's status-code table (the
// migration guide adds 404 "Node record missing" to the same
// treat-as-revoked bucket that AUTH_FLOW.md only listed 401/403 for).
// 401/403/404 all wipe node.key per the spec's non-negotiable rule 5;
// 5xx/network is transient and left as-is for the caller to ignore.
export async function heartbeat() {
  const key = readNodeKey();
  if (!key) return { ok: false, unpaired: true };

  let res;
  try {
    res = await fetch(`${key.base_url || BASE_URL}/api/public/nodes/heartbeat`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key.node_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, transient: true, error: err.message };
  }

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const body = await res.json().catch(() => ({}));
    unpair(`heartbeat returned ${res.status}${body?.error ? ` (${body.error})` : ""}`);
    return { ok: false, unpaired: true, status: res.status };
  }
  if (!res.ok) {
    return { ok: false, transient: true, status: res.status };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, data };
}

export const paths = { PSYNTIENT_DIR, NODE_KEY_PATH };

// CLI fallback — lets the Interface's onboarding wizard shell out to
// this instead of importing daemon code directly (same reasoning as
// vault.mjs/working-memory.mjs). `pair-start` blocks until the user
// approves/denies in their browser or the flow times out (5min
// default) — the caller (an HTTP request the wizard is awaiting) is
// expected to just stay open for that; there's no separate
// start/poll job system.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  try {
    if (cmd === "status") {
      console.log(JSON.stringify({ isPaired: isPaired() }));
    } else if (cmd === "pair-start") {
      const result = await pairStart();
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    } else {
      console.log("Usage: node daemon/pairing.mjs status | pair-start");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
