// Vault ledger — an index of what a Vault actually holds, and which of it the
// Archive could accept.
//
// Two callers need this and neither should walk the whole Vault to get it:
//   - Cortex, answering "what's in my Vault?" / "what could I contribute?"
//     (the first is already a suggestion chip in the empty state)
//   - auto-sync, which needs the eligible set without a full scan per cycle
//
// DERIVED, NEVER AUTHORITATIVE. The filesystem and each project's
// .project.json are the truth; this is a cache of a walk over them. Files get
// added, moved and deleted outside anything that would update an index, so a
// ledger treated as authority goes quietly wrong. Every read reports how stale
// it is, and rescanning is cheap enough to just do.
//
// INDEX ONLY. Paths, types, counts, sizes. Never file contents, never
// transcript text -- there is no reason for this file to be able to leak
// anything beyond structure, so it is built so it cannot.
//
// Eligibility comes from `sessions/` alone, matching the rule in
// ARCHIVE_INTEGRATION.md: that is the only directory a contribution is ever
// assembled from. notes/, analyses/ and exports/ are the researcher's own
// working material and are deliberately not counted here.
import fs from "node:fs";
import path from "node:path";
import { getVaultRoot } from "./vault.mjs";
import { isArchiveEligible } from "./working-memory.mjs";

// Resolved through getVaultRoot(), never hardcoded to Neural_Vault/: vault.mjs
// supports relocating the Vault (setLocalPath moves it, and cloud mode points
// elsewhere entirely), so a hardcoded path would index the wrong directory --
// or an abandoned one -- for anyone who has moved theirs.
const ledgerPath = () => path.join(getVaultRoot(), "ledger.json");

/**
 * Required keys of an Observation Packet, read from the live ingest schema
 * (`IngestSubmission.packet`, verified 2026-08-28):
 *   session_id, timestamp, duration_seconds, neural_data, report_text,
 *   context_tags, modalities, consent_state, schema_version
 *
 * The API describes this as "the same JSON shape a Neural Vault project
 * produces", so sessions/ is meant to hold files already in packet form. Only
 * the identifying subset is checked -- this classifies a file, it does not
 * validate it. The Architect reviews submissions and can still reject one.
 */
const PACKET_KEYS = ["session_id", "timestamp", "neural_data"];

function looksLikePacket(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return PACKET_KEYS.every((k) => k in parsed);
  } catch {
    return false;
  }
}

/** Everything under a project's sessions/, flattened, with size but not content. */
function measureSessions(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) {
    return { files: 0, bytes: 0, captures: [] };
  }
  let files = 0;
  let bytes = 0;
  const captures = [];
  const walk = (dir, relative) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const size = fs.statSync(full).size;
      const ext = path.extname(entry.name).toLowerCase();
      files += 1;
      bytes += size;
      captures.push({
        path: rel,
        bytes: size,
        ext,
        // Distinguishes "has data" from "has data the Archive can accept".
        // A project full of raw .edf recordings is not contributable until
        // something turns them into packets, and silently counting them as
        // ready would make auto-sync promise a submission it cannot build.
        isPacket: ext === ".json" && looksLikePacket(full),
      });
    }
  };
  walk(sessionsDir, "");
  return { files, bytes, captures, packets: captures.filter((c) => c.isPacket).length };
}

/**
 * Walk the active Vault's devices and index every project found.
 *
 * The Vault is partitioned `Devices/<device>/<project>/`, so one Vault can
 * hold projects from several machines. The ledger keeps that partition rather
 * than flattening it: two devices can legitimately hold different projects
 * under the same id, and collapsing them would silently merge unrelated
 * research.
 */
