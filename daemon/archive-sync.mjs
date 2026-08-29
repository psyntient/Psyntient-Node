// Contributing a project's packets to the Noetic Archive.
//
// This is the write half of the Archive integration. archive-client.mjs reads;
// this submits. Kept separate because the risk profile is completely
// different: reading is idempotent and private, submitting is irreversible.
// Editions are immutable once published, so a packet contributed by mistake
// cannot be recalled by turning a setting back off.
//
// WHAT IS SUBMITTED, AND ONLY THIS
// Files under a project's `sessions/` that parse as Observation Packets.
// Never notes, never scratch, never logs, never citations, never chat
// transcripts -- those live outside `sessions/` precisely so there is no
// per-item judgement to get wrong here. See ARCHIVE_INTEGRATION.md.
//
// SUBMISSION IS ASYNCHRONOUS AND REVIEWABLE
// POST /api/v1/ingest/packets returns a submission_id with status "pending"
// always. The Architect reviews the queue and can reject with a reason. So
// "synced" here means "queued", never "in the Archive" -- accepted packets
// appear in a *future* Edition. The UI must not conflate those.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archiveBaseUrl, ArchiveError } from "./archive-client.mjs";
import { isArchiveEligible } from "./working-memory.mjs";
import { psyntientHome } from "./psyntient-home.mjs";

const NODE_KEY_PATH = path.join(psyntientHome(), "node.key");
const SETTINGS_PATH = path.join(psyntientHome(), "sync.json");
const TIMEOUT_MS = 60_000;

/** Required keys that identify a file as an Observation Packet. */
const PACKET_KEYS = ["session_id", "timestamp", "neural_data"];

// --- settings -------------------------------------------------------------

/**
 * Node-wide sync preferences. Deliberately Node-local (`~/.psyntient/`), not
 * in the Vault: this is a preference about behaviour, not user research data,
 * and it should not travel to another machine along with a synced Vault.
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

/** Read a project's `.project.json` from the Vault side, where it lives. */
function readProjectMeta(vaultProjectDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(vaultProjectDir, ".project.json"), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Resolve whether a project auto-syncs.
 *
 * `autoSync` on the project is tri-state on purpose: `true`/`false` are the
 * user's explicit choice for this project and always win; `null`/absent means
 * inherit the Node-wide default. A global switch that overrode an explicit
 * per-project "no" would be a consent bug rather than a convenience, so
 * inheritance only fills the gap where no choice was made.
 */
export function resolveAutoSync(projectMeta, settings = readSettings()) {
  if (projectMeta?.autoSync === true || projectMeta?.autoSync === false) {
    return projectMeta.autoSync;
  }
  return settings.autoSyncAll === true;
}

/**
 * Set (or clear) a project's explicit auto-sync choice.
 *
 * `null` clears it back to inheriting the Node-wide default. Kept as a real
 * third state rather than collapsing to false so "I have not decided" stays
 * distinguishable from "I said no" -- turning the global on must not silently
 * override the latter.
 */
export function setProjectAutoSync(vaultProjectDir, enabled) {
  const metaPath = path.join(vaultProjectDir, ".project.json");
  const meta = readProjectMeta(vaultProjectDir);
  if (enabled === null || enabled === undefined) {
    delete meta.autoSync;
  } else {
    meta.autoSync = enabled === true;
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  return { projectId: meta.projectId ?? path.basename(vaultProjectDir), autoSync: meta.autoSync ?? null };
}

// --- submission -----------------------------------------------------------

function readNodeToken() {
  try {
    const token = JSON.parse(fs.readFileSync(NODE_KEY_PATH, "utf8")).node_token;
    if (token) return token;
  } catch {
    /* fall through to the same actionable error */
  }
  throw new ArchiveError(
    "This Node is not paired with psyntient.io, so it cannot contribute to the Archive.",
  );
}

/** Every packet-shaped file under a project's sessions/, with its parsed body. */
export function collectPackets(sessionsDir) {
  const found = [];
  if (!fs.existsSync(sessionsDir)) return found;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
      try {
        const packet = JSON.parse(fs.readFileSync(full, "utf8"));
        if (PACKET_KEYS.every((k) => k in packet)) {
          found.push({ file: full, packet });
        }
      } catch {
        // Unparseable JSON in sessions/ is not a packet. Skipped rather than
        // failing the whole sync: one bad file must not block the good ones.
      }
    }
  };
  walk(sessionsDir);
  return found;
}

