// Entry point for the GUI launcher (double-click / menu bar click):
// 1. Ensure the Gateway is up and healthy.
// 2. Blocking gate: if no usable provider key exists, chat must not become
//    available this session. Require a key (retrying on a mechanically
//    rejected/invalid entry) before opening anything; an explicit cancel
//    exits without opening the browser at all, rather than opening a
//    dashboard that can't chat. Once a valid key is configured, this gate
//    never shows again — see hasAnyProvider() in providers.mjs, which
//    checks OpenClaw's own auth store, not a local flag, so it can't get
//    out of sync with reality. (Product decision — this is the same
//    contract Settings must honor once Phase E adds key rotation there.)
// 3. Open the Interface in the system default browser — no embedded
//    webview, so behavior stays device-agnostic.
import { spawn } from "node:child_process";
import { ensureRunning, paths } from "./openclaw-control.mjs";
import { hasAnyProvider, setProviderKey } from "./providers.mjs";
import { promptForProviderKey, alert } from "./prompt-macos.mjs";
import { ensurePairedNotice } from "./pairing.mjs";

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref();
}

// Returns true once a usable key is configured, false if the user declined.
async function ensureProviderKeyBlocking() {
  if (await hasAnyProvider()) return true;

  for (;;) {
    console.log("No provider key configured — this is required before chat is available.");
    const entry = await promptForProviderKey();
    if (!entry) {
      await alert(
        "A provider API key is required before Psyntient Node can chat. Relaunch when you're ready to add one."
      );
      return false;
    }
    try {
      await setProviderKey(entry.providerId, entry.apiKey);
      console.log(`Saved ${entry.providerId} key.`);
      return true;
    } catch (err) {
      console.error(`Key rejected: ${err.message}`);
      await alert(`That key couldn't be saved (${err.message}). Please try again.`);
      // loop: re-prompt rather than silently continuing without a key
    }
  }
}

async function main() {
  console.log("Psyntient Node: checking Gateway...");
  const { interfaceUrl: initialUrl } = await ensureRunning();

  const ready = await ensureProviderKeyBlocking();
  if (!ready) {
    console.log("Exiting without opening the Interface — no provider key configured.");
    return;
  }

  // Order matters: BYO key gate first, pairing second — see CLAUDE.md.
  await ensurePairedNotice();

  const { interfaceUrl } = await ensureRunning();
  const url = interfaceUrl || initialUrl || `http://127.0.0.1:${paths.GATEWAY_PORT}/`;
  console.log(`Opening ${url}`);
  openInBrowser(url);
}

main().catch((err) => {
  console.error("Psyntient Node launch failed:", err.message);
  process.exitCode = 1;
});
