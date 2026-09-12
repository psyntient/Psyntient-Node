// Submitting a project's Syncable_Data_Files/ to the Noetic Archive's real
// Ingestion Queue -- the last step of the chain: import -> compatibility
// check -> stage -> this.
//
// PUBLIC BASE URL, confirmed live: https://archive.psyntient.io/api/v1 --
// Caddy on the Archive droplet proxies /api/v1/* to the FastAPI backend
// (127.0.0.1:8000 there); / itself serves a different app (the Architect's
// own portal), so this must never point at the bare origin. Verified
// directly: GET /api/v1/meta with no token returns 401 (real auth, not the
// open stub an earlier README claimed), and with this Node's own
// node_token it authenticates -- the same token pairing.mjs already holds,
// verified by the Archive calling back to psyntient.io's own
// verify-token endpoint, not by anything this file does itself.
//
// Auth failures here do NOT touch node.key. A rejected submission is not
// evidence this Node's pairing was revoked -- pairing.mjs's own heartbeat
// loop is the one place that decides that, on its own schedule, against
// its own endpoint. Conflating the two would mean a single Archive-side
// hiccup could unpair a Node.
import fs from "node:fs";
import path from "node:path";
import { vaultProjectDir, assertSafeId } from "./working-memory.mjs";
import { readNodeKey } from "./pairing.mjs";
import { psyntientHome } from "./psyntient-home.mjs";

const ARCHIVE_BASE_URL = "https://archive.psyntient.io/api/v1";
const SYNC_LOG_NAME = ".sync-log.json";
const SETTINGS_PATH = path.join(psyntientHome(), "sync.json");

// --- settings ---------------------------------------------------------
// Predates the Syncable_Data_Files staging pipeline below, and still owns a
// real, separate concern: whether a project auto-submits AT ALL, versus the
// staging/compat step's "what is eligible to submit". Kept rather than
// folded in, so a global off switch still means off regardless of what
// packet-compat.mjs would stage.

/**
 * Node-wide sync preferences. Deliberately Node-local (`~/.psyntient/`), not
 * in the Vault: this is a preference about behaviour, not user research
 * data, and it should not travel to another machine along with a synced
 * Vault.
 */
export function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    return { autoSyncAll: raw.autoSyncAll === true };
  } catch {
    // OFF is the only safe default, and it must survive a missing or corrupt
    // settings file. Contribution is irreversible; defaulting to on -- or
    // failing open on a parse error -- would publish data nobody chose to.
    return { autoSyncAll: false };
  }
}

