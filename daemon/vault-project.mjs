// One project's actual contents — the fine half of coarse-to-fine.
//
// The ledger answers "what does this Vault hold?" in bounded size for every
// project at once. This answers "what is in THIS project?" for one project,
// when something opens it. Splitting them is what keeps the Vault usable at
// the size it is actually built for: years of capture across many projects,
// where an index that carried every file would cost more than the walk.
//
// TRIMMED, NOT RAW. Each area is read according to what it holds:
//   - packets are summarised to their identifying fields, never returned whole
//   - notes and analyses return text, capped, because reading them is the point
//   - recordings and anything binary return metadata only
// A viewer showing a 40 MB EEG file as text helps nobody, and a model handed
// one wastes its whole context on it.
import fsp from "node:fs/promises";
import path from "node:path";
import { getProvider } from "./vault-storage.mjs";
import { readLedger } from "./vault-ledger.mjs";

/** Per-file text cap. Enough to read a note; far short of a transcript dump. */
const TEXT_CHARS = 20_000;
/** Files listed per area. Areas report their true total alongside. */
const LIST_LIMIT = 200;

const TEXT_EXT = new Set([".md", ".txt", ".csv"]);

/**
 * The fields that identify a packet, drawn from the ingest schema.
 *
 * Returned instead of the packet itself: the interesting question about a
 * capture in a list is when it was taken, how long it ran and what recorded
 * it, not the sample array. The full file stays on disk where it already is.
 */
function summarisePacket(parsed) {
  return {
    sessionId: parsed.session_id ?? null,
    timestamp: parsed.timestamp ?? null,
    durationSeconds: parsed.duration_seconds ?? null,
    modalities: parsed.modalities ?? null,
    consentState: parsed.consent_state ?? null,
    schemaVersion: parsed.schema_version ?? null,
    hasReport: typeof parsed.report_text === "string" && parsed.report_text.length > 0,
    contextTags: parsed.context_tags ?? null,
  };
}

async function readArea(store, projectRel, area, { withText }) {
  const entries = [];
  let total = 0;

  const walk = async (dirRel, relative) => {
    for (const entry of await store.listDir(dirRel)) {
      const childRel = `${dirRel}/${entry.name}`;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(childRel, rel);
        continue;
      }
      total += 1;
      if (entries.length >= LIST_LIMIT) continue;

      const stat = await store.stat(childRel);
      if (!stat) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const item = { path: rel, ext, bytes: stat.size, mtime: stat.mtime, kind: "file" };

      if (ext === ".json") {
        const raw = await store.readText(childRel);
        try {
          const parsed = JSON.parse(raw ?? "");
          if (parsed && "session_id" in parsed && "neural_data" in parsed) {
            item.kind = "packet";
            item.packet = summarisePacket(parsed);
          } else {
            item.kind = "data";
          }
        } catch {
          item.kind = "data";
        }
      } else if (withText && TEXT_EXT.has(ext)) {
        const raw = await store.readText(childRel);
        if (raw !== null) {
          item.kind = "text";
          item.text = raw.slice(0, TEXT_CHARS);
          item.truncated = raw.length > TEXT_CHARS;
        }
      } else if (!TEXT_EXT.has(ext) && ext !== ".json") {
        // Recordings and other binaries: described, never opened. Size and
        // format are the whole of what a viewer can usefully show.
        item.kind = "binary";
      }

      entries.push(item);
    }
  };

  await walk(`${projectRel}/${area}`, "");
  return { area, total, listed: entries.length, truncated: total > entries.length, entries };
}

/**
 * Read one project.
 *
 * `device` is optional: a Vault is partitioned by device and two machines can
 * legitimately hold projects under the same id, so an ambiguous id is reported
 * rather than silently resolved to whichever was walked first.
 */
export async function readProject(projectId, { device = null } = {}) {
  const ledger = await readLedger();
  const matches = ledger.projects.filter(
    (p) => p.projectId === projectId && (!device || p.device === device),
  );
  if (matches.length === 0) {
    return { ok: false, error: `No project "${projectId}" in this Vault.` };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `"${projectId}" exists on more than one device; specify which.`,
      devices: matches.map((p) => p.device),
    };
  }

  const summary = matches[0];
  const store = getProvider();
  // Notes and analyses carry text because reading them is the point of opening
  // a project; sessions and exports do not, because they are capture volume.
  const areas = await Promise.all([
    readArea(store, summary.path, "sessions", { withText: false }),
    readArea(store, summary.path, "notes", { withText: true }),
    readArea(store, summary.path, "analyses", { withText: true }),
    readArea(store, summary.path, "exports", { withText: false }),
  ]);

  return { ok: true, storage: store.id, project: summary, areas };
}

/**
 * Describe a value without reproducing it.
 *
 * `neural_data` is the whole problem this solves: today's packets carry small
 * summary features, but a real EEG capture carries per-channel sample arrays,
 * and a viewer that renders those either freezes the tab or floods a model's
 * context with numbers that mean nothing individually. What a reader actually
 * wants from a recording is its SHAPE -- which channels, how many samples,
 * what range -- so that is what this returns.
 */
