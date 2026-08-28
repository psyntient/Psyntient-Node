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
//
// ASYNC, THROUGH A PROVIDER. Every read goes through vault-storage.mjs rather
// than node:fs directly. Local disk is the only backend today, but Google
// Drive is a planned mode and an API-backed listing is a network round trip --
// so the walk is async now, while there are two callers, rather than after a
// Drive adapter exists and every caller has to change at once.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { getVaultRoot } from "./vault.mjs";
import { getProvider } from "./vault-storage.mjs";
import { isArchiveEligible } from "./working-memory.mjs";

// Resolved through getVaultRoot(), never hardcoded to Neural_Vault/: vault.mjs
// supports relocating the Vault (setLocalPath moves it, and cloud mode points
// elsewhere entirely), so a hardcoded path would index the wrong directory --
// or an abandoned one -- for anyone who has moved theirs.
const ledgerPath = () => path.join(getVaultRoot(), "ledger.json");

/**
 * How many individual capture files a project records in the ledger.
 *
 * The counts, formats and span are exact regardless; this bounds only the
 * per-file sample. A Vault that has been in use for years holds far more
 * capture files than any view lists, and writing every one of them into a file
 * that every caller parses is how an index stops being cheaper than the walk
 * it replaces.
 */
const CAPTURE_SAMPLE = 50;

/**
 * Packet-classification results — machine-local, NOT inside the Vault.
 *
 * Two reasons, and the second is correctness rather than tidiness:
 *
 *  - It is an accelerator, not an answer. ledger.json is what the plugin,
 *    Cortex and any viewer read; this only makes the next scan cheaper, and it
 *    churns on every scan. Putting a file with those write patterns inside a
 *    Vault that may be a synced cloud folder means uploading it forever.
 *  - Its keys embed mtime, and mtimes do not survive a sync. The same Vault
 *    opened on a second machine, or restored by a cloud client, has different
 *    mtimes for identical files -- so a cache that travelled with the Vault
 *    would be uniformly invalid on arrival while looking perfectly valid. A
 *    per-machine cache is simply the honest scope for per-machine metadata.
 *
 * Keyed by the Vault root so one machine can hold several Vaults without them
 * clobbering each other.
 */
function scanCachePath() {
  const id = createHash("sha1").update(getVaultRoot()).digest("hex").slice(0, 12);
  return path.join(os.homedir(), ".psyntient", `vault-scan-${id}.json`);
}

function readScanCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(scanCachePath(), "utf8"))));
  } catch {
    return new Map();
  }
}

function writeScanCache(cache) {
  try {
    const file = scanCachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // A cache that cannot be written costs speed, never correctness: the next
    // scan just re-reads. Never let it fail a scan.
  }
}

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

/**
 * Classification is the expensive half of a scan and the only half that reads
 * file contents, so it is cached across scans keyed by identity+size+mtime.
 *
 * This matters at the size a real Vault reaches: three years of EEG capture is
 * tens of thousands of files, and re-parsing every one of them on every read
 * to re-derive an answer that cannot have changed is the difference between a
 * ledger that stays usable and one that gets abandoned. The key is exact
 * rather than heuristic -- a file whose size and mtime both match is the same
 * file, and any edit moves at least one of them.
 */
async function looksLikePacket(store, rel, stat, priorCache, nextCache) {
  // Hashed rather than stored literally: the key is only ever compared, never
  // read back, and full paths are most of the file at Vault scale. A digest
  // keeps the cache proportional to file count instead of to path length.
  const key = createHash("sha1")
    .update(`${rel}:${stat.size}:${stat.mtime}`)
    .digest("base64url")
    .slice(0, 16);
  const cached = priorCache.get(key);
  if (cached !== undefined) {
    nextCache.set(key, cached);
    return cached;
  }
  const raw = await store.readText(rel);
  let verdict = false;
  if (raw !== null) {
    try {
      verdict = PACKET_KEYS.every((k) => k in JSON.parse(raw));
    } catch {
      verdict = false;
    }
  }
  nextCache.set(key, verdict);
  return verdict;
}