async function submitPacket(packet, token) {
  const url = new URL("/api/v1/ingest/packets", archiveBaseUrl());
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ packet }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new ArchiveError("The Archive rejected this Node's credentials.", { status: res.status });
  }
  if (!res.ok) {
    throw new ArchiveError(`Archive returned HTTP ${res.status} for ingest.`, {
      status: res.status,
    });
  }
  return res.json();
}

/**
 * Submit a project's packets, reporting progress as it goes.
 *
 * `onProgress` is called per packet so the UI can show real movement rather
 * than an indeterminate spinner over an unknown total -- the count is known
 * before the first request, so the progress bar can be honest.
 *
 * Already-submitted packets are skipped by `session_id`. The Archive has no
 * idempotency key yet (raised in FOR_THE_ARCHITECT.md), so this Node keeps its
 * own record: without it a retried sync would queue the same evidence twice,
 * and duplicates look like independent corroboration, which is worse than a
 * dropped submission.
 */
export async function syncProject(vaultProjectDir, { onProgress, dryRun = false } = {}) {
  const meta = readProjectMeta(vaultProjectDir);
  const projectId = meta.projectId ?? path.basename(vaultProjectDir);

  if (!isArchiveEligible(meta.dataTypes ?? [])) {
    return {
      ok: false,
      projectId,
      reason: "not-eligible",
      message: `"${projectId}" declares no instrument data, so it has nothing the Archive accepts.`,
    };
  }

  const candidates = collectPackets(path.join(vaultProjectDir, "sessions"));
  const submitted = new Set(meta.submissions?.map((s) => s.sessionId) ?? []);
  const pending = candidates.filter((c) => !submitted.has(c.packet.session_id));

  if (pending.length === 0) {
    return {
      ok: true,
      projectId,
      total: candidates.length,
      submitted: 0,
      skipped: candidates.length,
      message:
        candidates.length === 0
          ? "No Observation Packets in this project yet."
          : "Everything here has already been submitted.",
    };
  }
  if (dryRun) {
    return { ok: true, projectId, total: pending.length, submitted: 0, dryRun: true };
  }

  const token = readNodeToken();
  const results = [];
  const failures = [];
  for (const [index, candidate] of pending.entries()) {
    onProgress?.({ index, total: pending.length, sessionId: candidate.packet.session_id });
    try {
      const accepted = await submitPacket(candidate.packet, token);
      results.push({
        sessionId: candidate.packet.session_id,
        submissionId: accepted.submission_id,
        // Always "pending" on acceptance -- this is a queue receipt, not
        // confirmation the packet is in the Archive.
        status: accepted.status ?? "pending",
        submittedAt: new Date().toISOString(),
      });
    } catch (err) {
      failures.push({
        sessionId: candidate.packet.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Record receipts even on partial failure, so a retry does not resubmit what
  // already made it through.
  if (results.length > 0) {
    meta.submissions = [...(meta.submissions ?? []), ...results];
    fs.writeFileSync(
      path.join(vaultProjectDir, ".project.json"),
      JSON.stringify(meta, null, 2) + "\n",
    );
  }

  return {
    ok: failures.length === 0,
    projectId,
    total: pending.length,
    submitted: results.length,
    failed: failures.length,
    failures,
    // Deliberate wording: queued, not contributed. The Architect reviews these
    // and may reject them, and accepted ones surface only in a later Edition.
    message: `Queued ${results.length} packet(s) for review.`,
  };
}

export default {
  readSettings,
  writeSettings,
  resolveAutoSync,
  setProjectAutoSync,
  syncProject,
  collectPackets,
};

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [, , cmd, arg] = process.argv;
  const run = async () => {
    if (cmd === "settings") return readSettings();
    if (cmd === "set-global") return writeSettings({ autoSyncAll: arg === "true" });
    if (cmd === "set-project") {
      return setProjectAutoSync(arg, process.argv[4] === "clear" ? null : process.argv[4] === "true");
    }
    if (cmd === "sync") {
      return syncProject(arg, {
        onProgress: (p) => console.error(`  [${p.index + 1}/${p.total}] ${p.sessionId}`),
      });
    }
    if (cmd === "dry-run") return syncProject(arg, { dryRun: true });
    throw new Error("Usage: archive-sync.mjs settings | set-global <true|false> | dry-run <vaultProjectDir> | sync <vaultProjectDir>");
  };
  run()
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
