// Psyntient.io device pairing (spec Phase G — not built yet).
//
// isPaired() checks the REAL files already on this disk, not the
// `~/.psyntient/node.key` filename mentioned in the product note — what
// actually exists is `node_key` (an Ed25519 identity key), `node_token`
// (the Node Access Token, "nt_" prefixed), and `config.json`
// (node_id/context_id/server_url). This looks like a real prior pairing,
// not leftover debris, so this module treats it as ground truth rather
// than assuming the single-file `node.key` scheme and reporting "not
// paired" incorrectly. Flagged to the user — filename scheme needs
// reconciling before Phase G actually builds the /link-node flow.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PSYNTIENT_DIR = path.join(os.homedir(), ".psyntient");
const NODE_KEY_PATH = path.join(PSYNTIENT_DIR, "node_key");
const NODE_TOKEN_PATH = path.join(PSYNTIENT_DIR, "node_token");
const CONFIG_PATH = path.join(PSYNTIENT_DIR, "config.json");

export function isPaired() {
  if (!fs.existsSync(NODE_KEY_PATH) || !fs.existsSync(NODE_TOKEN_PATH)) return false;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return Boolean(cfg.node_id && cfg.context_id);
  } catch {
    return false;
  }
}

// Phase G's actual /link-node flow isn't specified enough to build yet —
// the callback mechanism for how the daemon receives the Node Access
// Token back from psyntient.io isn't documented. This keeps launch.mjs's
// first-run order correct (BYO key gate, then pairing gate) without
// fabricating that protocol. Non-blocking placeholder until Phase G.
export async function ensurePairedNotice() {
  if (isPaired()) return;
  console.log(
    "Node is not paired with psyntient.io (Phase G pairing flow not yet implemented) — continuing unpaired."
  );
}

export const paths = { PSYNTIENT_DIR, NODE_KEY_PATH, NODE_TOKEN_PATH, CONFIG_PATH };
