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

const PROVIDERS_PATH = path.join(os.homedir(), ".psyntient", "providers.json");

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
// Was "openrouter/google/gemini-3.7-flash" -- switched 2026-08-25.
// Real, measured problem: every message reprocesses the full system
// prompt from scratch, no prompt-cache reuse at all (a one-word reply on
// a ~20-28K-token system prompt showed cacheRead:0, cacheWrite:0 either
// way). anthropic/claude-3-haiku is the closest real per-token cost
// match to Gemini 3.7 Flash of any Claude model on OpenRouter --
// verified live against OpenRouter's own pricing API: ~0.67x Gemini 3.7
// Flash on both prompt and completion pricing (consistently cheaper);
// the newer claude-haiku-4.5 is ~2.67x *more* expensive, not a close
// match despite being the more obvious "same tier" name.
//
// IMPORTANT, corrected 2026-08-25: this switch does NOT fix the caching
// problem. Initially assumed Claude-via-OpenRouter already gets
// cache_control support (OpenClaw's compat matrix has a rule for it),
// but a live two-message-same-session test with claude-3-haiku showed
// zero cache activity too. Deeper investigation found OpenClaw HAD this
// working (openclaw/openclaw#9600, fixed via #17473 in Feb 2026) and it
// has since regressed -- the wiring still looks present in current
// source but empirically doesn't fire. See
// openclaw/openclaw#129005 (retitled to reflect the regression finding)
// for the full trail. So: this switch is a real cost reduction
// (~0.67x), not a caching/latency fix -- that needs an upstream fix to
// the regression, tracked in the issue above.
//
// Known tradeoff, not free: claude-3-haiku is an older model generation
// than Gemini 3.7 Flash or claude-haiku-4.5 -- picked for cost-match,
// not raw capability.
const OPENROUTER_CHAT_DEFAULT = "openrouter/anthropic/claude-3-haiku";

// Only applies the Flash default when model.primary is still the stock value
// -- never overwrites a value the user (or a later Settings change)
// deliberately set, including a deliberate switch back to "openrouter/auto".
// Verified live: `openclaw config get <path> --json` returns the raw value
// directly (e.g. "openrouter/auto"), NOT wrapped in an object -- compare
// `current` itself, not `current?.value`.
//
// 30s timeout, not runCli's 20s default: observed live during this feature's
// own implementation that plain `config get`/`config set` calls -- normally
// fast -- occasionally ran past 20s under real network conditions (unrelated
// npm/registry traffic contending for the same sqlite-backed config store).
export async function applyOpenRouterChatDefault() {
  const current = await jsonCommand(["config", "get", "agents.defaults.model.primary"], { timeoutMs: 30000 });
  if (!OPENROUTER_STOCK_DEFAULTS.has(current)) return { changed: false };
  const result = await runCli(["config", "set", "agents.defaults.model.primary", OPENROUTER_CHAT_DEFAULT], { timeoutMs: 30000 });
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

  const result = await runCli(
    ["models", "auth", "paste-api-key", "--provider", providerId, "--profile-id", profileId],
    { input: apiKey.trim() }
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
    await setProviderKey(providerId, apiKey);
    console.log(`Saved ${providerId} key and restarted the Gateway.`);
  } else {
    console.log("Usage: echo \"$API_KEY\" | node daemon/providers.mjs add <provider>");
    console.log(`Supported: ${SUPPORTED_PROVIDERS.map((p) => p.id).join(", ")}`);
    process.exitCode = 1;
  }
}
