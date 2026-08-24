// Onboarding wizard status (see CLAUDE.md "TARGET onboarding flow").
// Two things are tracked separately and mean different things:
//
// - hasProvider / isPaired: real, live state re-derived from ground
//   truth every call (OpenClaw's own auth store; ~/.psyntient/node.key)
//   -- never cached, can't drift.
// - completed: a one-time marker that the user has been through the
//   Vault-explanation step at least once. This is NOT a gate -- local
//   Vault activates automatically regardless -- it's purely "don't
//   show the welcome/vault pages again once the user has seen them,"
//   so a marker file is the right tool, unlike the other two.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { hasAnyProvider } from "./providers.mjs";
import { isPaired } from "./pairing.mjs";

const MARKER_PATH = path.join(os.homedir(), ".psyntient", "onboarding-complete");

function hasCompletedMarker() {
  return fs.existsSync(MARKER_PATH);
}

export function markCompleted() {
  fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
  fs.writeFileSync(MARKER_PATH, new Date().toISOString() + "\n");
  return { ok: true };
}

export async function getStatus() {
  const [hasProvider, paired] = await Promise.all([hasAnyProvider(), Promise.resolve(isPaired())]);
  return { hasProvider, isPaired: paired, completed: hasCompletedMarker() };
}

export const paths = { MARKER_PATH };

// CLI fallback, same pattern as vault.mjs/working-memory.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd] = process.argv.slice(2);
  try {
    if (cmd === "status") {
      console.log(JSON.stringify(await getStatus()));
    } else if (cmd === "complete") {
      console.log(JSON.stringify(markCompleted()));
    } else {
      console.log("Usage: node daemon/onboarding.mjs status | complete");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
