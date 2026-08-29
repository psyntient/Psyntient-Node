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
import { ensureRunning as ensureHeartbeatRunning } from "./heartbeat-control.mjs";
import { activateLocal as activateLocalVault } from "./vault.mjs";
import { ensureScaffold as ensureWorkingMemoryScaffold } from "./working-memory.mjs";
import fs from "node:fs";
import { openInBrowser } from "./open-browser.mjs";


/**
 * Builds a self-authenticating dashboard URL.
 *
 * THIS IS WHAT MAKES "NO TERMINAL" TRUE. The daemon runs locally and can read
 * the gateway token, so it hands the browser credentials directly instead of
 * opening a bare URL that greets the user with "Could not connect" and advice
 * to run `openclaw dashboard` -- which a non-developer cannot act on.
 *
 * The Control UI reads gatewayUrl/token from the location hash
 * (ui/src/app/startup-settings.ts) and then persists a device identity in
 * localStorage, so this is paid once per browser; later launches just work.
 * The hash is never sent to a server, and this only targets loopback.
 *
 * Falls back to the bare URL if the token cannot be read: a Node that opens an
 * unauthenticated dashboard is still better than one that opens nothing.
 */
function authedDashboardUrl(baseUrl) {
  try {
    const config = JSON.parse(fs.readFileSync(gatewayPaths.CONFIG_PATH, "utf8"));
    const token = config?.gateway?.auth?.token;
    const port = config?.gateway?.port ?? gatewayPaths.GATEWAY_PORT;
    if (!token) {
      return baseUrl;
    }
    const hash = new URLSearchParams({ gatewayUrl: `ws://127.0.0.1:${port}`, token }).toString();
    return `${baseUrl.replace(/#.*$/, "")}#${hash}`;
  } catch {
    return baseUrl;
  }
}

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
  // A cold start installs and starts a LaunchAgent and can take tens of
  // seconds. Without a heartbeat on stdout that is indistinguishable from a
  // hung launcher -- which is exactly how this looked before the fast path
  // below existed: 27 seconds of silence, then a browser.
  const started = Date.now();
  const ticker = setInterval(() => {
    console.log(`  still starting the Gateway... ${Math.round((Date.now() - started) / 1000)}s`);
  }, 3000);
  let gatewayStatus;
  try {
    gatewayStatus = await ensureGatewayRunning();
  } finally {
    clearInterval(ticker);
  }
  if (!gatewayStatus.alreadyRunning) {
    console.log(`Gateway ready in ${Math.round((Date.now() - started) / 1000)}s`);
  }

  // v2 serves the Interface from the Gateway itself: the Control UI fork IS
  // the Noetic Interface, built into dist/control-ui and served on the gateway
  // port. v1 ran a separate vite-preview process on 3210 from
  // Noetic_Interface/web and only fell back to the gateway when that failed --
  // so what used to be the fallback is now the whole story. One process fewer,
  // one port fewer, and no second origin to keep the auth token in sync with.
  const url = gatewayStatus.interfaceUrl || `http://127.0.0.1:${gatewayPaths.GATEWAY_PORT}/`;
  console.log(`Opening ${url}`);
  openInBrowser(authedDashboardUrl(url));
}

main().catch((err) => {
  console.error("Psyntient Node launch failed:", err.message);
  process.exitCode = 1;
});
