// Semantic search over the Vault — the local counterpart to archive-search.mjs.
//
// SAME SHAPE, DIFFERENT CORPUS. The Archive search reasons over ARCHETYPES.md
// to shortlist archetype ids, then batch-fetches those records. This reasons
// over the Vault's own index to shortlist project ids, then reads only those
// projects. Coarse-to-fine either way: the model never has to hold the whole
// corpus to answer a question about it.
//
// WHY SEMANTIC RATHER THAN FILENAME MATCHING
// A researcher looks for "the session where I felt like time stopped", not for
// `thesis-chapter-3/notes/2026-08-14.md`. Their own material is exactly the
// material they are worst at naming, because they wrote the names months ago
// and for a different purpose. Substring search over paths answers a question
// nobody asks.
//
// WHY EXCERPTS LIVE HERE AND NOT IN THE LEDGER
// vault-ledger.mjs is structure-only by design: it is persisted as ledger.json
// and VAULT.md, and those files travel with the Vault, including into a synced
// cloud folder. Matching needs to see what notes actually say, so this module
// reads note text at search time and keeps it in memory for the duration of
// one search. Nothing here is written to disk.
//
// Like the Archive search this is one plain completion via `infer model run`,
// not a tool call -- so it runs on the fast cheap model and does not touch the
// tool-calling path, and creates no session a user would see in a thread.
import { readLedger } from "./vault-ledger.mjs";
import { getProvider } from "./vault-storage.mjs";
import { runCli } from "./openclaw-cli.mjs";

const SEARCH_TIMEOUT_MS = 60_000;
const MAX_RESULTS = 8;

/** Per-file and whole-index excerpt budgets, so one long note cannot crowd out
 *  every other project in the prompt. */
const EXCERPT_CHARS = 600;
const INDEX_CHAR_BUDGET = 60_000;

/** Text the model can actually reason over. Binary captures and raw recordings
 *  are indexed structurally by the ledger and deliberately not read here. */
const READABLE = new Set([".md", ".txt", ".json"]);

/**
 * Build the coarse index: what each project is, plus a bounded taste of what
 * its working material says.
 *
 * Notes and analyses only. `sessions/` is capture data -- often large, often
 * binary, and already summarised structurally by the ledger -- so reading it
 * here would cost a great deal of prompt for very little meaning.
 */
async function buildIndex(projects, store) {
  const blocks = [];
  let spent = 0;

  for (const p of projects) {
    const head = [
      `### ${p.title}`,
      `id: ${p.projectId}`,
      `data types: ${p.dataTypes.length ? p.dataTypes.join(", ") : "none declared"}`,
      `captures: ${p.sessions.files} file(s), ${p.sessions.packets} packet(s)`,
    ];
    if (p.description) head.push(`description: ${p.description}`);

    const excerpts = [];
    for (const kind of ["notes", "analyses"]) {
      for (const entry of await store.listDir(`${p.path}/${kind}`)) {
        if (entry.isDirectory) continue;
        if (!READABLE.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())) continue;
        if (spent >= INDEX_CHAR_BUDGET) break;
        const text = await store.readText(`${p.path}/${kind}/${entry.name}`);
        if (!text?.trim()) continue;
        const excerpt = text.trim().slice(0, EXCERPT_CHARS);
        spent += excerpt.length;
        excerpts.push(`${kind}/${entry.name}: ${excerpt}`);
      }
    }
    if (excerpts.length) head.push("", ...excerpts);
    blocks.push(head.join("\n"));
  }

  return { index: blocks.join("\n\n"), truncated: spent >= INDEX_CHAR_BUDGET };
}

function buildPrompt(index, query) {
  return [
    "You are searching a researcher's own private Vault of projects, notes and",
    "recordings, on their behalf.",
    "",
    "Return ONLY a JSON array of matching project ids, most relevant first, at most",
    `${MAX_RESULTS}. No prose, no code fence. Example: ["thesis-chapter-3"]`,
    "",
    "Match on meaning, not wording. They are describing their own work from memory,",
    "so their words will rarely match the project titles they chose. If genuinely",
    "nothing matches, return [].",
    "",
    "THEIR VAULT:",
    index,
    "",
    "WHAT THEY ARE LOOKING FOR:",
    query,
  ].join("\n");
}

/** Models wrap JSON in prose or fences often enough that this is not optional. */
function extractIds(text, validIds) {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // Filter against the real ledger: a hallucinated id would become a failed
  // read, and a confident result for a project that does not exist is worse
  // than no result.
  return parsed
    .filter((id) => typeof id === "string" && validIds.has(id))
    .slice(0, MAX_RESULTS);
}

/**
 * @param {string} query Plain-language description of what they are after.
 * @param {(stage: {stage: string, detail?: string}) => void} [onStage]
 *   Progress callback, so the UI shows real stages rather than a spinner.
 */
export async function semanticSearch(query, { onStage } = {}) {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return { ok: false, error: "Search needs a description." };

  onStage?.({ stage: "reading-index" });
  const ledger = await readLedger();
  const projects = ledger.projects ?? [];
  if (projects.length === 0) {
    return { ok: true, projects: [], matched: 0, empty: true, storage: ledger.storage };
  }

  const store = getProvider();
  const { index, truncated } = await buildIndex(projects, store);

  onStage?.({ stage: "matching", detail: `${projects.length} projects` });
  const result = await runCli(
    ["infer", "model", "run", "--gateway", "--prompt", buildPrompt(index, trimmed), "--json"],
    { timeoutMs: SEARCH_TIMEOUT_MS },
  );

  if (result.code !== 0) {
    return {
      ok: false,
      error: (result.stderr || result.stdout || "").trim() || `inference failed (${result.code})`,
    };
  }

  // `infer model run --json` returns { ok, provider, model, attempts, outputs:
  // [{ text }] }. Read outputs[0].text specifically: falling back to the whole
  // payload lets the id-extracting regex match `"attempts": []` first and
  // return zero results for a query that actually matched.
  let text = "";
  try {
    text = JSON.parse(result.stdout)?.outputs?.[0]?.text ?? "";
  } catch {
    text = result.stdout;
  }
  if (!text) return { ok: false, error: "The search model returned no output." };

  const byId = new Map(projects.map((p) => [p.projectId, p]));
  const ids = extractIds(text, new Set(byId.keys()));

  onStage?.({ stage: "opening", detail: `${ids.length} project(s)` });
  return {
    ok: true,
    storage: ledger.storage,
    truncated,
    matched: ids.length,
    projects: ids.map((id) => byId.get(id)).filter(Boolean),
  };
}

export default { semanticSearch };

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  semanticSearch(process.argv.slice(2).join(" "), {
    onStage: (s) => console.error(`  [${s.stage}] ${s.detail ?? ""}`),
  })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
