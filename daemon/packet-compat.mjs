// Whether a file's CONTENT is Observation-Packet-shaped, and staging the
// ones that are into a project's Syncable_Data_Files/ for the sync
// procedure.
//
// Content-blind on extension, deliberately -- the question here is never
// "is this a .json file", it is "does this have research-observation
// content", per the user's own framing: a researcher's data can arrive in
// any file type, and a .txt or a .pdf carrying the right structure is as
// real a candidate as a .json is.
//
// The required-field set and the consent check mirror
// archive/tools/ingest_queue.py on the Archive droplet as closely as this
// side can -- read directly off /root/The-Architect/archive/schema/
// observation-packet-v2.md and the Archive's own triage code, not
// reconstructed from memory. This is a PRE-FILTER, not the last word: the
// Archive re-validates everything independently on ingest and will reject
// anything this gets wrong. What this buys is telling the user why BEFORE
// they submit something the Archive was always going to refuse.
//
// Consent is a hard, deterministic gate here too -- same principle the
// Architect's own ingest_queue.py states outright: "never a model's
// judgment call." Nothing in this file asks an LLM whether a file is
// eligible; an agent may help ORGANIZE what lands in Syncable_Data_Files
// (its own generic file tools already reach there), but this module alone
// decides what lands there in the first place.
import fs from "node:fs";
import path from "node:path";
import { vaultProjectDir, assertSafeId } from "./working-memory.mjs";

// Required by archive/schema/observation-packet-v2.md. v1 packets name the
// id field session_id; the Archive's own migrator aliases both, so this
// does too.
const REQUIRED_FIELDS = ["subject_id", "timestamp", "modalities", "neural_data", "phenomenology_available"];
const ID_ALIASES = ["observation_id", "session_id"];

// Areas a compatibility check reads FROM. Never Syncable_Data_Files itself
// (already-staged files re-scanning themselves is pointless work, not a
// correctness problem, but there is no reason to pay it every run).
const SOURCE_AREAS = ["sessions", "notes", "analyses", "exports", "images"];

function hasPacketId(pkt) {
  return ID_ALIASES.some((k) => typeof pkt[k] === "string" && pkt[k].trim() !== "");
}

/**
 * Consent is a hard, deterministic gate -- never a model's judgment call.
 * Mirrors ingest_queue.py's _consent_verdict exactly: absent is treated the
 * same as refused, and a withdrawal always wins even over consented:true.
 */
function consentVerdict(pkt) {
  const cs = pkt.consent_state;
  if (typeof cs !== "object" || cs === null) {
    return { ok: false, reason: "consent_state absent -- cannot establish consent" };
  }
  if (cs.withdrawal_date) {
    return { ok: false, reason: `consent withdrawn ${cs.withdrawal_date}` };
  }
  if (cs.consented !== true) {
    return { ok: false, reason: `consented is ${JSON.stringify(cs.consented)}, not true` };
  }
  return { ok: true, reason: "consented" };
}

/** A packet must actually observe something -- neural data or a first-person
 *  report. Mirrors ingest_queue.py's _substance_verdict; deliberately
 *  accepts report-only packets. */
function substanceVerdict(pkt) {
  const nd = pkt.neural_data;
  const hasNeural =
    typeof nd === "object" && nd !== null && Object.values(nd).some((v) => typeof v === "object" && v !== null);
  const txt = pkt.report_text;
  const hasReport = typeof txt === "string" && txt.trim() !== "";
  if (hasNeural || hasReport) {
    return { ok: true, reason: hasNeural ? "neural_data" : "report-only" };
  }
  return { ok: false, reason: "no neural_data and no report_text -- nothing observed" };
}

/**
 * Checks one file's CONTENT for Observation-Packet shape and consent.
 * Extension-blind: any file that parses as JSON is a candidate, regardless
 * of what it is named.
 *
 * @returns {{ compatible: boolean, reason: string, missing?: string[] }}
 */
