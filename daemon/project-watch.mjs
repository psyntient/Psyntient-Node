// Binding a project to a directory on the researcher's own machine, and
// scanning it for new files. For a researcher who already deposits
// everything from an instrument/export pipeline into one folder, this
// removes the "individually select files" step entirely -- point a
// project at the folder once, and whatever lands there gets imported.
//
// READ-ONLY toward the watched directory BY DEFAULT. This is not a second
// Vault location the way setLocalPath() treats the Vault's own storage
// folder (vault.mjs) -- the watched directory stays the user's, organized
// however their own tooling already organizes it. Two opt-in exceptions,
// both off by default, both explicit per-binding choices:
//
//   - `deleteAfterImport`: the source file is deleted right after a
//     successful import, turning the folder into a drop-and-it's-gone
//     inbox rather than a standing mirror.
//   - `mirror`: when a file that WAS successfully imported later vanishes
//     from the folder (folder confirmed reachable, path confirmed absent
//     -- see scanWatchedDirectory), its Vault copy is deleted too. A
//     rename in the watched folder is indistinguishable from a delete at
//     this layer (old path gone, unrelated new path appeared), and this
//     is deliberately NOT special-cased: every vanished path is treated
//     as a delete, full stop. Accepted and documented, not an oversight
//     -- Mirror is opt-in, so choosing it means choosing that tradeoff.
//     One-directional only: deleting a file FROM the Vault never deletes
//     anything in the watched folder.
//
// The two compose safely together on purpose: a file removed from the
// watched folder BY deleteAfterImport is never treated as a Mirror-style
// vanish (see scanWatchedDirectory) -- otherwise deleteAfterImport's own
// cleanup would look identical to a user deletion and immediately undo
// the import it just performed.
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

/**
 * Binds `dirPath` as the source a project auto-imports from. The directory
 * must already exist -- unlike the Vault's own storage relocation, this is
 * never created on the user's behalf; a nonexistent path here is a typo,
 * not an intent to create a folder.
 *
 * `deleteAfterImport` and `mirror` (both default false) are independent
 * choices -- see the file header for what each does and how they compose.
 * Both off by default: turning a folder into an inbox that eats what's
 * dropped in it, or a mirror that can delete Vault data on its own, is a
 * bigger behavior change than plain importing, and neither should happen
 * because a field was merely left unset.
 */
export function bindWatchDirectory(projectId, dirPath, { deleteAfterImport = false, mirror = false } = {}) {
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
  meta.watchDeleteAfterImport = deleteAfterImport === true;
  meta.watchMirror = mirror === true;
  writeProjectJson(projectId, meta);
  return {
    ok: true,
    projectId,
    watchDir: resolved,
    deleteAfterImport: meta.watchDeleteAfterImport,
    mirror: meta.watchMirror,
  };
}

export function unbindWatchDirectory(projectId) {
  assertSafeId(projectId, "projectId");
  const meta = readProjectJson(projectId);
  delete meta.watchDir;
  delete meta.watchDeleteAfterImport;
  delete meta.watchMirror;
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

/** True for a legacy state entry (bare fingerprint string, from before
 *  Mirror needed to know WHERE an import landed) or the current shape. */
function entryFingerprint(entry) {
  return typeof entry === "string" ? entry : entry?.fp;
}

/**
 * Scans one project's bound directory and imports anything not already
 * imported. Safe to call repeatedly -- a file already imported (same
 * relative path, size and mtime as last time) is skipped, so re-running
 * this on an unchanged directory does nothing.
 *
 * If the binding opted into `deleteAfterImport`, a successful import also
 * removes the source file -- see bindWatchDirectory's doc comment. A
 * failed import never deletes anything, so a transient error is retried
 * next tick instead of silently losing the source.
 *
 * If the binding opted into `mirror`, a path that WAS successfully
 * imported and has since disappeared from the folder gets its Vault copy
 * deleted too -- unless deleteAfterImport already removed it as part of
 * that same import, in which case it was never carried into next tick's
 * state to begin with (see below), so it can never look like a Mirror
 * vanish. And if the Vault copy has already moved on its own (staged into
 * Syncable_Data_Files/ by a compatibility check, or beyond), it is simply
 * not found at its original spot and skipped -- Mirror only ever touches
 * a file still sitting where the import first put it.
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
    // recorded, and it will resume the moment the folder is back. Critically,
    // this is NOT a Mirror vanish for anything: every path state remembers is
    // simply left untouched below, because this function returns before ever
    // reaching the vanish comparison. An unmounted drive must never look like
    // its whole contents got deleted.
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
  const mirrored = [];
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
    if (entryFingerprint(state[rel]) === fp) {
      nextState[rel] = state[rel]; // unchanged since last scan; carry forward as-is
      continue;
    }

    try {
      const data = fs.readFileSync(full);
      const result = importFileToProject({ projectId, filename: path.basename(rel), data });
      // Only after a confirmed-successful import, and only what was opted
      // into at bind time -- deleting the source is the one exception to
      // this module's read-only-by-default stance toward the watched
      // directory (see the file header), never a side effect of scanning.
      if (meta.watchDeleteAfterImport === true) {
        try {
          fs.unlinkSync(full);
          // Deliberately NOT added to nextState: a file this scan itself
          // deleted must not exist in next tick's "known" set, or a Mirror
          // binding would see it "vanish" and delete the import that was
          // just performed, seconds after performing it.
        } catch {
          // The import already landed; a delete that fails (permissions, the
          // file already gone) is not worth failing the scan over. Falls
          // through to the normal tracked-entry path below.
          nextState[rel] = { fp, area: result.area, filename: result.filename };
        }
      } else {
        nextState[rel] = { fp, area: result.area, filename: result.filename };
      }
      imported.push({ source: rel, ...result });
    } catch (err) {
      errors.push({ source: rel, error: err instanceof Error ? err.message : String(err) });
      // Keep the OLD entry (or none) so a transient failure gets retried
      // next tick instead of being marked done.
      if (state[rel]) nextState[rel] = state[rel];
    }
  }

  if (meta.watchMirror === true) {
    for (const rel of Object.keys(state)) {
      if (rel in nextState) continue; // still present (or freshly re-imported) this tick
      const entry = state[rel];
      // A legacy bare-fingerprint entry carries no area/filename -- there is
      // nothing to locate, so nothing to delete. Not an error, just unknown.
      if (typeof entry !== "object" || !entry?.area || !entry?.filename) continue;
      const target = path.join(vaultProjectDir(projectId), entry.area, entry.filename);
      if (!fs.existsSync(target)) continue; // already staged/moved/synced elsewhere -- link already severed
      try {
        fs.unlinkSync(target);
        mirrored.push({ source: rel, area: entry.area, filename: entry.filename });
      } catch (err) {
        errors.push({
          source: rel,
          error: `mirror delete failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n");
  return { ok: true, projectId, watched: true, watchDir, scanned: files.length, imported, mirrored, errors };
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
