// Self-update: check what changed, do the least work that applies it, and get
// back to a known-good state if it fails.
//
// WHY THIS IS NOT AN "UPDATE PACKAGE"
// The Node updates by pulling its own git repo, so the transfer is already
// proportional to the change -- a Project Profile patch is a few KB, not a
// release image. What is NOT proportional is the BUILD: a one-line change in
// src/ still costs a 20-minute `full` unless we look at what actually moved.
// So the work here is classification, not download.
//
// ONE EXCEPTION, AND IT IS KNOWN: Cortex/Open-Claw/ is gitignored by this repo
// and the fork travels as a single binary bundle. Any fork change -- one line
// or one thousand -- re-transfers the whole ~880 KB blob, because binary
// bundles do not delta. The fix is a Psyntient-owned fork remote so Open-Claw
// pulls incrementally like everything else (RESTORE.md says the same); until
// that exists, OPENCLAW_SOURCE below is the seam where it gets swapped.
//
// ROLLBACK IS A FILE SWAP, NOT A REBUILD. Rebuilding to undo a bad update
// would cost up to 20 minutes at the exact moment the app is already broken.
// dist/ is snapshotted first -- with APFS clonefile where available, so it is
// instant and costs no disk until something diverges.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { paths as openclawPaths } from "./openclaw-cli.mjs";

const run = promisify(execFile);

const NODE_ROOT = openclawPaths.NODE_ROOT;
const OPENCLAW_DIR = path.join(NODE_ROOT, "Cortex", "Open-Claw");
const BUNDLE = path.join(NODE_ROOT, "Cortex", "openclaw-fork", "psyntient-fork.bundle");
const DIST = path.join(OPENCLAW_DIR, "dist");
const DIST_PREV = path.join(OPENCLAW_DIR, "dist.prev");
const STATE_DIR = path.join(os.homedir(), ".psyntient");
const STATE_FILE = path.join(STATE_DIR, "update-state.json");
const LOCK_FILE = path.join(STATE_DIR, "update.lock");
const GATEWAY_URL = process.env.PSYNTIENT_GATEWAY_URL || "http://127.0.0.1:18789";

/** Where the OpenClaw fork comes from. Bundle today; a real remote later. */
const OPENCLAW_SOURCE = { kind: "bundle", path: BUNDLE };

/** A lock older than this is treated as abandoned (a crashed run). */
const LOCK_STALE_MS = 30 * 60 * 1000;

// --- state ----------------------------------------------------------------

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastCheckAt: null, lastAttempt: null, autoUpdate: false };
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2) + "\n");
  return next;
}

export function setAutoUpdate(enabled) {
  return writeState({ autoUpdate: enabled === true });
}

/**
 * Single-flight lock.
 *
 * Two browser tabs refreshing with auto-update on would otherwise start two
 * updates against the same working tree, which is how a repo ends up in a
 * state no rollback anticipated.
 */
function acquireLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }), {
      flag: "wx",
    });
    return true;
  } catch {
    try {
      const held = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
      if (Date.now() - held.at > LOCK_STALE_MS) {
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
        return true;
      }
    } catch {
      // Unreadable lock: treat as held rather than stomping it.
    }
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Already gone.
  }
}

// --- classification -------------------------------------------------------

/**
 * What has to be rebuilt and restarted, given the files that changed.
 *
 * The rules are load-bearing and were verified rather than assumed:
 *  - The control UI is served from disk per request, so a UI-only change needs
 *    a rebuild and a browser reload, NOT a gateway restart.
 *  - daemon/*.mjs reach the gateway through a dynamic import() with a stable
 *    URL, and ESM caches by URL -- so daemon changes DO need a restart even
 *    though nothing is compiled.
 *  - Anything outside src/gateway/ needs the `full` profile. CLAUDE.md
 *    documents why: gatewayWatch runs one tsdown step and leaves a fresh
 *    gateway running against a stale AI runtime, which fails as tool calls
 *    dying with no mention of the build.
 */