export function checkPacketCompatibility(data) {
  const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  let pkt;
  try {
    pkt = JSON.parse(text);
  } catch {
    return { compatible: false, reason: "not JSON -- no packet content to check" };
  }
  if (typeof pkt !== "object" || pkt === null || Array.isArray(pkt)) {
    return { compatible: false, reason: "JSON content is not an object" };
  }

  const missing = REQUIRED_FIELDS.filter((k) => !(k in pkt));
  if (!hasPacketId(pkt)) missing.unshift("observation_id (or session_id)");
  if (missing.length > 0) {
    return { compatible: false, reason: `missing required fields: ${missing.join(", ")}`, missing };
  }

  const consent = consentVerdict(pkt);
  if (!consent.ok) {
    return { compatible: false, reason: `consent: ${consent.reason}` };
  }

  const substance = substanceVerdict(pkt);
  if (!substance.ok) {
    return { compatible: false, reason: substance.reason };
  }

  return { compatible: true, reason: substance.reason };
}

function walkFiles(dir, baseDir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, baseDir, out);
    } else if (entry.isFile()) {
      out.push({ full, rel: path.relative(baseDir, full) });
    }
  }
}

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
 * Runs the compatibility check across a project's source areas and stages
 * every compatible file into Syncable_Data_Files/.
 *
 * @param {string} projectId
 * @param {{ move?: boolean }} [options] - `move` deletes the source after
 *   staging (the "copy & delete" option); default is copy, which is the
 *   safer default -- a compatibility verdict can go stale if the source
 *   changes later, and a copy makes "what did we actually submit" an
 *   honest, frozen snapshot.
 */
export function checkProjectCompatibility(projectId, options = {}) {
  assertSafeId(projectId, "projectId");
  const move = options.move === true;
  const projectDir = vaultProjectDir(projectId);
  if (!fs.existsSync(projectDir)) {
    throw new Error(`Project "${projectId}" does not exist.`);
  }
  const stagingDir = path.join(projectDir, "Syncable_Data_Files");
  fs.mkdirSync(stagingDir, { recursive: true });

  const results = { compatible: [], incompatible: [] };
  for (const area of SOURCE_AREAS) {
    const areaDir = path.join(projectDir, area);
    if (!fs.existsSync(areaDir)) continue;
    const files = [];
    walkFiles(areaDir, areaDir, files);
    for (const { full, rel } of files) {
      let data;
      try {
        data = fs.readFileSync(full);
      } catch {
        continue;
      }
      const verdict = checkPacketCompatibility(data);
      if (!verdict.compatible) {
        results.incompatible.push({ area, path: rel, reason: verdict.reason });
        continue;
      }
      const finalName = uniqueDestPath(stagingDir, path.basename(rel));
      const destPath = path.join(stagingDir, finalName);
      fs.copyFileSync(full, destPath);
      if (move) fs.unlinkSync(full);
      results.compatible.push({ area, path: rel, stagedAs: finalName, moved: move });
    }
  }
  return { ok: true, projectId, stagingDir, ...results };
}

/**
 * Runs the compatibility check on ONE specific file already inside a
 * project (any source area), rather than the whole project.
 */
export function checkFileCompatibility(projectId, relPath, options = {}) {
  assertSafeId(projectId, "projectId");
  const move = options.move === true;
  const projectDir = vaultProjectDir(projectId);
  const topSegment = String(relPath || "").split(path.sep)[0];
  if (!SOURCE_AREAS.includes(topSegment)) {
    throw new Error(`"${relPath}" is not inside a recognized project area (${SOURCE_AREAS.join(", ")}).`);
  }
  const full = path.join(projectDir, relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`"${relPath}" does not exist in project "${projectId}".`);
  }
  const data = fs.readFileSync(full);
  const verdict = checkPacketCompatibility(data);
  if (!verdict.compatible) {
    return { ok: true, projectId, path: relPath, compatible: false, reason: verdict.reason };
  }
  const stagingDir = path.join(projectDir, "Syncable_Data_Files");
  fs.mkdirSync(stagingDir, { recursive: true });
  const finalName = uniqueDestPath(stagingDir, path.basename(relPath));
  const destPath = path.join(stagingDir, finalName);
  fs.copyFileSync(full, destPath);
  if (move) fs.unlinkSync(full);
  return { ok: true, projectId, path: relPath, compatible: true, stagedAs: finalName, moved: move };
}
