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
export async function hasAnyProvider() {
  const result = await jsonCommand(["models", "auth", "list"]);
  return Array.isArray(result?.profiles) && result.profiles.length > 0;
}

// Add, replace, or rotate — one path for all three (Settings must reuse
// this exact function, not a second implementation; see CLAUDE.md). If a
// profile already exists for this provider, its key is overwritten in
// place rather than leaving the old one behind alongside a new profile.
export async function setProviderKey(providerId, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("API key must not be empty");
  }

  const existing = await jsonCommand(["models", "auth", "list", "--provider", providerId]);
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

  await restart();
  return { ok: true };
}

// CLI fallback for platforms without a native prompt (see prompt-macos.mjs).
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
