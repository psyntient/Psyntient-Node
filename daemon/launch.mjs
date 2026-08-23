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
// 3. Ensure the Noetic Interface is up, then open it in the system default
//    browser — no embedded webview, so behavior stays device-agnostic. If
//    the Interface fails to start for any reason, fall back to the raw
//    OpenClaw dashboard rather than leaving the user with nothing.
import { ensureRunning as ensureGatewayRunning, paths as gatewayPaths } from "./openclaw-control.mjs";
import { ensureRunning as ensureInterfaceRunning, url as interfaceUrl } from "./interface-control.mjs";
import { hasAnyProvider, setProviderKey } from "./providers.mjs";
import { promptForProviderKey, alert } from "./prompt-macos.mjs";
import { pairIfNeeded } from "./pairing.mjs";
import { openInBrowser } from "./open-browser.mjs";

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
  const gatewayStatus = await ensureGatewayRunning();

  const ready = await ensureProviderKeyBlocking();
  if (!ready) {
    console.log("Exiting without opening the Interface — no provider key configured.");
    return;
  }

  // Order matters: BYO key gate first, pairing second — see CLAUDE.md.
  // Not awaited: pairing is a background browser flow (open psyntient.io,
  // wait for the user to sign in/approve/cancel) and isn't required for
  // MVP chat, so it shouldn't hold up opening the Interface. See
  // pairing.mjs for why this is safe to fire-and-forget.
  pairIfNeeded();

  console.log("Starting the Noetic Interface...");
  let url;
  try {
    await ensureInterfaceRunning();
    url = interfaceUrl();
  } catch (err) {
    console.error(`Noetic Interface failed to start (${err.message}) — falling back to the OpenClaw dashboard.`);
    url = gatewayStatus.interfaceUrl || `http://127.0.0.1:${gatewayPaths.GATEWAY_PORT}/`;
  }
  console.log(`Opening ${url}`);
  openInBrowser(url);
}

main().catch((err) => {
  console.error("Psyntient Node launch failed:", err.message);
  process.exitCode = 1;
});
