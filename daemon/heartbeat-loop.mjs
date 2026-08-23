// The actual long-running process — spawned and tracked by
// heartbeat-control.mjs, never run directly. Loops forever, calling
// heartbeat() at startup and every ~5 minutes after, per AUTH_FLOW.md
// 3.1 ("Call at daemon start and every ~5 minutes... Keep it <=5 min" for
// revocation latency). Keeps looping even while unpaired — isPaired() is
// checked each cycle so pairing completed later (pairIfNeeded() is
// non-blocking, see pairing.mjs) is picked up automatically without
// needing to restart this loop.
import { heartbeat, isPaired } from "./pairing.mjs";

const INTERVAL_MS = 5 * 60 * 1000;

function timestamp() {
  return new Date().toISOString();
}

async function tick() {
  if (!isPaired()) return;
  try {
    const result = await heartbeat();
    if (result.ok) {
      console.log(`[${timestamp()}] heartbeat ok`);
    } else if (result.unpaired) {
      console.log(`[${timestamp()}] heartbeat: node unpaired (status ${result.status ?? "n/a"})`);
    } else {
      console.log(`[${timestamp()}] heartbeat: transient failure (${result.error || result.status})`);
    }
  } catch (err) {
    console.error(`[${timestamp()}] heartbeat threw: ${err.message}`);
  }
}

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[${timestamp()}] received ${signal}, stopping heartbeat loop`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log(`[${timestamp()}] heartbeat loop started, interval ${INTERVAL_MS}ms`);
await tick();
setInterval(tick, INTERVAL_MS);