export function classify(files) {
  const plan = { buildOpenclaw: null, buildUi: false, restart: false, reasons: [] };
  const add = (reason) => {
    if (!plan.reasons.includes(reason)) plan.reasons.push(reason);
  };

  for (const f of files) {
    if (f.startsWith("daemon/") || f.startsWith("Noetic_Interface/gateway-plugin/")) {
      plan.restart = true;
      add("daemon or plugin code changed (loaded once per gateway process)");
    } else if (f.startsWith("ui/src/") || f.startsWith("Cortex/Open-Claw/ui/")) {
      plan.buildUi = true;
      add("control UI changed");
    } else if (f.startsWith("src/gateway/")) {
      plan.buildOpenclaw = plan.buildOpenclaw === "full" ? "full" : "gatewayWatch";
      plan.buildUi = true; // gatewayWatch wipes dist/control-ui and does not repopulate it
      plan.restart = true;
      add("gateway source changed");
    } else if (f.startsWith("src/") || f.startsWith("packages/") || f.startsWith("plugins/")) {
      plan.buildOpenclaw = "full";
      plan.buildUi = true;
      plan.restart = true;
      add("agent runtime, packages or plugins changed (full build required)");
    }
  }
  if (plan.reasons.length === 0) plan.reasons.push("documentation or data only");
  return plan;
}

// --- git helpers ----------------------------------------------------------

async function git(cwd, args) {
  const { stdout } = await run("git", ["-C", cwd, ...args], { maxBuffer: 32 * 1024 * 1024 });
  return stdout.trim();
}

async function isDirty(cwd) {
  return (await git(cwd, ["status", "--porcelain"])).length > 0;
}

/**
 * What an update would do, without doing any of it.
 *
 * Reports the Open-Claw side separately, because that is where the build cost
 * lives and where the change is invisible to the Node repo's own file list
 * (the fork arrives as one opaque bundle blob).
 */
export async function check() {
  writeState({ lastCheckAt: new Date().toISOString() });

  const branch = await git(NODE_ROOT, ["rev-parse", "--abbrev-ref", "HEAD"]);
  await git(NODE_ROOT, ["fetch", "--quiet", "origin", branch]);
  const local = await git(NODE_ROOT, ["rev-parse", "HEAD"]);
  const remote = await git(NODE_ROOT, ["rev-parse", `origin/${branch}`]);

  if (local === remote) {
    return { ok: true, upToDate: true, current: local, branch };
  }

  const nodeFiles = (await git(NODE_ROOT, ["diff", "--name-only", `${local}..${remote}`]))
    .split("\n")
    .filter(Boolean);
  const stat = await git(NODE_ROOT, ["diff", "--shortstat", `${local}..${remote}`]);
  const commits = (await git(NODE_ROOT, ["log", "--oneline", `${local}..${remote}`]))
    .split("\n")
    .filter(Boolean);

  // The Open-Claw side cannot be classified from the Node repo's file list --
  // every fork change looks like one bundle blob. Ask the bundle itself what
  // commits it carries that this checkout does not.
  let openclawFiles = [];
  let openclawCommits = [];
  if (nodeFiles.some((f) => f.endsWith(".bundle"))) {
    try {
      const head = await git(OPENCLAW_DIR, ["rev-parse", "HEAD"]);
      const listed = await git(OPENCLAW_DIR, ["bundle", "list-heads", BUNDLE]);
      const tip = listed.split(/\s+/)[0];
      if (tip && tip !== head) {
        openclawFiles = (await git(OPENCLAW_DIR, ["diff", "--name-only", `${head}..${tip}`]))
          .split("\n")
          .filter(Boolean);
        openclawCommits = (await git(OPENCLAW_DIR, ["log", "--oneline", `${head}..${tip}`]))
          .split("\n")
          .filter(Boolean);
      }
    } catch {
      // The incoming bundle may carry commits this checkout has never seen, so
      // it cannot always be diffed before fetching. Assume the expensive plan
      // rather than under-building.
      openclawFiles = ["src/unknown"];
    }
  }

  const plan = classify([...nodeFiles, ...openclawFiles]);
  const state = readState();
  const failedBefore = state.lastAttempt?.sha === remote && state.lastAttempt?.ok === false;

  return {
    ok: true,
    upToDate: false,
    branch,
    current: local,
    target: remote,
    commits,
    openclawCommits,
    files: nodeFiles,
    openclawFiles,
    stat,
    plan,
    // Surfaced rather than enforced here: the UI shows why an update is
    // blocked, and a person can still force it.
    dirty: await isDirty(NODE_ROOT),
    failedBefore,
  };
}

