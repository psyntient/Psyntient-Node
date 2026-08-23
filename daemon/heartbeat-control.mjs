// Manages the heartbeat loop as a detached background process, same
// PID-file pattern as interface-control.mjs (see that file's header for
// the reasoning — deliberately not a launchd/systemd service yet, that's
// shared follow-up scope for both). ensureRunning() is idempotent: safe
// to call on every daemon/launch.mjs invocation, only actually starts the
// process the first time.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { paths as openclawPaths } from "./openclaw-cli.mjs";

const LOOP_SCRIPT = path.join(openclawPaths.NODE_ROOT, "daemon", "heartbeat-loop.mjs");
const PID_FILE = path.join(os.homedir(), ".psyntient", "heartbeat.pid");
const LOG_FILE = path.join(openclawPaths.NODE_ROOT, "logs", "heartbeat.log");

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
  const child = spawn(process.execPath, [LOOP_SCRIPT], {
    cwd: openclawPaths.NODE_ROOT,
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

// Not "healthy", just "alive" — there's no HTTP endpoint to poll like the
// Gateway/Interface have; success is observable via logs/heartbeat.log.
export function ensureRunning() {
  if (isRunning()) return { ok: true, alreadyRunning: true };
  const pid = start();
  return { ok: true, pid };
}

export const paths = { LOOP_SCRIPT, PID_FILE, LOG_FILE };
