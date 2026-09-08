// Binding a project to a directory on the researcher's own machine, and
// scanning it for new files. For a researcher who already deposits
// everything from an instrument/export pipeline into one folder, this
// removes the "individually select files" step entirely -- point a
// project at the folder once, and whatever lands there gets imported.
//
// READ-ONLY toward the watched directory, deliberately. This is not a
// second Vault location the way setLocalPath() treats the Vault's own
// storage folder (vault.mjs) -- the watched directory stays the user's,
// organized however their own tooling already organizes it. Nothing here
// ever renames, moves, or deletes a file inside it; only reads and copies.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { vaultProjectDir, assertSafeId } from "./working-memory.mjs";
import { importFileToProject } from "./project-import.mjs";

const PROJECT_JSON = ".project.json";
const WATCH_STATE_JSON = ".watch-state.json";

// Anything already scaffolded as a Vault AREA is where imports land, never
// where they are read FROM -- scanning a project's own images/sessions/
// etc. back into itself would import every file it already imported, every
// tick, forever.
const OWN_AREAS = new Set(["sessions", "notes", "analyses", "exports", "images", "Syncable_Data_Files"]);

function readProjectJson(projectId) {
  const p = path.join(vaultProjectDir(projectId), PROJECT_JSON);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeProjectJson(projectId, meta) {
  const p = path.join(vaultProjectDir(projectId), PROJECT_JSON);
  fs.writeFileSync(p, JSON.stringify(meta, null, 2) + "\n");
}

/** Binds `dirPath` as the source a project auto-imports from. The directory
 *  must already exist -- unlike the Vault's own storage relocation, this is
 *  never created on the user's behalf; a nonexistent path here is a typo,
 *  not an intent to create a folder. */
export function bindWatchDirectory(projectId, dirPath) {
  assertSafeId(projectId, "projectId");
  const projectDir = vaultProjectDir(projectId);
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project "${projectId}" does not exist.`);
  }
  const resolved = path.resolve(String(dirPath || ""));
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`"${resolved}" does not exist.`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`"${resolved}" is not a directory.`);
  }
  // Refuses binding a project to its OWN Vault directory (or an ancestor of
  // it) -- that would make every import the watcher performs immediately
  // rescannable as new source material, an import loop with no exit.
  const projectDirResolved = path.resolve(projectDir);
  if (resolved === projectDirResolved || projectDirResolved.startsWith(resolved + path.sep)) {
    throw new Error("Cannot watch a project's own Vault directory -- that would import forever.");
  }

  const meta = readProjectJson(projectId);
  meta.watchDir = resolved;
  writeProjectJson(projectId, meta);
  return { ok: true, projectId, watchDir: resolved };
}

export function unbindWatchDirectory(projectId) {
  assertSafeId(projectId, "projectId");
  const meta = readProjectJson(projectId);
  delete meta.watchDir;
  writeProjectJson(projectId, meta);
  return { ok: true, projectId };
}

function fingerprint(rel, stat) {
  return createHash("sha1").update(`${rel}:${stat.size}:${stat.mtimeMs}`).digest("base64url");
}

function walk(dir, baseDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission error or the dir vanished mid-scan; skip, don't crash the tick
  }
  for (const entry of entries) {
    // Hidden files/dirs (.DS_Store, editor swap files, an instrument's own
    // ".tmp" partial-write markers) are skipped rather than imported as if
    // they were data.
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
    } else if (entry.isFile()) {
      out.push({ full, rel: path.relative(baseDir, full) });
    }
  }
}

/**
 * Scans one project's bound directory and imports anything not already
 * imported. Safe to call repeatedly -- a file already imported (same
 * relative path, size and mtime as last time) is skipped, so re-running
 * this on an unchanged directory does nothing.
 */
export function scanWatchedDirectory(projectId) {
  assertSafeId(projectId, "projectId");
  const meta = readProjectJson(projectId);
  const watchDir = meta.watchDir;
  if (!watchDir) {
    return { ok: true, projectId, watched: false };
  }
  if (!fs.existsSync(watchDir)) {
    // The bound folder was moved/deleted/unmounted (a network drive, a USB
    // drive). Not an error worth throwing over -- the binding is still
    // recorded, and it will resume the moment the folder is back.
    return { ok: true, projectId, watched: true, watchDir, error: "directory not reachable" };
  }

  const statePath = path.join(vaultProjectDir(projectId), WATCH_STATE_JSON);
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    // first scan, or a corrupt state file -- start clean rather than throw
  }

  const files = [];
  walk(watchDir, watchDir, files);

  const imported = [];
  const errors = [];
  const nextState = {};
  for (const { full, rel } of files) {
    // Never re-import a project's own already-imported material if the
    // watched directory happens to be an ancestor that also contains it.
    const topSegment = rel.split(path.sep)[0];
    if (OWN_AREAS.has(topSegment)) continue;

    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // vanished between readdir and stat
    }
    const fp = fingerprint(rel, stat);
    nextState[rel] = fp;
    if (state[rel] === fp) continue; // unchanged since last scan

    try {
      const data = fs.readFileSync(full);
      const result = importFileToProject({ projectId, filename: path.basename(rel), data });
      imported.push({ source: rel, ...result });
    } catch (err) {
      errors.push({ source: rel, error: err instanceof Error ? err.message : String(err) });
      // Keep the OLD fingerprint (or none) so a transient failure gets
      // retried next tick instead of being marked done.
      if (state[rel]) nextState[rel] = state[rel];
      else delete nextState[rel];
    }
  }

  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n");
  return { ok: true, projectId, watched: true, watchDir, scanned: files.length, imported, errors };
}

/** Scans every project that has a watchDir bound. Called once per tick by
 *  the background loop. */
export function scanAllWatchedProjects(listProjectsFn) {
  const results = [];
  for (const p of listProjectsFn()) {
    if (!p.watchDir) continue;
    try {
      results.push(scanWatchedDirectory(p.projectId));
    } catch (err) {
      results.push({
        ok: false,
        projectId: p.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
