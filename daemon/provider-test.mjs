// Live connection test for a just-saved provider key (onboarding wizard
// step 2 — see CLAUDE.md "TARGET onboarding flow"). Closes a real gap:
// paste-api-key never validated a key against the real provider API
// before this existed, so a billing-exhausted or wrong key was
// previously only discovered when the user actually tried to chat.
//
// Runs a one-shot, isolated inference call (openclaw infer model run)
// rather than a real chat turn -- doesn't touch any session/thread
// history, doesn't leave a message anyone sees.
import { runCli } from "./openclaw-cli.mjs";

const TEST_TIMEOUT_MS = 45000;

export async function testProviderConnection(providerId) {
  const result = await runCli(
    [
      "infer", "model", "run",
      "--gateway",
      "--model", `${providerId}/auto`,
      "--prompt", "Reply with exactly one word: OK",
      "--json",
    ],
    { timeoutMs: TEST_TIMEOUT_MS },
  );

  if (result.code !== 0) {
    // Failure output isn't guaranteed to be JSON even with --json --
    // observed as a plain error string on the real CLI. Fall back to
    // whatever text is available rather than throwing a parse error.
    let message = (result.stderr || result.stdout || "").trim();
    try {
      const parsed = JSON.parse(message);
      message = parsed.error || message;
    } catch {
      // not JSON -- use the raw text as-is
    }
    return { ok: false, error: message || `exit code ${result.code}` };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return { ok: true, model: parsed.model, provider: parsed.provider };
  } catch {
    return { ok: false, error: "Connection test returned an unparseable response." };
  }
}

// CLI fallback. Usage: node daemon/provider-test.mjs <providerId>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [providerId] = process.argv.slice(2);
  if (!providerId) {
    console.log("Usage: node daemon/provider-test.mjs <providerId>");
    process.exitCode = 1;
  } else {
    const result = await testProviderConnection(providerId);
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }
}
