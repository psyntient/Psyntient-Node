// Entry point for the GUI launcher (double-click / menu bar click):
// 1. Ensure the Gateway is up and healthy.
// 2. Ensure the Noetic Interface is up, then open it in the system default
//    browser — no embedded webview, so behavior stays device-agnostic. If
//    the Interface fails to start for any reason, fall back to the raw
//    OpenClaw dashboard rather than leaving the user with nothing.
//
// BYO-key and pairing gating is NOT done here anymore — see CLAUDE.md
// "TARGET onboarding flow". The Interface itself owns that now (a real
// in-app wizard: welcome -> API key with a live connection test ->
// mandatory pairing -> Vault explanation -> chat), replacing the old
// native-macOS-dialog + non-blocking-pairing interim flow. This launcher
// unconditionally starts the Gateway and Interface; the wizard decides
// whether the user sees onboarding or goes straight to chat.
import { ensureRunning as ensureGatewayRunning, paths as gatewayPaths } from "./openclaw-control.mjs";
import { ensureRunning as ensureInterfaceRunning, url as interfaceUrl } from "./interface-control.mjs";
import { ensureRunning as ensureHeartbeatRunning } from "./heartbeat-control.mjs";
import { activateLocal as activateLocalVault } from "./vault.mjs";
import { ensureScaffold as ensureWorkingMemoryScaffold } from "./working-memory.mjs";
import { openInBrowser } from "./open-browser.mjs";

async function main() {
  // Idempotent, synchronous, spawns a detached long-running process that
  // outlives this launch script — safe to call on every launch. Started
  // first since it's independent of the Gateway/key/pairing checks below
  // (Node<->psyntient.io identity has nothing to do with LLM keys).
  ensureHeartbeatRunning();

  // Also independent of everything else — just confirms the configured
  // local vault directory exists. See CLAUDE.md section 8: entirely
  // local-Node-scoped, no psyntient.io involvement.
  activateLocalVault();

  // Independent too — just confirms Working_Memory/chat_context and
  // Working_Memory/cortex_projects exist (Phase I).
  ensureWorkingMemoryScaffold();

  console.log("Psyntient Node: checking Gateway...");
  const gatewayStatus = await ensureGatewayRunning();

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
