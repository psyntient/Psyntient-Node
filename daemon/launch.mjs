// Entry point for the GUI launcher (double-click / menu bar click): ensure
// the Gateway is up and healthy, then open the Interface in the system
// default browser — no embedded webview, so the app stays device-agnostic.
import { spawn } from "node:child_process";
import { ensureRunning, paths } from "./openclaw-control.mjs";

function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref();
}

async function main() {
  console.log("Psyntient Node: checking Gateway...");
  const { interfaceUrl } = await ensureRunning();
  const url = interfaceUrl || `http://127.0.0.1:${paths.GATEWAY_PORT}/`;
  console.log(`Gateway healthy. Opening ${url}`);
  openInBrowser(url);
}

main().catch((err) => {
  console.error("Psyntient Node launch failed:", err.message);
  process.exitCode = 1;
});
