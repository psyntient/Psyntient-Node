// Shared low-level runner for the bundled OpenClaw CLI. Every daemon module
// that needs to shell out to `openclaw` goes through here so the isolation
// rules (Cortex/Open-Claw cwd, pinned state/config env, process.execPath
// instead of a PATH-dependent "node") live in exactly one place.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const NODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPEN_CLAW_DIR = path.join(NODE_ROOT, "Cortex", "Open-Claw");
const STATE_DIR = path.join(os.homedir(), ".psyntient", "openclaw-state");
const CONFIG_PATH = path.join(STATE_DIR, "openclaw.json");
const GATEWAY_PORT = 18789;

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