// --- apply ----------------------------------------------------------------

/** Clone dist/ copy-on-write where the filesystem supports it. */
async function snapshotDist() {
  if (!fs.existsSync(DIST)) return false;
  await fs.promises.rm(DIST_PREV, { recursive: true, force: true });
  try {
    await run("cp", ["-Rc", DIST, DIST_PREV]);
  } catch {
    await run("cp", ["-R", DIST, DIST_PREV]);
  }
  return true;
}

async function restoreDist() {
  if (!fs.existsSync(DIST_PREV)) return false;
  await fs.promises.rm(DIST, { recursive: true, force: true });
  await fs.promises.rename(DIST_PREV, DIST);
  return true;
}

async function gatewayCli(args) {
  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: path.join(os.homedir(), ".psyntient", "openclaw-state"),
  };
  env.OPENCLAW_CONFIG_PATH = path.join(env.OPENCLAW_STATE_DIR, "openclaw.json");
  return run("node", [path.join(OPENCLAW_DIR, "openclaw.mjs"), ...args], {
    cwd: OPENCLAW_DIR,
    env,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Up means: serving HTTP and answering as the gateway, not merely a live port. */
async function healthy({ tries = 15, delayMs = 2000, streak = 2 } = {}) {
  // Consecutive successes, not one. A restarting LaunchAgent answers during
  // the changeover and then goes away again -- observed exactly that: a health
  // check passed, and the gateway was down seconds later. One 200 proves a
  // socket answered, not that the service settled.
  let run = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(4000) });
      run = res.ok ? run + 1 : 0;
      if (run >= streak) return true;
    } catch {
      run = 0;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/**
 * Apply the update, rolling back on any failure.
 *
 * @param {(stage: {stage: string, detail?: string, pct?: number}) => void} [onProgress]
 */
export async function apply({ onProgress, force = false } = {}) {
  const say = (stage, detail, pct) => onProgress?.({ stage, detail, pct });

  if (!acquireLock()) {
    return { ok: false, error: "An update is already running." };
  }

  let preSha = null;
  let snapped = false;
  try {
    say("checking", undefined, 2);
    const status = await check();
    if (status.upToDate) {
      return { ok: true, upToDate: true };
    }
    if (status.dirty && !force) {
      return {
        ok: false,
        // Never stash silently: a person's local edits ending up somewhere
        // they will not look for them is worse than refusing to update.
        error:
          "This Node has uncommitted local changes. Commit or revert them first, " +
          "or force the update to proceed.",
      };
    }
    if (status.failedBefore && !force) {
      return {
        ok: false,
        error: `Update to ${status.target.slice(0, 8)} already failed once and was not retried automatically.`,
      };
    }

    preSha = status.current;
    const plan = status.plan;

    say("snapshot", "saving the current build", 8);
    snapped = await snapshotDist();

    say("pulling", `${status.commits.length} commit(s)`, 15);
    // Fast-forward only: a merge commit created by an updater is a repo state
    // nobody asked for and rollback cannot reason about.
    await git(NODE_ROOT, ["merge", "--ff-only", `origin/${status.branch}`]);

    if (status.files.some((f) => f.endsWith(".bundle")) && OPENCLAW_SOURCE.kind === "bundle") {
      say("fork", "restoring the OpenClaw fork", 25);
      const branch = await git(OPENCLAW_DIR, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (branch !== "psyntient") {
        throw new Error(
          `Open-Claw is on "${branch}", not the psyntient fork branch; refusing to update it.`,
        );
      }
      // No destination refspec. RESTORE.md fetches `psyntient:psyntient`, which
      // works from a fresh clone but git REFUSES on a live Node -- you cannot
      // fetch into the branch that is checked out. Fetch to FETCH_HEAD and
      // fast-forward the working branch instead.
      await git(OPENCLAW_DIR, ["fetch", OPENCLAW_SOURCE.path, "psyntient"]);
      await git(OPENCLAW_DIR, ["merge", "--ff-only", "FETCH_HEAD"]);
    }

    if (plan.buildOpenclaw) {
      const full = plan.buildOpenclaw === "full";
      // A `full` build is ~20 minutes of silence. Without a ticking elapsed
      // time the bar sits at one number long enough to read as a hang, and a
      // user kills an update that was working -- which is how a Node ends up
      // half-updated.
      const startedAt = Date.now();
      const expected = full ? 20 * 60 * 1000 : 30 * 1000;
      const tick = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const mins = Math.floor(elapsed / 60000);
        const secs = Math.floor((elapsed % 60000) / 1000);
        say(
          "building",
          `${full ? "full build" : "gateway build"} — ${mins}m ${String(secs).padStart(2, "0")}s elapsed`,
          // Eased toward the end of this stage's range, never reaching it, so
          // motion continues even though the build cannot report from inside.
          35 + Math.min(0.95, elapsed / expected) * 30,
        );
      }, 1000);
      try {
        await run(
          "node",
          [path.join(OPENCLAW_DIR, "scripts", "build-all.mjs"), plan.buildOpenclaw],
          { cwd: OPENCLAW_DIR, maxBuffer: 64 * 1024 * 1024 },
        );
      } finally {
        clearInterval(tick);
      }
    }

    if (plan.buildUi) {
      say("building-ui", "rebuilding the interface", 70);
      await run("node", [path.join(OPENCLAW_DIR, "scripts", "ui.js"), "build"], {
        cwd: OPENCLAW_DIR,
        maxBuffer: 64 * 1024 * 1024,
      });
    }

    if (plan.restart) {
      say("restarting", "restarting the Gateway", 85);
      await gatewayCli(["gateway", "restart"]);
      say("verifying", "waiting for the Gateway", 92);
      if (!(await healthy())) {
        throw new Error("The Gateway did not come back after the update.");
      }
    }

    const now = await git(NODE_ROOT, ["rev-parse", "HEAD"]);
    writeState({ lastAttempt: { sha: now, at: new Date().toISOString(), ok: true } });
    say("done", undefined, 100);
    // dist.prev is kept: it is the only fast way back if the new build turns
    // out to be broken in a way a health check cannot see.
    return { ok: true, from: preSha, to: now, plan };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    say("rolling-back", message, 95);
    const rollback = { attempted: true, ok: false };
    try {
      if (preSha) await git(NODE_ROOT, ["reset", "--hard", preSha]);
      if (snapped) await restoreDist();
      await gatewayCli(["gateway", "restart"]).catch(() => {});
      rollback.ok = await healthy();
    } catch (rollbackErr) {
      rollback.error = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
    }
    writeState({
      lastAttempt: { sha: null, at: new Date().toISOString(), ok: false, error: message },
    });
    return { ok: false, error: message, rollback };
  } finally {
    releaseLock();
  }
}

export default { check, apply, readState, setAutoUpdate, classify };

// --- CLI ------------------------------------------------------------------
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [, , cmd, ...rest] = process.argv;
  const go = async () => {
    if (cmd === "apply") {
      return apply({
        force: rest.includes("--force"),
        onProgress: (s) => console.error(`  [${s.pct ?? "-"}%] ${s.stage} ${s.detail ?? ""}`),
      });
    }
    if (cmd === "auto") return setAutoUpdate(rest[0] !== "off");
    if (cmd === "state") return readState();
    return check();
  };
  go()
    .then((out) => console.log(JSON.stringify(out, null, 2)))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
