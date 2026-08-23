// Neural Vault storage management (Phase H). Entirely local-Node-scoped —
// see CLAUDE.md section 8: vaults are never registered with psyntient.io,
// by design, permanently. All config here stays on this machine; nothing
// in this file makes a network call.
//
// Cloud (Google Drive) is a real, planned mode (see SUPPORTED_CLOUD_PROVIDERS
// and switchToCloud below) but not wired up to a real OAuth flow yet —
// that needs actual Google Cloud OAuth client credentials (Client ID/
// Secret), which don't exist in this repo. switchToCloud() throws clearly
// rather than pretending to work. Local mode is fully real and active.
import fs from "node:fs";
import path from "node:path";
import { paths as openclawPaths } from "./openclaw-cli.mjs";

const VAULT_DIR = path.join(openclawPaths.NODE_ROOT, "Neural_Vault");
const CONFIG_PATH = path.join(VAULT_DIR, "vault.config.json");

export const SUPPORTED_CLOUD_PROVIDERS = [{ id: "drive", label: "Google Drive" }];

function defaultConfig() {
  return {
    storageMode: "local",
    local: { path: "Neural_Vault/local" },
    cloud: null,
  };
}

export function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return defaultConfig();
  }
}

function writeConfig(config) {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

// Resolves the configured local path (which is stored relative to the
// Node root, e.g. "Neural_Vault/local") to an absolute path.
function resolveLocalPath(config) {
  const relOrAbs = config?.local?.path || "Neural_Vault/local";
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(openclawPaths.NODE_ROOT, relOrAbs);
}

// Ensures the currently-configured local directory actually exists.
// Idempotent — safe to call on every launch. Only touches the filesystem
// when storageMode is "local"; a no-op under "cloud".
export function activateLocal() {
  const config = readConfig();
  if (config.storageMode !== "local") {
    return { ok: true, storageMode: config.storageMode };
  }
  const resolved = resolveLocalPath(config);
  fs.mkdirSync(resolved, { recursive: true });
  return { ok: true, storageMode: "local", path: resolved };
}

// Returns the vault root the rest of the Node should actually read/write
// through, regardless of backend. Phase I (Working_Memory) is the first
// real consumer of this.
export function getVaultRoot() {
  const config = readConfig();
  if (config.storageMode === "local") {
    return resolveLocalPath(config);
  }
  if (config.storageMode === "cloud" && config.cloud?.localSyncPath) {
    return config.cloud.localSyncPath;
  }
  throw new Error(`Vault is in "${config.storageMode}" mode but has no usable root configured`);
}

export function getStatus() {
  const config = readConfig();
  if (config.storageMode === "local") {
    const resolved = resolveLocalPath(config);
    let writable = false;
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    return { storageMode: "local", path: resolved, writable };
  }
  return { storageMode: config.storageMode, cloud: config.cloud };
}

// Relocates local storage to a new path. Per the branding/product intent
// ("relocate" in CLAUDE.md section 8) this MOVES existing contents, it
// doesn't just repoint config at an empty new directory and strand the
// old data.
export function setLocalPath(newPath) {
  const absoluteNew = path.isAbsolute(newPath) ? newPath : path.join(openclawPaths.NODE_ROOT, newPath);
  const config = readConfig();
  const oldPath = config.storageMode === "local" ? resolveLocalPath(config) : null;

  fs.mkdirSync(absoluteNew, { recursive: true });

  if (oldPath && fs.existsSync(oldPath) && path.resolve(oldPath) !== path.resolve(absoluteNew)) {
    for (const entry of fs.readdirSync(oldPath)) {
      fs.renameSync(path.join(oldPath, entry), path.join(absoluteNew, entry));
    }
  }

  const storedPath = absoluteNew.startsWith(openclawPaths.NODE_ROOT)
    ? path.relative(openclawPaths.NODE_ROOT, absoluteNew)
    : absoluteNew;

  writeConfig({ storageMode: "local", local: { path: storedPath }, cloud: null });
  return { ok: true, path: absoluteNew };
}

// Not implemented — see module header. Throws with a clear, honest reason
// rather than silently no-op-ing or pretending to succeed.
export function switchToCloud() {
  throw new Error(
    "Cloud Vault (Google Drive) isn't wired up yet — needs real Google OAuth client credentials, which don't exist in this repo."
  );
}

export const paths = { VAULT_DIR, CONFIG_PATH };

// CLI fallback, same pattern as providers.mjs — lets the Interface's
// server-side API route shell out via subprocess instead of importing
// this module directly across the WebClaw/daemon boundary (Vite SSR
// bundling risk, see routes/api/provider-key.ts's comment on the same
// concern).
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "status") {
      console.log(JSON.stringify(getStatus()));
    } else if (cmd === "set-local" && arg) {
      console.log(JSON.stringify(setLocalPath(arg)));
    } else {
      console.log("Usage: node daemon/vault.mjs status | set-local <path>");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
