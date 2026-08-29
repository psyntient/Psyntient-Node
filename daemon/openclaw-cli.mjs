// Shared low-level runner for the bundled OpenClaw CLI. Every daemon module
// that needs to shell out to `openclaw` goes through here so the isolation
// rules (Cortex/Open-Claw cwd, pinned state/config env, process.execPath
// instead of a PATH-dependent "node") live in exactly one place.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const NODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPEN_CLAW_DIR = path.join(NODE_ROOT, "Cortex", "Open-Claw");
// WHY THESE ARE OVERRIDABLE
//
// They were hardcoded to the default location, and runCli additionally FORCED
// them into every child's environment -- so a Node installed anywhere else, or
// a second Node on the same machine, silently operated on the default Node's
// state instead of its own. Not a theoretical concern: the installer's
// sandbox mode exists to isolate a test install, and this defeated it
// completely. A sandboxed install stored its provider key in the real Node's
// auth store and restarted the real Node's gateway, with no error and nothing
// on screen suggesting the wrong Node had been touched.
//
// Unset, every value is the product default, so an ordinary single-Node
// install behaves exactly as before.
const STATE_DIR =
  (process.env.OPENCLAW_STATE_DIR || "").trim() ||
  path.join(os.homedir(), ".psyntient", "openclaw-state");
const CONFIG_PATH =
  (process.env.OPENCLAW_CONFIG_PATH || "").trim() || path.join(STATE_DIR, "openclaw.json");
// The port belongs to the config, not to this module. Read it when it is
// there: a Node on a non-default port was otherwise health-checked, restarted
// and linked against 18789 -- another Node's port, or nothing at all.
const GATEWAY_PORT = readConfiguredPort(CONFIG_PATH);

function readConfiguredPort(configPath) {
  const fromEnv = Number((process.env.OPENCLAW_GATEWAY_PORT || "").trim());
  if (Number.isInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  try {
    const port = JSON.parse(fs.readFileSync(configPath, "utf8"))?.gateway?.port;
    if (Number.isInteger(port) && port > 0) {
      return port;
    }
  } catch {
    // No config yet (a first run, before configure) or unreadable: the product
    // default is the right answer, and it is what the installer writes.
  }
  return 18789;
}

export function runCli(args, { timeoutMs = 20000, input } = {}) {
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

    if (input !== undefined) {
      child.stdin.write(input.endsWith("\n") ? input : input + "\n");
    }
    child.stdin.end();
  });
}

export function parseJsonOutput(result, args) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `openclaw ${args.join(" ")} did not return valid JSON (exit ${result.code}): ${result.stderr || result.stdout}`
    );
  }
}

export async function jsonCommand(args, opts) {
  const result = await runCli([...args, "--json"], opts);
  return parseJsonOutput(result, args);
}

export const paths = { NODE_ROOT, OPEN_CLAW_DIR, STATE_DIR, CONFIG_PATH, GATEWAY_PORT };
