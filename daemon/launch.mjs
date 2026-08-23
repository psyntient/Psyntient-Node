// Entry point for the GUI launcher (double-click / menu bar click):
// 1. Ensure the Gateway is up and healthy.
// 2. If no LLM provider key is configured yet, collect one (MVP requirement).
// 3. Open the Interface in the system default browser — no embedded
//    webview, so behavior stays device-agnostic.
import { spawn } from "node:child_process";
import { ensureRunning, paths } from "./openclaw-control.mjs";
import { hasAnyProvider, setProviderKey } from "./providers.mjs";
import { promptForProviderKey } from "./prompt-macos.mjs";

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref();
}

async function main() {
  console.log("Psyntient Node: checking Gateway...");
  let { interfaceUrl } = await ensureRunning();

  if (!(await hasAnyProvider())) {
    console.log("No BYO provider key configured yet — prompting...");
    const entry = await promptForProviderKey();
    if (entry) {
      await setProviderKey(entry.providerId, entry.apiKey);
      console.log(`Saved ${entry.providerId} key. Restarting Gateway...`);
      const result = await ensureRunning();
      interfaceUrl = result.interfaceUrl || interfaceUrl;
    } else {
      console.log("No key entered — continuing without one. Interface may prompt again later.");
    }
  }

  const url = interfaceUrl || `http://127.0.0.1:${paths.GATEWAY_PORT}/`;
  console.log(`Opening ${url}`);
  openInBrowser(url);
}

main().catch((err) => {
  console.error("Psyntient Node launch failed:", err.message);
  process.exitCode = 1;
});
