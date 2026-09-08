// Manages the directory-watch loop as a detached background process. Same
// PID-file pattern as heartbeat-control.mjs (see that file's header for the
// reasoning) -- deliberately its own process rather than something living
// inside the Gateway, because the Gateway restarts on nearly every update
// (see CLAUDE.md's updater table: daemon/plugin changes restart it) and a
// watcher tied to that lifecycle would drop and reattach constantly instead
// of running continuously the way "auto-import while I'm away" implies.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { paths as openclawPaths } from "./openclaw-cli.mjs";
import { psyntientHome } from "./psyntient-home.mjs";

const LOOP_SCRIPT = path.join(openclawPaths.NODE_ROOT, "daemon", "directory-watch-loop.mjs");
const PID_FILE = path.join(psyntientHome(), "directory-watch.pid");
const LOG_FILE = path.join(openclawPaths.NODE_ROOT, "logs", "directory-watch.log");

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

export function ensureRunning() {
  if (isRunning()) return { ok: true, alreadyRunning: true };
  const pid = start();
  return { ok: true, pid };
}

export const paths = { LOOP_SCRIPT, PID_FILE, LOG_FILE };
