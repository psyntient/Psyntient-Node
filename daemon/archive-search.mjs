// Semantic search over the Archive's archetype index.
//
// WHY THIS REPLACES LITERAL SEARCH RATHER THAN SITTING BESIDE IT
// The Archive's `/search` matches archetype titles and description text. A
// researcher describing "that feeling when time slows down during a crash"
// will never substring-match "Time Dilation Distortion". Worse, the taxonomy
// is *living* -- the Architect creates, revises and merges archetypes every
// Edition -- so the exact strings someone would have to guess keep changing
// underneath them. Literal search does not just fail to scale here; it decays.
//
// WHY THIS IS NOT A TOOL CALL
// It is one plain completion: "here are 26 archetypes, which match this
// description?" No tools are involved, so it does not hit the tool-calling
// failure that forces a Sonnet fallback, and it can run on the fast cheap
// model. Deliberately `infer model run` rather than a chat turn: no session,
// no history, nothing a user sees in a thread.
//
// COARSE-TO-FINE
// Stage 1 reasons over the compact index (id + name + description) and returns
// ids only. Stage 2 fetches full records for just those ids. The Node never
// has to hold the whole Archive to answer a question about it. Today the index
// is small enough to send whole; when the Architect ships ARCHETYPES.md
// (FOR_THE_ARCHITECT.md section 3b) this reads that instead, unchanged
// otherwise.
import { getMap, batchGetArchetypes } from "./archive-client.mjs";
import { runCli } from "./openclaw-cli.mjs";

const SEARCH_TIMEOUT_MS = 60_000;
/** Enough to be useful, few enough that stage 2 stays cheap. */
const MAX_RESULTS = 8;

/**
 * Markdown, not JSON: the consumer is a language model, and markdown carries
 * the same content in meaningfully fewer tokens (no repeated keys, braces or
 * quotes). Measured at ~10.0 KB slim JSON vs ~7 KB markdown for 26 archetypes,
 * and that saving lands on every search.
 */
function renderIndex(archetypes) {
  return archetypes
    .map((a) => `### ${a.name}\nid: ${a.id}\n${a.description}`)
    .join("\n\n");
}

function buildPrompt(index, query) {
  return [
    "You are matching a person's description of an experience against a catalogue of",
    "archetypes from the Noetic Archive.",
    "",
    "Return ONLY a JSON array of matching archetype ids, most relevant first, at most",
    `${MAX_RESULTS}. No prose, no code fence. Example: ["NA-0012-grand-vastness-awe"]`,
    "",
    "Match on meaning, not wording. The person will not know the archetype names.",
    "If genuinely nothing matches, return [].",
    "",
    "CATALOGUE:",
    index,
    "",
    "THEIR DESCRIPTION:",
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
  // Filter against the real index: a hallucinated id would otherwise become a
  // failed fetch, and a confident-looking result for an archetype that does
  // not exist is worse than no result.
  return parsed
    .filter((id) => typeof id === "string" && validIds.has(id))
    .slice(0, MAX_RESULTS);
}

/**
 * @param {string} query Plain-language description of an experience.
 * @param {(stage: {stage: string, detail?: string}) => void} [onStage]
 *   Progress callback, so the UI can show real stages rather than a spinner.
 */
export async function semanticSearch(query, { onStage } = {}) {
  const trimmed = (query ?? "").trim();
  if (!trimmed) {
    return { ok: false, error: "Search needs a description." };
  }

  onStage?.({ stage: "reading-index" });
  const map = await getMap();
  const archetypes = map.archetypes ?? [];
  if (archetypes.length === 0) {
    return { ok: false, error: "The Archive returned no archetypes to search." };
  }

  onStage?.({ stage: "matching", detail: `${archetypes.length} archetypes` });
  const result = await runCli(
    [
      "infer", "model", "run",
      "--gateway",
      "--prompt", buildPrompt(renderIndex(archetypes), trimmed),
      "--json",
    ],
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
    const parsed = JSON.parse(result.stdout);
    text = parsed?.outputs?.[0]?.text ?? "";
  } catch {
    text = result.stdout;
  }
  if (!text) {
    return { ok: false, error: "The search model returned no output." };
  }

  const validIds = new Set(archetypes.map((a) => a.id));
  const ids = extractIds(text, validIds);
  if (ids.length === 0) {
    return { ok: true, edition: map.edition, archetypes: [], matched: 0 };
  }

  // Stage 2: ONE request for the whole shortlist, not one per id. The records
  // land in the shared cache, so the chips these become can be expanded later
  // without touching the Archive again.
  onStage?.({ stage: "fetching", detail: `${ids.length} record(s)` });
  const byId = new Map(archetypes.map((a) => [a.id, a]));
  let detailed;
  try {
    const records = await batchGetArchetypes(ids);
    detailed = records.map((r) => ({ ...byId.get(r.id), ...r }));
  } catch {
    // The match itself is still valid even if the detail fetch fails; show the
    // index entries rather than losing a correct result to a network blip.
    detailed = ids.map((id) => byId.get(id)).filter(Boolean);
  }

  return {
    ok: true,
    edition: map.edition,
    matched: detailed.length,
    archetypes: detailed.filter(Boolean),
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