function describeValue(value, depth = 0) {
  if (value === null || value === undefined) return { kind: "empty" };
  if (Array.isArray(value)) {
    const numeric = value.filter((v) => typeof v === "number");
    const out = { kind: "array", length: value.length };
    if (numeric.length === value.length && value.length > 0) {
      out.min = Math.min(...numeric);
      out.max = Math.max(...numeric);
    } else if (value.length > 0 && depth < 2) {
      // Non-numeric arrays are usually short label lists; a few samples say
      // more than a length alone.
      out.sample = value.slice(0, 5).map((v) => (typeof v === "object" ? "…" : v));
    }
    return out;
  }
  if (typeof value === "object") {
    if (depth >= 3) return { kind: "object", keys: Object.keys(value).length };
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = describeValue(v, depth + 1);
    return { kind: "object", fields };
  }
  if (typeof value === "string" && value.length > 400) {
    return { kind: "text", length: value.length, preview: value.slice(0, 400) };
  }
  return { kind: "scalar", value };
}

/** How much of a text file a reader gets in one go. */
const FILE_TEXT_CHARS = 200_000;

/**
 * One file's contents, trimmed to what can honestly be shown.
 *
 * Packets are split into their identifying fields, the researcher's own report
 * text, and a description of the recorded data. Text files come back whole (to
 * a cap). Anything else is described, never decoded -- there is no useful
 * text rendering of a binary recording, and pretending otherwise just produces
 * mojibake.
 */
export async function readFile(projectId, relPath, { device = null } = {}) {
  if (!relPath || relPath.includes("..")) {
    return { ok: false, error: "Invalid file path." };
  }
  const ledger = await readLedger();
  const matches = ledger.projects.filter(
    (p) => p.projectId === projectId && (!device || p.device === device),
  );
  if (matches.length !== 1) {
    return { ok: false, error: `Could not resolve project "${projectId}".` };
  }

  const store = getProvider();
  const full = `${matches[0].path}/${relPath}`;
  const stat = await store.stat(full);
  if (!stat) return { ok: false, error: `No such file: ${relPath}` };

  const ext = path.extname(relPath).toLowerCase();
  const base = { ok: true, path: relPath, ext, bytes: stat.size, mtime: stat.mtime };

  if (ext === ".json") {
    const raw = await store.readText(full);
    let parsed;
    try {
      parsed = JSON.parse(raw ?? "");
    } catch {
      return { ...base, kind: "data", error: "This file is not valid JSON." };
    }
    if (parsed && "session_id" in parsed && "neural_data" in parsed) {
      const { neural_data: neural, report_text: report, ...rest } = parsed;
      return {
        ...base,
        kind: "packet",
        fields: rest,
        report: typeof report === "string" ? report : null,
        // Per modality, so "what did this actually record" is answerable
        // without the file being opened raw.
        data: Object.fromEntries(
          Object.entries(neural ?? {}).map(([modality, v]) => [modality, describeValue(v)]),
        ),
      };
    }
    return { ...base, kind: "data", describe: describeValue(parsed) };
  }

  if (TEXT_EXT.has(ext)) {
    const raw = (await store.readText(full)) ?? "";
    return {
      ...base,
      kind: "text",
      text: raw.slice(0, FILE_TEXT_CHARS),
      truncated: raw.length > FILE_TEXT_CHARS,
    };
  }

  return { ...base, kind: "binary" };
}

/**
 * Content types for download. Deliberately conservative: anything unrecognised
 * is served as a generic binary stream rather than guessed at, because a wrong
 * type is how a file gets rendered instead of saved.
 */
const CONTENT_TYPES = {
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".edf": "application/octet-stream",
  ".fif": "application/octet-stream",
};

/**
 * A file's actual bytes, for download.
 *
 * Reads through the same provider as everything else so path containment is
 * enforced in one place. Resolves the project first rather than trusting a
 * caller-supplied path, so a request can only ever name a file inside a
 * project this Vault actually holds.
 */
export async function readRaw(projectId, relPath, { device = null } = {}) {
  if (!relPath || relPath.includes("..")) return { ok: false, error: "Invalid file path." };

  const ledger = await readLedger();
  const matches = ledger.projects.filter(
    (p) => p.projectId === projectId && (!device || p.device === device),
  );
  if (matches.length !== 1) return { ok: false, error: `Could not resolve project "${projectId}".` };

  const store = getProvider();
  if (!store.root) {
    return { ok: false, error: "This Vault backend cannot serve raw files." };
  }
  const full = path.resolve(store.root, `${matches[0].path}/${relPath}`);
  if (!full.startsWith(store.root + path.sep)) {
    return { ok: false, error: "Refusing to read outside the Vault." };
  }

  let bytes;
  try {
    bytes = await fsp.readFile(full);
  } catch {
    return { ok: false, error: `No such file: ${relPath}` };
  }
  const ext = path.extname(relPath).toLowerCase();
  return {
    ok: true,
    name: path.basename(relPath),
    contentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    bytes,
  };
}

export default { readProject, readFile, readRaw };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [, , projectId, arg2] = process.argv;
  const run = arg2 && arg2.includes(".")
    ? readFile(projectId, arg2)
    : readProject(projectId, { device: arg2 ?? null });
  run
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
