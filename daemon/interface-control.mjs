// Noetic Interface (WebClaw) process management. Deliberately NOT a
// launchd/systemd service yet — that's real follow-up scope (see
// CLAUDE.md), matching what daemon/openclaw-control.mjs does for the
// Gateway. This is a simpler detached-child-process + PID-file model:
// good enough to make the launcher self-sufficient now, upgradeable later
// without changing the public API (ensureRunning/stop/url).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { paths as openclawPaths } from "./openclaw-cli.mjs";

const INTERFACE_DIR = path.join(openclawPaths.NODE_ROOT, "Noetic_Interface", "web");
const APP_DIR = path.join(INTERFACE_DIR, "apps", "webclaw");
const SERVER_ENTRY = path.join(APP_DIR, "dist", "server", "server.js");
const PID_FILE = path.join(os.homedir(), ".psyntient", "interface.pid");
const LOG_FILE = path.join(openclawPaths.NODE_ROOT, "logs", "interface.log");
const PORT = 3210;

function isBuilt() {
  return fs.existsSync(SERVER_ENTRY);
}

function build() {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { cwd: INTERFACE_DIR, stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Interface build failed (exit ${code})`));
    });
  });
}

// The CLI's own `gateway status --json` redacts the token, so read the
// live config file directly — same approach used to configure it by hand
// while this module was being built and verified.
function getGatewayEnv() {
  const config = JSON.parse(fs.readFileSync(openclawPaths.CONFIG_PATH, "utf8"));
  const port = config?.gateway?.port ?? openclawPaths.GATEWAY_PORT;
  const token = config?.gateway?.auth?.token;
  if (!token) {
    throw new Error("No gateway auth token found in openclaw.json (gateway.auth.token)");
  }
  return {
    CLAWDBOT_GATEWAY_URL: `ws://127.0.0.1:${port}`,
    CLAWDBOT_GATEWAY_TOKEN: token,
  };
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isRunning() {
  const pid = readPid();
  return pid !== null && isProcessAlive(pid);
}

export async function start() {
  if (!isBuilt()) {
    await build();
  }
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");
  // --host 127.0.0.1: vite preview binds IPv6 ::1 only by default, which
  // ping()'s explicit 127.0.0.1 fetch (and curl, and most tooling) can't
  // reach — found by testing, not documented anywhere obvious.
  const child = spawn(
    "pnpm",
    ["-C", "apps/webclaw", "preview", "--port", String(PORT), "--host", "127.0.0.1"],
    {
      cwd: INTERFACE_DIR,
      env: { ...process.env, ...getGatewayEnv() },
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();
  fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
  fs.writeFileSync(PID_FILE, String(child.pid));
  return child.pid;
}

export function stop() {
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM");
  }
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // already gone
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ping() {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/ping`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`ping returned ${res.status}`);
  const body = await res.json();
  if (body?.ok !== true) throw new Error("ping reported not ok");
}

// Idempotent, mirrors openclaw-control.mjs's ensureRunning(): start if not
// already running, then poll until it actually answers requests.
export async function ensureRunning({ pollMs = 500, timeoutMs = 30000 } = {}) {
  if (!isRunning()) {
    await start();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await ping();
      return { ok: true, url: url() };
    } catch {
      // still starting up
    }
    await sleep(pollMs);
  }
  throw new Error(`Noetic Interface did not become healthy within ${timeoutMs}ms — check ${LOG_FILE}`);
}

export function url() {
  return `http://127.0.0.1:${PORT}/`;
}

export const paths = { INTERFACE_DIR, APP_DIR, SERVER_ENTRY, PID_FILE, LOG_FILE, PORT };
