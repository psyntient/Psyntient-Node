// Recently-browsed archetypes -- local half of the "Recently browsed"
// feature. See daemon/docs/ARCHIVE_VIEWER.md's "Recently browsed" section
// and the brief this was built from for the full design.
//
// WHY ITS OWN FILE, NOT archive-client.mjs's RECORD_CACHE
// RECORD_CACHE is an in-memory, process-local latency cache that is meant to
// disappear -- on Edition change, on TTL, on a gateway restart. History is
// the opposite: a small, durable, on-disk record of what this account has
// actually looked at, and it must survive every one of those. Folding it
// into that cache was the exact trap the brief calls out from the Library's
// own build of this feature.
//
// WHY ~/.psyntient, NOT Cortex/Open-Claw
// Same reason as node.key/providers.json: this is Node state, not installed
// code. The updater only ever replaces the engine tree; it never touches
// psyntientHome(), so a browsing history survives every self-update.
//
// This file is deliberately network-free. Syncing this list to
// archive.psyntient.io needs a node_token -> user_id resolution that does
// not exist yet (LOVABLE-verify-token-user-id.md) -- see the sync note in
// ARCHIVE_VIEWER.md. Recording stays purely local until that lands.
import fs from "node:fs";
import path from "node:path";
import { psyntientHome } from "./psyntient-home.mjs";

const HISTORY_PATH = path.join(psyntientHome(), "archive-history.json");

/** Matches the Library's own cap -- bounded so this cannot grow without
 *  bound on a Node that runs for months. */
const MAX_ENTRIES = 60;

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(state, null, 2) + "\n");
}

/**
 * Record an archetype's own page being opened.
 *
 * Upsert, not append: a revisit moves the entry to the top and increments
 * its count rather than adding a second row for the same id -- the whole
 * point is "what have I been looking at," not "how many times have I ever
 * clicked."
 *
 * Deliberately no expiry here. Retention (30 days) is the server's, once
 * syncing exists -- a local clock disagreeing with the server's would show
 * the reader two different answers to "is this still on my list." Locally
 * this is a plain bounded-size cache; entries only ever leave it by falling
 * off the cap or by an explicit clear.
 */
export function recordView(id) {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return readState();

  const state = readState();
  const now = Date.now();
  const rest = state.entries.filter((e) => e.id !== trimmed);
  const existing = state.entries.find((e) => e.id === trimmed);
  const entry = { id: trimmed, lastSeen: now, views: (existing?.views ?? 0) + 1 };
  const entries = [entry, ...rest].slice(0, MAX_ENTRIES);
  const next = { entries };
  writeState(next);
  return next;
}

/** Newest first, same order recordView() maintains. */
export function listHistory() {
  return readState();
}

/** Empties the list. Local-only today -- once syncing exists, the caller
 *  must also tell the Library ({clear: true}), not just wipe this file, or
 *  clearing on one surface would be a lie on the other. */
export function clearHistory() {
  const next = { entries: [] };
  writeState(next);
  return next;
}

export default { recordView, listHistory, clearHistory };

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [, , cmd, ...rest] = process.argv;
  const run = async () => {
    switch (cmd) {
      case "record":
        return recordView(rest[0]);
      case "list":
        return listHistory();
      case "clear":
        return clearHistory();
      default:
        throw new Error("Usage: archive-history.mjs record <id>|list|clear");
    }
  };
  run()
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
