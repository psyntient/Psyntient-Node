// Where this Node keeps the state that is NOT part of the install tree:
// pairing, onboarding markers, update state, heartbeat pid, scan caches.
//
// WHY THIS IS OVERRIDABLE
// It was hardcoded to ~/.psyntient, which meant two Nodes on one machine shared
// one identity: a second install would read and overwrite the first's node.key,
// silently unpairing a working Node. That is not only a testing problem -- the
// product's own answer to "reach my Vault from elsewhere" is to run another
// Node, and nothing stopped two of them colliding here.
//
// PSYNTIENT_HOME overrides it. Unset, the product default is unchanged, so
// existing installs see no difference.
import os from "node:os";
import path from "node:path";

export function psyntientHome() {
  const override = (process.env.PSYNTIENT_HOME || "").trim();
  return override || path.join(os.homedir(), ".psyntient");
}

export default { psyntientHome };
