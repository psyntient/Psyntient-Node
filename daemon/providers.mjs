// BYO LLM provider key pipeline (spec section 5).
//
// IMPORTANT deviation from the literal spec wording: the spec says keys
// are "stored" in ~/.psyntient/providers.json. In practice OpenClaw already
// has its own credential store (`openclaw models auth`, backed by
// auth-profiles in openclaw.json + the per-agent sqlite auth store) which
// is what the Gateway actually reads at runtime. Duplicating raw key
// material into a second plaintext JSON file would be a strictly worse
// security posture for no benefit, so providers.json here holds only
// *metadata* (which provider, when configured, which profile id) — the
// key itself lives exactly once, inside OpenClaw's own store, applied via
// `openclaw models auth paste-api-key`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCli, jsonCommand } from "./openclaw-cli.mjs";
import { restart } from "./openclaw-control.mjs";
import { psyntientHome } from "./psyntient-home.mjs";

const PROVIDERS_PATH = path.join(psyntientHome(), "providers.json");

// Curated from Cortex/Open-Claw/extensions/ — real registered provider
// plugin ids that take a pasted API key (excludes e.g. ollama, which is
// local and keyless).
export const SUPPORTED_PROVIDERS = [
  { id: "openrouter", label: "OpenRouter (recommended — one key, many models)" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "groq", label: "Groq" },
  { id: "mistral", label: "Mistral" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "xai", label: "xAI" },
  { id: "cohere", label: "Cohere" },
  { id: "perplexity", label: "Perplexity" },
];

export function readProviders() {
  try {
    return JSON.parse(fs.readFileSync(PROVIDERS_PATH, "utf8"));
  } catch {
    return { providers: {} };
  }
}

function writeProviders(data) {
  fs.mkdirSync(path.dirname(PROVIDERS_PATH), { recursive: true });
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

// Ground truth is OpenClaw's own auth store, not our metadata file — the
// two can't be allowed to silently diverge.
//
// `models auth list` has real, observed CLI startup/work cost of its
// own -- timed the raw command directly during onboarding-wizard
// testing at ~10-20s, occasionally exceeding runCli's 20s default
// (especially right after a Gateway restart) and surfacing as a 500 to
// the wizard instead of resolving. 45s gives real headroom without
// masking a genuine hang.
export async function hasAnyProvider() {
  const result = await jsonCommand(["models", "auth", "list"], { timeoutMs: 45000 });
  return Array.isArray(result?.profiles) && result.profiles.length > 0;
}

// Psyntient product policy, not upstream OpenClaw behavior: OpenRouter is the
// one provider where a single BYO key unlocks a huge model catalog with
// wildly different cost/latency profiles, so give it a cheap conversational
// default and let the research-agent skill escalate per-invocation via
// sessions_spawn({model}). Direct-provider keys (anthropic/openai/etc.) keep
// that provider's own default untouched -- this only ever fires for
// providerId === "openrouter".
export function isOpenRouterModelRef(modelRef) {
  return typeof modelRef === "string" && modelRef.startsWith("openrouter/");
}

const OPENROUTER_STOCK_DEFAULTS = new Set([undefined, null, "", "openrouter/auto"]);
// History, in order, all 2026-08-25:
// 1. Switched from "openrouter/google/gemini-3.7-flash" to
//    "openrouter/anthropic/claude-3-haiku" for cost: Gemini requests showed
//    zero prompt-cache reuse (cacheRead:0, cacheWrite:0 on a ~20-28K-token
//    system prompt every message), and claude-3-haiku was the closest
//    per-token cost match to Gemini of any Claude model (~0.67x, verified
//    against OpenRouter's pricing API) -- confirmed separately that this
//    did NOT fix the caching problem either (OpenRouter+Anthropic caching
//    is a real upstream regression, tracked in openclaw/openclaw#129005),
//    so it was a pure cost play, not a latency fix.
// 2. That swap broke chat outright: claude-3-haiku has no extended-thinking
//    support at all, and OpenClaw's thinking-level resolver defaults to
//    "low" for any anthropic/* model regardless -- fixed live by forcing
//    thinking "off" for that specific model key.
// 3. Reverted back to Gemini 3.7 Flash after real evidence the cost
//    optimization was costing correctness: this workspace's system prompt
//    is large and fully uncached on every turn regardless of model, and
//    handing that whole prompt to an older/weaker model on every turn
//    measurably increased spurious tool-call behavior (e.g. invoking a
//    tool for a plain poem request) -- caught live in a real transcript,
//    same day, right after the switch. A cost optimization isn't worth
//    trading away basic instruction-following.
const OPENROUTER_CHAT_DEFAULT = "openrouter/google/gemini-3.7-flash";

// Only applies this default when model.primary is still the stock value --
// never overwrites a value the user (or a later Settings change)
// deliberately set, including a deliberate switch back to "openrouter/auto".
// Verified live: `openclaw config get <path> --json` returns the raw value
// directly (e.g. "openrouter/auto"), NOT wrapped in an object -- compare
// `current` itself, not `current?.value`.
//
// 30s timeout, not runCli's 20s default: observed live during this feature's
// own implementation that plain `config get`/`config set` calls -- normally
// fast -- occasionally ran past 20s under real network conditions (unrelated
// npm/registry traffic contending for the same sqlite-backed config store).
//
// Raised again to 90s, matching the paste-api-key call: 30s FAILED A REAL
// INSTALL -- "config set agents.defaults.model.primary ... timed out after
// 30000ms" -- on a gateway that had just been restarted by the key write
// immediately before it. Three raises say the estimate was never the problem.
// A timeout here does not cost a retry, it fails the install at the
// second-to-last phase, and waiting longer than necessary costs nothing.
/** True when `config get` reported the path simply does not exist yet. */
function isConfigPathMissing(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.error === "string" &&
    /not found/i.test(value.error)
  );
}

