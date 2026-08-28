// The seam every Vault read goes through.
//
// VAULTS ARE ALWAYS LOCAL. Decided 2026-08-28, and it supersedes spec v2.4 §5
// ("Relocating the Vault" to a cloud drive as a storage mode). Cloud is
// BACKUP, never storage. The reasoning:
//
//  - The Node is the access layer, not the storage layer. Nothing ever reads a
//    Vault except the daemon on the same machine, so "Vault in the cloud" only
//    ever meant "the daemon reads its own files over a network" -- which buys
//    latency and nothing else, because the user still reaches the data through
//    the Node. Wanting the Vault reachable from elsewhere means wanting the
//    NODE reachable: install it on a server, and its Vault is local there too.
//  - It makes a corruption class unrepresentable rather than merely
//    discouraged. Two Nodes pointed at one synced folder is concurrent writing
//    to a filesystem with no locking -- the same failure CLAUDE.md already
//    warns about for installing into a cloud-sync directory.
//  - `Neural_Vault/Devices/<device_name>/` already partitions by machine,
//    which is a design that never expected one Vault to be a shared live store.
//
// So there is no remote-read provider here and there should never be one. What
// this interface is actually for is narrower and still worth having: one place
// where Vault reads happen, so path containment is checked once, and so a
// backup engine can stream files out without every caller growing filesystem
// access. It is async because backup and hashing work naturally is, not
// because a network backend is coming.
//
// A local path that happens to sit inside a Drive/Dropbox/iCloud folder is
// still a local path by this definition -- and still a bad idea, for the
// corruption reasons above. That belongs in the relocation UI as a warning,
// matching the Phase L install-location rule, not in this file.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { readConfig } from "./vault.mjs";
import { paths as openclawPaths } from "./openclaw-cli.mjs";

/**
 * @typedef {object} VaultProvider
 * @property {string} id                        Backend identifier.
 * @property {string|null} root                 Absolute path, or null when the
 *   backend has no filesystem representation (API-backed Drive).
 * @property {(rel: string) => Promise<Array<{name: string, isDirectory: boolean}>>} listDir
 * @property {(rel: string) => Promise<string|null>} readText  null when absent.
 * @property {(rel: string) => Promise<{size: number, mtime: string}|null>} stat
 * @property {(rel: string, text: string) => Promise<void>} writeText
 */

/**
 * Filesystem-backed Vault, used for both `local` mode and any cloud mode that
 * materialises as a synced folder (Drive for Desktop, iCloud, Dropbox).
 *
 * Relative paths are resolved and then checked to still be inside the root:
 * a project id reaches this from disk, and `..` in one must not be able to
 * walk the ledger out of the Vault.
 */
export function localProvider(root, { id = "local" } = {}) {
  const resolve = (rel) => {
    const full = path.resolve(root, rel ?? ".");
    if (full !== root && !full.startsWith(root + path.sep)) {
      throw new Error(`Refusing to read outside the Vault: ${rel}`);
    }
    return full;
  };

  return {
    id,
    root,
    async listDir(rel) {
      let entries;
      try {
        entries = await fsp.readdir(resolve(rel), { withFileTypes: true });
      } catch {
        // A missing directory is a normal Vault state (a project with no
        // sessions/ yet), not an error the caller should have to catch.
        return [];
      }
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
    },
    async readText(rel) {
      try {
        return await fsp.readFile(resolve(rel), "utf8");
      } catch {
        return null;
      }
    },
    async stat(rel) {
      try {
        const s = await fsp.stat(resolve(rel));
        return { size: s.size, mtime: s.mtime.toISOString() };
      } catch {
        return null;
      }
    },
    async writeText(rel, text) {
      const full = resolve(rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, text);
    },
  };
}

/**
 * Reject any attempt to treat a remote as Vault storage.
 *
 * Not a stub awaiting an implementation -- this configuration is one the
 * architecture rules out, so it fails with the reason rather than the symptom.
 */
function rejectRemoteStorage(mode) {
  throw new Error(
    `Vault storage cannot be remote (got "${mode}"). Vaults are always local; ` +
      "cloud services are for BACKUP of a local Vault. To reach a Vault from " +
      "elsewhere, run a Node where the data should live.",
  );
}

/**
 * The provider for the configured Vault.
 *
 * `storageMode: "cloud"` with a `localSyncPath` still resolves, because such a
 * Vault is a real local directory and refusing to read it would strand data
 * that already exists on disk. It is served by the local adapter and reports
 * the underlying provider id so a UI can warn about it. Configurations with no
 * local path are rejected outright -- there is nothing there to read.
 */
export function getProvider(config = readConfig()) {
  const mode = config?.storageMode ?? "local";

  if (mode === "local") {
    const rel = config?.local?.path || "Neural_Vault/local";
    const root = path.isAbsolute(rel) ? rel : path.join(openclawPaths.NODE_ROOT, rel);
    fs.mkdirSync(root, { recursive: true });
    return localProvider(root);
  }

  if (mode === "cloud") {
    const synced = config?.cloud?.localSyncPath;
    if (synced) {
      return localProvider(synced, { id: config.cloud?.provider ?? "cloud" });
    }
    return rejectRemoteStorage("cloud");
  }

  throw new Error(`Vault is in "${mode}" mode, which this Node does not understand.`);
}

export default { getProvider, localProvider };
