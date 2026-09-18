// The actual long-running process -- spawned and tracked by
// directory-watch-control.mjs, never run directly. Loops forever, scanning
// every project with a bound directory every INTERVAL_MS.
//
// Polling, not fs.watch(). A watched folder can be anything a researcher's
// own tooling writes into -- a network share, an external drive, a folder
// an instrument's export step writes to in one shot -- and fs.watch's
// reliability varies across exactly those cases (missed events on network
// filesystems is the well-known failure). A scan is boring and it always
// eventually notices a new file, which matters more here than reacting
// within milliseconds.
import { listProjects } from "./working-memory.mjs";
import { scanAllWatchedProjects } from "./project-watch.mjs";
import { syncAllProjectsToRepo } from "./repo-sync.mjs";

const INTERVAL_MS = 60 * 1000;

function timestamp() {
  return new Date().toISOString();
}

async function tick() {
  let results;
  try {
    results = scanAllWatchedProjects(listProjects);
  } catch (err) {
    console.error(`[${timestamp()}] scan threw: ${err.message}`);
    return;
  }
  for (const r of results) {
    if (!r.ok) {
      console.error(`[${timestamp()}] ${r.projectId}: ${r.error}`);
      continue;
    }
    if (!r.watched) continue;
    if (r.error) {
      console.log(`[${timestamp()}] ${r.projectId}: ${r.error} (${r.watchDir})`);
      continue;
    }
    if (r.imported.length > 0) {
      console.log(
        `[${timestamp()}] ${r.projectId}: imported ${r.imported.length} file(s) from ${r.watchDir}`,
      );
    }
    if (r.mirrored?.length > 0) {
      console.log(
        `[${timestamp()}] ${r.projectId}: mirror-deleted ${r.mirrored.length} file(s) that vanished from ${r.watchDir}`,
      );
    }
    for (const e of r.errors) {
      console.error(`[${timestamp()}] ${r.projectId}: failed to import ${e.source}: ${e.error}`);
    }
  }
  await depositTick();
}

/**
 * The second half of the chain: Vault -> the researcher's project in the Repo.
 *
 * AFTER the import scan and in the same tick, so a file that lands in a
 * watched folder reaches the repository without anything else being run. Only
 * projects that opted in are touched; syncAllProjectsToRepo skips the rest
 * without a network call, so this costs nothing for a Node that deposits
 * nothing.
 *
 * Failures are logged and the loop continues. This runs unattended for weeks,
 * and the Repo being briefly unreachable is an ordinary event -- the next tick
 * retries, and the sync is idempotent by content, so retrying is free.
 */
async function depositTick() {
  let results;
  try {
    results = await syncAllProjectsToRepo(listProjects);
  } catch (err) {
    console.error(`[${timestamp()}] repo deposit threw: ${err.message}`);
    return;
  }
  for (const r of results) {
    if (r.error) {
      console.error(`[${timestamp()}] ${r.projectId}: repo deposit: ${r.error}`);
    }
    if (r.uploaded.length > 0) {
      console.log(
        `[${timestamp()}] ${r.projectId}: deposited ${r.uploaded.length} file(s) to the Repo`,
      );
    }
    for (const f of r.failed) {
      console.error(
        `[${timestamp()}] ${r.projectId}: failed to deposit ${f.filename}: ${f.error}`,
      );
    }
  }
}

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[${timestamp()}] received ${signal}, stopping directory-watch loop`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[${timestamp()}] directory-watch loop started, interval ${INTERVAL_MS}ms`);
await tick();
setInterval(tick, INTERVAL_MS);