export async function applyOpenRouterChatDefault() {
  const raw = await jsonCommand(["config", "get", "agents.defaults.model.primary"], { timeoutMs: 90000 });
  // On a Node that has never had this key set -- which is EVERY fresh install
  // -- the CLI does not return undefined. It returns
  // {"error":"Config path not found: agents.defaults.model.primary"}, an
  // object, which is not in the stock set, so the guard below read it as "the
  // user chose something deliberate" and declined to set anything.
  //
  // The result was that no fresh install ever got a model: OpenClaw fell back
  // to its own built-in default, the interface showed gpt-5.6-sol, and the
  // agent failed on a Codex backend nobody asked for. The comment this
  // replaces said the shape had been "verified live" -- it had, but only
  // against a config where the path already existed.
  const current = isConfigPathMissing(raw) ? undefined : raw;
  if (!OPENROUTER_STOCK_DEFAULTS.has(current)) return { changed: false };
  const result = await runCli(
    ["config", "set", "agents.defaults.model.primary", OPENROUTER_CHAT_DEFAULT],
    { timeoutMs: 90000 },
  );
  if (result.code !== 0) {
    throw new Error(`Failed to set OpenRouter chat default: ${result.stderr || result.stdout}`);
  }
  return { changed: true, model: OPENROUTER_CHAT_DEFAULT };
}

// Add, replace, or rotate — one path for all three (Settings must reuse
// this exact function, not a second implementation; see CLAUDE.md). If a
// profile already exists for this provider, its key is overwritten in
// place rather than leaving the old one behind alongside a new profile.
export async function setProviderKey(providerId, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("API key must not be empty");
  }

  const existing = await jsonCommand(["models", "auth", "list", "--provider", providerId], { timeoutMs: 45000 });
  const profileId = existing?.profiles?.[0]?.id || `${providerId}:manual`;

  // 90s, not runCli's 20s default. Every other CLI call in this file was
  // already raised past that default -- 45s for the auth listings, 30s for the
  // config writes -- and this one, the call that actually stores the key, was
  // left on it. It failed a real install at twelve minutes in, on the
  // second-to-last phase, on a machine under memory pressure.
  //
  // Generous on purpose: a timeout here does not cost a retry, it costs the
  // whole install, and the cost of waiting longer than necessary is nothing.
  const result = await runCli(
    ["models", "auth", "paste-api-key", "--provider", providerId, "--profile-id", profileId],
    { input: apiKey.trim(), timeoutMs: 90000 }
  );
  if (result.code !== 0) {
    throw new Error(`Failed to save ${providerId} key: ${result.stderr || result.stdout}`);
  }

  const data = readProviders();
  data.providers[providerId] = {
    profileId,
    configuredAt: new Date().toISOString(),
  };
  writeProviders(data);

  if (providerId === "openrouter") await applyOpenRouterChatDefault();

  await restart();
  return { ok: true };
}

// CLI fallback, useful for manual testing outside the onboarding wizard.
// Usage: echo "$API_KEY" | node daemon/providers.mjs add <provider>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, providerId] = process.argv.slice(2);
  if (cmd === "add" && providerId) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const apiKey = Buffer.concat(chunks).toString("utf8").trim();
    try {
      await setProviderKey(providerId, apiKey);
      console.log(`Saved ${providerId} key and restarted the Gateway.`);
    } catch (err) {
      // An uncaught rejection here prints a Node stack trace, which the
      // installer captures from stderr and shows to the user verbatim -- so a
      // setup wizard ended a twelve-minute install with "at Timeout._onTimeout
      // (file:///.../openclaw-cli.mjs:33:14)". Say what happened instead.
      console.error(err?.message ?? String(err));
      process.exitCode = 1;
    }
  } else {
    console.log("Usage: echo \"$API_KEY\" | node daemon/providers.mjs add <provider>");
    console.log(`Supported: ${SUPPORTED_PROVIDERS.map((p) => p.id).join(", ")}`);
    process.exitCode = 1;
  }
}
