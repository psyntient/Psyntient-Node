// Thin wrapper around the bundled OpenClaw CLI's own gateway service
// management (install/start/stop/status/health). Never shells out to a
// bare `openclaw` — always the checked-in copy at Cortex/Open-Claw, with
// state/config pinned to ~/.psyntient/openclaw-state per CLAUDE.md.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const NODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPEN_CLAW_DIR = path.join(NODE_ROOT, "Cortex", "Open-Claw");
const STATE_DIR = path.join(os.homedir(), ".psyntient", "openclaw-state");
const CONFIG_PATH = path.join(STATE_DIR, "openclaw.json");
const GATEWAY_PORT = 18789;

function runCli(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    // process.execPath, not the bare "node" — GUI-launched processes (Finder
    // double-click) get a minimal PATH that may not resolve "node" at all.
    const child = spawn(process.execPath, ["openclaw.mjs", ...args], {
      cwd: OPEN_CLAW_DIR,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_CONFIG_PATH: CONFIG_PATH,
      },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`openclaw ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseJsonOutput(result, args) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `openclaw ${args.join(" ")} did not return valid JSON (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }
}

async function jsonCommand(args, opts) {
  const result = await runCli([...args, "--json"], opts);
  return parseJsonOutput(result, args);
}

export function status() {
  return jsonCommand(["gateway", "status"]);
}

export function health(opts = {}) {
  return jsonCommand(["gateway", "health", "--port", String(GATEWAY_PORT)], opts);
}

export function install({ force = false } = {}) {
  const args = ["gateway", "install", "--port", String(GATEWAY_PORT)];
  if (force) args.push("--force");
  return jsonCommand(args);
}

export function start() {
  return jsonCommand(["gateway", "start"]);
}

export function stop() {
  return jsonCommand(["gateway", "stop"]);
}

export function restart() {
  return jsonCommand(["gateway", "restart"]);
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

export const paths = { NODE_ROOT, OPEN_CLAW_DIR, STATE_DIR, CONFIG_PATH, GATEWAY_PORT };