export function writeSettings({ autoSyncAll }) {
  const next = { autoSyncAll: autoSyncAll === true };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function readProjectMeta(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, ".project.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve whether a project auto-syncs.
 *
 * `autoSync` on the project is tri-state on purpose: `true`/`false` are the
 * user's explicit choice for this project and always win; `null`/absent
 * means inherit the Node-wide default. A global switch that overrode an
 * explicit per-project "no" would be a consent bug rather than a
 * convenience, so inheritance only fills the gap where no choice was made.
 */
export function resolveAutoSync(projectMeta, settings = readSettings()) {
  if (projectMeta?.autoSync === true || projectMeta?.autoSync === false) {
    return projectMeta.autoSync;
  }
  return settings.autoSyncAll === true;
}

/**
 * Set (or clear) a project's explicit auto-sync choice. `null` clears it
 * back to inheriting the Node-wide default -- kept as a real third state
 * rather than collapsing to false, so "I have not decided" stays
 * distinguishable from "I said no".
 */
export function setProjectAutoSync(dir, enabled) {
  const metaPath = path.join(dir, ".project.json");
  const meta = readProjectMeta(dir);
  if (enabled === null || enabled === undefined) {
    delete meta.autoSync;
  } else {
    meta.autoSync = enabled === true;
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  return { projectId: meta.projectId ?? path.basename(dir), autoSync: meta.autoSync ?? null };
}

function authHeaders() {
  const key = readNodeKey();
  if (!key?.node_token) {
    throw new Error("This Node is not paired -- pairing is required before syncing to the Archive.");
  }
  return { authorization: `Bearer ${key.node_token}`, "content-type": "application/json" };
}

/** Read-only: proves the auth chain works (this Node's token verifies
 *  against psyntient.io, via the Archive) without submitting anything. */
export async function checkArchiveConnection() {
  let res;
  try {
    res = await fetch(`${ARCHIVE_BASE_URL}/meta`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, transient: true, error: err.message };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: body?.detail || `HTTP ${res.status}` };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, data };
}

/** Submits ONE packet. Does not touch the filesystem -- callers decide what
 *  to do with the result. */
export async function submitPacket(packet) {
  let res;
  try {
    res = await fetch(`${ARCHIVE_BASE_URL}/ingest/packets`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ packet }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return { ok: false, transient: true, error: err.message };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.detail || `HTTP ${res.status}` };
  }
  return { ok: true, submissionId: body.submission_id };
}

/**
 * Where one submission currently stands.
 *
 * Ingestion is asynchronous: POST /ingest/packets always answers 202 and
 * queues the packet, so a rejection is never visible at submission time --
 * the Architect's triage (ingest_queue.py) reviews the queue on its own
 * schedule and writes a verdict alongside the submission afterward. This is
 * the only place that verdict becomes visible to the Node, so `code` and
 * `message` -- the Architect's own stable, branch-on-this rejection code
 * and its human-readable explanation (CONSENT_MISSING, PROVENANCE_MISSING,
 * HELD_OUT_PACKET, ...) -- are surfaced here rather than silently dropped.
 * `status: "pending"` with no code is a normal, expected result, not a
 * bug: it means triage has not reached this packet yet.
 */
export async function checkSubmissionStatus(submissionId) {
  let res;
  try {
    res = await fetch(`${ARCHIVE_BASE_URL}/ingest/status/${encodeURIComponent(submissionId)}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, transient: true, error: err.message };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: body?.detail || `HTTP ${res.status}` };
  }
  return {
    ok: true,
    status: body.status,
    code: body.code ?? null,
    message: body.message ?? null,
    missingFields: body.missing_fields ?? null,
  };
}

/**
 * Per-packet outcomes for everything a project has ever submitted -- not a
 * bare "N of M accepted" count. During a validation campaign, "38 of 40
 * accepted" with no indication of which two is not usable; this answers
 * "which ones, and why" by polling GET /ingest/status once per
 * previously-submitted packet (from .sync-log.json) and returning each
 * one's current status plus the Architect's code/message when triage has
 * reached it. A "pending" outcome is expected, not an error -- see
 * checkSubmissionStatus's own note on why ingestion is asynchronous.
 */
export async function getSubmissionOutcomes(projectId) {
  assertSafeId(projectId, "projectId");
  const stagingDir = path.join(vaultProjectDir(projectId), "Syncable_Data_Files");
  const log = readSyncLog(stagingDir);
  const outcomes = [];
  for (const [filename, record] of Object.entries(log)) {
    const result = await checkSubmissionStatus(record.submissionId);
    outcomes.push({
      filename,
      submissionId: record.submissionId,
      submittedAt: record.submittedAt,
      ...(result.ok
        ? { status: result.status, code: result.code, message: result.message, missingFields: result.missingFields }
        : { status: "unknown", error: result.error }),
    });
  }
  return { ok: true, projectId, outcomes };
}

function readSyncLog(stagingDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(stagingDir, SYNC_LOG_NAME), "utf8"));
  } catch {
    return {};
  }
}

function writeSyncLog(stagingDir, log) {
  fs.writeFileSync(path.join(stagingDir, SYNC_LOG_NAME), JSON.stringify(log, null, 2) + "\n");
}

/**
 * Submits every file in a project's Syncable_Data_Files/ that has not
 * already been submitted (tracked in .sync-log.json, by filename ->
 * {submissionId, submittedAt}) -- a real submission is not retried just
 * because the folder was rescanned.
 */
export async function syncProjectToArchive(projectId) {
  assertSafeId(projectId, "projectId");
  const stagingDir = path.join(vaultProjectDir(projectId), "Syncable_Data_Files");
  if (!fs.existsSync(stagingDir)) {
    return { ok: true, projectId, submitted: [], errors: [], alreadySubmitted: [] };
  }

  const log = readSyncLog(stagingDir);
  const files = fs
    .readdirSync(stagingDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name !== SYNC_LOG_NAME);

  const submitted = [];
  const errors = [];
  const alreadySubmitted = [];

  for (const entry of files) {
    if (log[entry.name]) {
      alreadySubmitted.push({ filename: entry.name, ...log[entry.name] });
      continue;
    }
    let packet;
    try {
      packet = JSON.parse(fs.readFileSync(path.join(stagingDir, entry.name), "utf8"));
    } catch (err) {
      errors.push({ filename: entry.name, error: `unreadable: ${err.message}` });
      continue;
    }
    const result = await submitPacket(packet);
    if (!result.ok) {
      errors.push({ filename: entry.name, error: result.error });
      continue;
    }
    const record = { submissionId: result.submissionId, submittedAt: new Date().toISOString() };
    log[entry.name] = record;
    submitted.push({ filename: entry.name, ...record });
  }

  writeSyncLog(stagingDir, log);
  return { ok: true, projectId, submitted, errors, alreadySubmitted };
}

// --- CLI ------------------------------------------------------------------
// Mirrors archive-client.mjs/archive-history.mjs: every function reachable
// from the shell, so submission and status-checking are testable against
// the real droplet without a running agent or Interface.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [, , cmd, ...rest] = process.argv;
  const run = async () => {
    switch (cmd) {
      case "check":
        return checkArchiveConnection();
      case "submit": {
        const packet = JSON.parse(fs.readFileSync(rest[0], "utf8"));
        return submitPacket(packet);
      }
      case "status":
        return checkSubmissionStatus(rest[0]);
      case "sync":
        return syncProjectToArchive(rest[0]);
      case "outcomes":
        return getSubmissionOutcomes(rest[0]);
      default:
        throw new Error(
          "Usage: archive-sync.mjs check|submit <packetFile>|status <submissionId>|sync <projectId>|outcomes <projectId>",
        );
    }
  };
  run()
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
