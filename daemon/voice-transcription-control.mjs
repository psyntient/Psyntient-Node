// Voice transcription worker process management. Mirrors
// interface-control.mjs's detached-child-process + PID-file model exactly
// (same reasoning: good enough now, upgradeable to a real service later
// without changing the public API). Unlike the Gateway/Interface, this is
// started lazily on first mic use, not eagerly at Node launch -- most users
// never touch voice input, and the worker holds a resident ~150MB model in
// memory once running.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { paths as openclawPaths } from "./openclaw-cli.mjs";
import { paths as voicePaths } from "./voice-transcription.mjs";

const SCRIPT_PATH = path.join(openclawPaths.NODE_ROOT, "daemon", "voice-transcription.mjs");
const PID_FILE = path.join(os.homedir(), ".psyntient", "voice-transcription.pid");
const LOG_FILE = path.join(openclawPaths.NODE_ROOT, "logs", "voice-transcription.log");
const PORT = voicePaths.PORT;

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

export function start() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [SCRIPT_PATH, "serve"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
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
  const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`health check returned ${res.status}`);
  const body = await res.json();
  if (body?.ok !== true) throw new Error("health check reported not ok");
}

// First-ever call pays the model-download (~150MB) + model-load cost, which
// can be tens of seconds -- later calls are near-instant since the worker
// (and its resident model) stays warm across requests.
export async function ensureRunning({ pollMs = 500, timeoutMs = 120000 } = {}) {
  if (!isRunning()) {
    start();
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await ping();
      return { ok: true, url: url() };
    } catch {
      // still starting up / downloading / loading the model
    }
    await sleep(pollMs);
  }
  throw new Error(`Voice transcription worker did not become healthy within ${timeoutMs}ms — check ${LOG_FILE}`);
}

export function url() {
  return `http://127.0.0.1:${PORT}/`;
}

export const paths = { SCRIPT_PATH, PID_FILE, LOG_FILE, PORT };

async function main() {
  const [, , cmd] = process.argv;
  if (cmd === "ensure-running") {
    const result = await ensureRunning();
    console.log(JSON.stringify(result));
    return;
  }
  if (cmd === "stop") {
    stop();
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  if (cmd === "status") {
    console.log(JSON.stringify({ running: isRunning() }));
    return;
  }
  console.error("Usage: node voice-transcription-control.mjs <ensure-running|stop|status>");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