export function scanVault() {
  const scannedAt = new Date().toISOString();
  const vaultRoot = getVaultRoot();
  const projects = [];

  const devicesDir = path.join(vaultRoot, "Devices");
  if (fs.existsSync(devicesDir)) {
    for (const device of fs.readdirSync(devicesDir, { withFileTypes: true })) {
      if (!device.isDirectory()) continue;
      const deviceDir = path.join(devicesDir, device.name);
      for (const project of fs.readdirSync(deviceDir, { withFileTypes: true })) {
        if (!project.isDirectory()) continue;
        const projectDir = path.join(deviceDir, project.name);

        let meta = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(projectDir, ".project.json"), "utf8"));
        } catch {
          // A project directory with no readable metadata still gets indexed:
          // omitting it would make the ledger quietly disagree with the disk,
          // which is the one thing an index must never do.
        }

        const sessions = measureSessions(path.join(projectDir, "sessions"));
        const dataTypes = Array.isArray(meta.dataTypes) ? meta.dataTypes : [];
        // Recomputed rather than trusting the stored flag: .project.json may
        // predate the data-types vocabulary, and a stale boolean deciding what
        // may leave the Vault is not a risk worth taking for one function call.
        const eligibleTypes = isArchiveEligible(dataTypes);

        projects.push({
          device: device.name,
          projectId: project.name,
          title: meta.title ?? project.name,
          dataTypes,
          // Declared types allow contribution; actual captures make it possible.
          // Both are reported because "eligible but empty" and "has data but
          // declares none" are different problems with different fixes.
          declaredEligible: eligibleTypes,
          hasCaptures: sessions.files > 0,
          // Contributable means a submission could actually be built today:
          // declared eligible AND holding at least one packet-shaped file.
          // Files that are not packets are reported separately rather than
          // counted, so "nothing to send" is distinguishable from "nothing
          // here".
          contributable: eligibleTypes && sessions.packets > 0,
          sessions: {
            files: sessions.files,
            bytes: sessions.bytes,
            packets: sessions.packets,
            nonPacketFiles: sessions.files - sessions.packets,
          },
          captures: sessions.captures,
          path: path.relative(vaultRoot, projectDir),
          lastSyncedAt: meta.lastSyncedAt ?? null,
          // Tri-state, passed through unresolved: null means "inherit the
          // Node default", which the caller resolves. Collapsing it here would
          // lose the difference between "not decided" and "explicitly off".
          autoSync: meta.autoSync ?? null,
          // Queue receipts, so a UI can show what was submitted and when
          // without re-reading every .project.json.
          submissions: (meta.submissions ?? []).length,
        });
      }
    }
  }

  const ledger = {
    scannedAt,
    vaultRoot,
    counts: {
      projects: projects.length,
      contributable: projects.filter((p) => p.contributable).length,
      captureFiles: projects.reduce((n, p) => n + p.sessions.files, 0),
      captureBytes: projects.reduce((n, p) => n + p.sessions.bytes, 0),
      packets: projects.reduce((n, p) => n + p.sessions.packets, 0),
    },
    projects,
  };

  fs.mkdirSync(vaultRoot, { recursive: true });
  fs.writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2) + "\n");
  return ledger;
}

/**
 * Read the ledger, rescanning when it is missing or older than `maxAgeMs`.
 *
 * Default 0 means "always rescan": correctness first. A caller that genuinely
 * needs speed over freshness can raise it deliberately, which is better than a
 * default that silently serves stale answers about what left the Vault.
 */
export function readLedger({ maxAgeMs = 0 } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    const age = Date.now() - Date.parse(raw.scannedAt);
    if (Number.isFinite(age) && age <= maxAgeMs) {
      return { ...raw, fromCache: true, ageMs: age };
    }
  } catch {
    // No ledger yet, or an unreadable one. Either way, scan.
  }
  return { ...scanVault(), fromCache: false, ageMs: 0 };
}

/** Just the projects that could contribute today: eligible types AND real captures. */
export function contributableProjects() {
  return readLedger().projects.filter((p) => p.contributable);
}

export default { scanVault, readLedger, contributableProjects };

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const cmd = process.argv[2] ?? "read";
  const out =
    cmd === "scan" ? scanVault() : cmd === "contributable" ? contributableProjects() : readLedger();
  console.log(JSON.stringify(out, null, 2));
}
