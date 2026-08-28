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

export default { readProject };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  readProject(process.argv[2], { device: process.argv[3] ?? null })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
