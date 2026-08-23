// Interim BYO-key collection UI. The spec's real intent is that this
// happens in the WebClaw-based Noetic Interface's settings page (Phase E,
// not built yet). Until then, the GUI launcher collects it via native
// macOS dialogs so the MVP's "BYO key prompt if missing" requirement is
// met without inventing a throwaway web form. setProviderKey() in
// providers.mjs is the reusable part — this file is expected to be
// replaced by an Interface-side flow, not extended.
import { spawn } from "node:child_process";
import { SUPPORTED_PROVIDERS } from "./providers.mjs";

function osascript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", ["-e", script]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        // User cancel shows up as a non-zero exit with "User canceled" in stderr.
        resolve({ cancelled: true, stderr });
      } else {
        resolve({ cancelled: false, stdout: stdout.trim() });
      }
    });
  });
}

function asAppleScriptStringList(items) {
  return "{" + items.map((s) => JSON.stringify(s)).join(", ") + "}";
}

export async function alert(message) {
  console.log(message);
  if (process.platform !== "darwin") return;
  const script = `display alert "Psyntient Node" message ${JSON.stringify(message)}`;
  await osascript(script);
}

export async function promptForProviderKey() {
  if (process.platform !== "darwin") {
    console.log(
      "No BYO provider key configured yet. Run: node daemon/providers.mjs add <provider> (reads key from stdin)."
    );
    return null;
  }

  const labels = SUPPORTED_PROVIDERS.map((p) => p.label);
  const chooseScript = `choose from list ${asAppleScriptStringList(labels)} with prompt "A provider API key is required before you can chat. Choose a provider:" without multiple selections allowed`;
  const chosen = await osascript(chooseScript);
  if (chosen.cancelled || chosen.stdout === "false") return null;

  const provider = SUPPORTED_PROVIDERS[labels.indexOf(chosen.stdout)];
  if (!provider) return null;

  const keyScript = `display dialog "Paste your ${provider.label} API key:" default answer "" with hidden answer with title "Psyntient Node"`;
  const keyResult = await osascript(keyScript);
  if (keyResult.cancelled) return null;

  const match = keyResult.stdout.match(/text returned:(.*)$/s);
  const apiKey = match ? match[1].trim() : "";
  if (!apiKey) return null;

  return { providerId: provider.id, apiKey };
}