/** Everything under a project's sessions/, flattened, with size but not content. */
async function measureSessions(store, sessionsRel, priorCache, nextCache) {
  let files = 0;
  let bytes = 0;
  let packets = 0;
  let newest = null;
  let oldest = null;
  const byExt = new Map();
  const captures = [];

  const walk = async (dirRel, relative) => {
    for (const entry of await store.listDir(dirRel)) {
      const childRel = `${dirRel}/${entry.name}`;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(childRel, rel);
        continue;
      }
      const info = await store.stat(childRel);
      if (!info) continue;
      const ext = path.extname(entry.name).toLowerCase();
      files += 1;
      bytes += info.size;
      byExt.set(ext || "(none)", (byExt.get(ext || "(none)") ?? 0) + 1);
      if (!newest || info.mtime > newest) newest = info.mtime;
      if (!oldest || info.mtime < oldest) oldest = info.mtime;
      const isPacket =
        ext === ".json" && (await looksLikePacket(store, childRel, info, priorCache, nextCache));
      if (isPacket) packets += 1;
      // Only a bounded sample of individual files is kept. The counts above are
      // exact and are what the ledger promises; the sample exists so a viewer
      // can show something concrete without a second read. A Vault holding
      // years of capture would otherwise put tens of thousands of rows into a
      // file every caller parses, to render a list nobody scrolls.
      if (captures.length >= CAPTURE_SAMPLE) continue;
      captures.push({
        path: rel,
        bytes: info.size,
        ext,
        // Distinguishes "has data" from "has data the Archive can accept".
        // A project full of raw .edf recordings is not contributable until
        // something turns them into packets, and silently counting them as
        // ready would make auto-sync promise a submission it cannot build.
        isPacket,
      });
    }
  };

  await walk(sessionsRel, "");
  return {
    files,
    bytes,
    packets,
    captures,
    sampled: captures.length < files,
    // Formats and span answer "what kind of project is this?" in constant size,
    // which is what a card needs -- and what a per-file list is a bad way to
    // convey once there are more files than fit on a screen.
    formats: [...byExt.entries()].sort((a, b) => b[1] - a[1]).map(([ext, n]) => ({ ext, n })),
    span: newest ? { oldest, newest } : null,
  };
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
export async function scanVault() {
  const scannedAt = new Date().toISOString();
  const store = getProvider();
  const vaultRoot = store.root ?? null;
  const projects = [];
  // Entries are copied forward only when their file is seen again, so the
  // cache self-prunes: deleted and rewritten files fall out on the next scan
  // instead of accumulating forever.
  const priorCache = readScanCache();
  const nextCache = new Map();

  for (const device of await store.listDir("Devices")) {
    if (!device.isDirectory) continue;
    for (const project of await store.listDir(`Devices/${device.name}`)) {
      if (!project.isDirectory) continue;
      const projectRel = `Devices/${device.name}/${project.name}`;

      let meta = {};
      const rawMeta = await store.readText(`${projectRel}/.project.json`);
      if (rawMeta !== null) {
        try {
          meta = JSON.parse(rawMeta);
        } catch {
          // A project directory with no readable metadata still gets indexed:
          // omitting it would make the ledger quietly disagree with the disk,
          // which is the one thing an index must never do.
        }
      }

      const sessions = await measureSessions(store, `${projectRel}/sessions`, priorCache, nextCache);
      const dataTypes = Array.isArray(meta.dataTypes) ? meta.dataTypes : [];
      // Recomputed rather than trusting the stored flag: .project.json may
      // predate the data-types vocabulary, and a stale boolean deciding what
      // may leave the Vault is not a risk worth taking for one function call.
      const eligibleTypes = isArchiveEligible(dataTypes);

      // Structural only, like everything else here: which working directories
      // exist and how many files each holds. It is what a viewer needs to show
      // a project has notes without this index ever holding what they say.
      const material = {};
      for (const kind of ["notes", "analyses", "exports"]) {
        const entries = await store.listDir(`${projectRel}/${kind}`);
        material[kind] = entries.filter((e) => !e.isDirectory).length;
      }

      projects.push({
        device: device.name,
        projectId: project.name,
        title: meta.title ?? project.name,
        description: meta.description ?? null,
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
          formats: sessions.formats,
          span: sessions.span,
        },
        // A bounded sample, not the whole set -- `sampled` says so explicitly
        // rather than letting a viewer present 50 of 40,000 files as the lot.
        captures: sessions.captures,
        capturesSampled: sessions.sampled,
        material,
        path: projectRel,
        createdAt: meta.createdAt ?? null,
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

  const ledger = {
    scannedAt,
    vaultRoot,
    storage: store.id,
    counts: {
      projects: projects.length,
      contributable: projects.filter((p) => p.contributable).length,
      captureFiles: projects.reduce((n, p) => n + p.sessions.files, 0),
      captureBytes: projects.reduce((n, p) => n + p.sessions.bytes, 0),
      packets: projects.reduce((n, p) => n + p.sessions.packets, 0),
    },
    projects,
  };

  await store.writeText("ledger.json", JSON.stringify(ledger, null, 2) + "\n");
  writeScanCache(nextCache);
  await store.writeText("VAULT.md", renderVaultMarkdown(ledger));
  return ledger;
}

/**
 * The Vault's own index, in markdown, written beside ledger.json.
 *
 * Same role ARCHETYPES.md plays for the Archive: the cheap coarse pass a model
 * reads whole before deciding what to open. Markdown rather than JSON for the
 * same measured reason -- no repeated keys, braces or quotes, and the consumer
 * is a language model.
 *
 * Structural only, exactly like ledger.json. No note text, no transcript, no
 * capture contents. This file travels with the Vault, including into a synced
 * cloud folder, so it must not be able to carry anything the Vault holds.
 * vault-search.mjs reads content for matching and keeps it in memory.
 */
export function renderVaultMarkdown(ledger) {
  const bytes = (n) =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

  const lines = [
    "# Vault index",
    "",
    "Every project this Vault holds: what it declares, what it contains, and",
    "whether it could contribute to the Noetic Archive.",
    "Generated from `ledger.json`; do not hand-edit.",
    "",
    "Structure only -- this file never contains notes, transcripts or capture data.",
    "",
    `Projects: ${ledger.counts.projects} · Contributable: ${ledger.counts.contributable} · ` +
      `Captures: ${ledger.counts.captureFiles} (${bytes(ledger.counts.captureBytes)}) · ` +
      `Packets: ${ledger.counts.packets}`,
    `Scanned: ${ledger.scannedAt}`,
    "",
    "---",
    "",
  ];

  if (ledger.projects.length === 0) {
    lines.push("_This Vault has no projects yet._");
    return lines.join("\n") + "\n";
  }

  for (const p of ledger.projects) {
    lines.push(`### ${p.title}`);
    lines.push(`- id: ${p.projectId}`);
    lines.push(`- device: ${p.device}`);
    lines.push(`- data types: ${p.dataTypes.length ? p.dataTypes.join(", ") : "none declared"}`);
    lines.push(
      `- captures: ${p.sessions.files} file(s), ${bytes(p.sessions.bytes)}, ` +
        `${p.sessions.packets} packet(s)`,
    );
    const mat = Object.entries(p.material ?? {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`);
    if (mat.length) lines.push(`- material: ${mat.join(", ")}`);
    lines.push(
      `- contributable: ${p.contributable ? "yes" : p.declaredEligible ? "no (no packets yet)" : "no (data types not eligible)"}`,
    );
    if (p.lastSyncedAt) lines.push(`- last synced: ${p.lastSyncedAt}`);
    lines.push("");
    if (p.description) {
      lines.push(p.description.trim());
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Read the ledger, rescanning when it is missing or older than `maxAgeMs`.
 *
 * The default was 0 -- always rescan, correctness over speed -- which is right
 * for a Vault with five projects and wrong for the one this has to survive:
 * years of capture across dozens of projects, where a full walk on every read
 * makes the index slower than not having one. The default is now a short
 * window, and every response still reports `ageMs` and `fromCache` so a caller
 * that must not be stale can pass 0 and say so.
 *
 * Staleness here is bounded and visible, which is the property that matters:
 * this indexes what a Vault holds, and a viewer showing a 30-second-old count
 * is fine, while a viewer that takes 40 seconds to open is not.
 */
export async function readLedger({ maxAgeMs = 30_000 } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    const age = Date.now() - Date.parse(raw.scannedAt);
    if (Number.isFinite(age) && age <= maxAgeMs) {
      return { ...raw, fromCache: true, ageMs: age };
    }
  } catch {
    // No ledger yet, or an unreadable one. Either way, scan.
  }
  return { ...(await scanVault()), fromCache: false, ageMs: 0 };
}

/** Just the projects that could contribute today: eligible types AND real captures. */
export async function contributableProjects() {
  return (await readLedger()).projects.filter((p) => p.contributable);
}

export default { scanVault, readLedger, contributableProjects, renderVaultMarkdown };

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const cmd = process.argv[2] ?? "read";
  const run =
    cmd === "scan" ? scanVault() : cmd === "contributable" ? contributableProjects() : readLedger();
  run
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
