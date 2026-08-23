// Gateway service management (install/start/stop/status/health), wrapping
// OpenClaw's own `gateway` CLI subcommands rather than reimplementing
// launchd/systemd/schtasks supervision ourselves — see CLAUDE.md.
import { jsonCommand, paths } from "./openclaw-cli.mjs";

const { GATEWAY_PORT } = paths;

export function status() {
  return jsonCommand(["gateway", "status"]);
}

export function health(opts = {}) {
  return jsonCommand(["gateway", "health", "--port", String(GATEWAY_PORT)], opts);
}

// Service lifecycle operations (stop/drain/relaunch/health-confirm) take
// much longer than a status/health query — observed ~38s for a plain
// restart — so these get a generous timeout of their own rather than the
// default meant for quick queries.
const LIFECYCLE_TIMEOUT_MS = 60000;

export function install({ force = false } = {}) {
  const args = ["gateway", "install", "--port", String(GATEWAY_PORT)];
  if (force) args.push("--force");
  return jsonCommand(args, { timeoutMs: LIFECYCLE_TIMEOUT_MS });
}

export function start() {
  return jsonCommand(["gateway", "start"], { timeoutMs: LIFECYCLE_TIMEOUT_MS });
}

export function stop() {
  return jsonCommand(["gateway", "stop"], { timeoutMs: LIFECYCLE_TIMEOUT_MS });
}

export function restart() {
  return jsonCommand(["gateway", "restart"], { timeoutMs: LIFECYCLE_TIMEOUT_MS });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Idempotent: install if missing, start if not running, wait for health.
// This is what the GUI launcher and any future daemon entry point should
// call — never call install/start directly from outside this module.
export async function ensureRunning({ pollMs = 500, timeoutMs = 20000 } = {}) {
  let current = await status();
  if (!current?.service?.loaded) {
    await install({ force: false });
    current = await status();
  }
  if (current?.service?.runtime?.status !== "running") {
    await start();
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const h = await health({ timeoutMs: Math.max(2000, deadline - Date.now()) });
      if (h?.ok === true) {
        const finalStatus = await status();
        return { ok: true, health: h, interfaceUrl: finalStatus?.gateway?.controlUiLinks?.httpUrl };
      }
    } catch {
      // gateway still coming up; keep polling
    }
    await sleep(pollMs);
  }
  throw new Error(`Gateway did not become healthy within ${timeoutMs}ms`);
}

export { paths };
