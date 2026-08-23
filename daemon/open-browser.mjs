import { spawn } from "node:child_process";

export function openInBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url];
  spawn(cmd, args, { shell: platform === "win32", stdio: "ignore", detached: true }).unref();
}
