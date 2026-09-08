// Landing a file inside a project's Vault directory. The one primitive
// every import route (Dashboard upload, chat drag-drop, a watched
// directory) shares -- each route's job is only to get bytes and a
// filename here; where the file ends up and how it is named is decided
// once, in one place, not reimplemented per route.
//
// Deliberately does NOT create the project. A route that wants
// create-then-import (the agent's "make a project and put this in it"
// flow) calls createProject() first, explicitly -- silently creating a
// project as a side effect of a file arriving would make "which projects
// exist" depend on upload order rather than a deliberate action.
import fs from "node:fs";
import path from "node:path";
import { vaultProjectDir, assertSafeId, SAFE_FILENAME } from "./working-memory.mjs";

// Areas a plain imported file can land in. Never notes/ or analyses/ --
// those are specifically AUTHORED material (notes.md, pinned citations),
// with their own writers and their own meaning; a file someone dropped in
// has not been written by anyone, so it does not belong there. Vault's
// own docstring draws this same line: "notes and analyses carry text
// because reading them is the point of opening a project ... sessions
// and exports do not, because they are capture volume." An imported file
// is capture volume until a person or the agent turns it into notes.
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

// Raw recording formats named in the Archive's own schema docs
// (observation-packet-v2.md's neural_data.raw_pointer examples). These are
// CAPTURE data -- the thing a session records -- so they belong in
// sessions/, same area vault-ledger.mjs already treats as capture volume
// and scans for packet-shaped content.
const CAPTURE_EXTENSIONS = new Set([".edf", ".fif", ".nii", ".nwb"]);

/** Which Vault area a file's extension routes to. Content-blind on purpose
 *  -- this only decides WHERE a file is organized, not whether its content
 *  is Archive-syncable. That is a separate, content-based question (see
 *  the compatibility checker), asked later, on files already imported. */
export function classifyImportArea(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "images";
  if (CAPTURE_EXTENSIONS.has(ext)) return "sessions";
  return "exports";
}

/** Takes whatever a browser/agent handed over and makes it a safe,
 *  collision-free basename. Never rejects an upload for a stray space or
 *  paren -- real research filenames have both -- but never trusts the
 *  input as a path either: only the basename survives, and only
 *  SAFE_FILENAME characters in it. */
function sanitizeFilename(rawName) {
  const base = path.basename(String(rawName || "").trim()) || "file";
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const cleanStem = stem.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^[._-]+/, "") || "file";
  const cleanExt = ext.replace(/[^A-Za-z0-9.]+/g, "").slice(0, 16);
  const candidate = `${cleanStem}${cleanExt}`.slice(0, 128);
  return SAFE_FILENAME.test(candidate) ? candidate : `file${cleanExt || ""}`;
}

/** Appends a short disambiguator if `dir/name` already exists, so two
 *  uploads of "scan.edf" both survive instead of the second silently
 *  overwriting the first. */
function uniqueDestPath(dir, filename) {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = filename;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    n += 1;
    candidate = `${stem}-${n}${ext}`;
  }
  return candidate;
}

/**
 * Writes `data` into the right area of an EXISTING project's Vault
 * directory.
 *
 * @param {string} projectId
 * @param {string} filename - original filename; sanitized here, not
 *   trusted from the caller.
 * @param {Buffer} data
 * @returns {{ projectId: string, area: string, filename: string, path: string, bytes: number }}
 */
export function importFileToProject({ projectId, filename, data }) {
  assertSafeId(projectId, "projectId");
  if (!Buffer.isBuffer(data)) {
    throw new Error("importFileToProject: data must be a Buffer");
  }
  if (data.length === 0) {
    throw new Error("Refusing to import an empty file.");
  }

  const projectDir = vaultProjectDir(projectId);
  if (!fs.existsSync(projectDir)) {
    throw new Error(
      `Project "${projectId}" does not exist. Create it first, then import into it.`,
    );
  }

  const area = classifyImportArea(filename);
  const areaDir = path.join(projectDir, area);
  fs.mkdirSync(areaDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const finalName = uniqueDestPath(areaDir, safeName);
  const destPath = path.join(areaDir, finalName);
  fs.writeFileSync(destPath, data);

  return { projectId, area, filename: finalName, path: destPath, bytes: data.length };
}
