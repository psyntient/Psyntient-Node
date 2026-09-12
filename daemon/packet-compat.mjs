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
// The required-field set, the consent check, the provenance check and the
// held_out refusal mirror archive/tools/ingest_queue.py on the Archive
// droplet as closely as this side can -- read directly off
// /root/The-Architect/archive/schema/observation-packet-v2.md and the
// Archive's own triage code, not reconstructed from memory. This is a
// PRE-FILTER, not the last word: the Archive re-validates everything
// independently on ingest and will reject anything this gets wrong. What
// this buys is telling the user why BEFORE they submit something the
// Archive was always going to refuse -- which only holds if this mirror
// stays current. It fell out of sync once already (see
// packet-compat.test.mjs's divergence tests and
// archive/schema/NODE-PACKET-COMPAT-GAP.md in psyntient/The-Architect,
// found 2026-09-11): the Archive gained `simulated` and `held_out` gates
// and this file did not, so a Zhang & Wamsley packet would have sailed
// through this check and been refused downstream with no visible
// connection between the two.
//
// Consent is a hard, deterministic gate here too -- same principle the
// Architect's own ingest_queue.py states outright: "never a model's
// judgment call." Nothing in this file asks an LLM whether a file is
// eligible; an agent may help ORGANIZE what lands in Syncable_Data_Files
// (its own generic file tools already reach there), but this module alone
// decides what lands there in the first place.
//
// CONSTRAINT FOR WHOEVER BUILDS SUBMISSIONS (not yet built on the Node):
// `subject_id` must be stable per participant -- the same value for every
// packet from the same person, never regenerated per recording, per
// session, or on retry. A validation campaign's partition wall is built
// between PARTICIPANTS, not packets: if one person's packets carry two
// ids, they land on both sides of the development/held-out split and the
// reported held-out score silently measures memorisation while looking
// completely normal. Nothing in this repo mints a subject_id today (grep
// confirms `packet-compat.mjs` is the only place the field is even read),
// so this is a constraint on future work, not a bug in present code. If
// subject identity arrives from a dataset accession rather than being
// minted by the Node, pass it through unmodified and record that
// verbatim-passthrough decision in the submission's own metadata rather
// than silently hashing, prefixing, or re-mapping it.
import fs from "node:fs";
import path from "node:path";
import { vaultProjectDir, assertSafeId } from "./working-memory.mjs";

// Required by archive/schema/observation-packet-v2.md's "Required
// top-level fields" and archive/tools/ingest_queue.py's REQUIRED tuple
// (psyntient/The-Architect, main, checked 2026-09-12). `simulated` is
// deliberately NOT in this list -- like the Architect, it gets its own gate
// (provenanceVerdict below) with its own code, because "absent" and
// "present but wrong type" both need a distinct, actionable reason rather
// than folding into a generic "missing fields" message. v1 packets name the
// id field session_id; the Archive's own migrator aliases both, so this
// does too.
export const REQUIRED_FIELDS = ["subject_id", "timestamp", "modalities", "neural_data", "phenomenology_available"];
const ID_ALIASES = ["observation_id", "session_id"];

// Mirrors ingest_queue.py's REJECTION_MESSAGES keys that this pre-filter can
// itself detect (consent/provenance/schema/held_out/substance -- not the
// Archive-only codes like DUPLICATE_ALREADY_PRESENT, which only make sense
// once something is actually in the queue). Exported so a caller (or the
// divergence test) can key UI/branching on a stable code rather than the
// free-text `reason`, the same principle the Architect states for its own
// rejections: "the code is what clients should key on... wording will
// change; codes should not."
export const CODES = Object.freeze({
  HELD_OUT_PACKET: "HELD_OUT_PACKET",
  SCHEMA_INCOMPLETE: "SCHEMA_INCOMPLETE",
  CONSENT_MISSING: "CONSENT_MISSING",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
  CONSENT_NOT_GRANTED: "CONSENT_NOT_GRANTED",
  PROVENANCE_MISSING: "PROVENANCE_MISSING",
  EMPTY_OBSERVATION: "EMPTY_OBSERVATION",
});

// Areas a compatibility check reads FROM. Never Syncable_Data_Files itself
// (already-staged files re-scanning themselves is pointless work, not a
// correctness problem, but there is no reason to pay it every run).
const SOURCE_AREAS = ["sessions", "notes", "analyses", "exports", "images"];

function hasPacketId(pkt) {
  return ID_ALIASES.some((k) => typeof pkt[k] === "string" && pkt[k].trim() !== "");
}

/**
 * The answer key must never travel. Mirrors ingest_queue.py's
 * _heldout_verdict -- checked FIRST, before schema and before consent, so a
 * held-out packet is refused for BEING held out rather than incidentally
 * for some other flaw. Unlike the Architect this cannot also check a
 * campaign registry (that state lives on the droplet, not the Node); the
 * packet's own flag is what a pre-submission check can see, and the
 * Architect's registry check is the belt to this braces.
 */
function heldOutVerdict(pkt) {
  if (pkt.held_out === true) {
    return { ok: false, code: CODES.HELD_OUT_PACKET, reason: "packet declares held_out: true" };
  }
  return { ok: true };
}

/**
 * Real or simulated, declared explicitly, with no default. Mirrors
 * ingest_queue.py's _provenance_verdict: absent (including `null`) and any
 * non-boolean value (including the strings "true"/"false") are refused
 * rather than coerced or defaulted. Assuming `true` would quietly discard
 * real data; assuming `false` would manufacture evidence; a string that
 * merely looks right is exactly the input this must not be lenient about.
 */
function provenanceVerdict(pkt) {
  if (!("simulated" in pkt) || pkt.simulated === null) {
    return { ok: false, code: CODES.PROVENANCE_MISSING, reason: "packet does not declare `simulated`" };
  }
  if (typeof pkt.simulated !== "boolean") {
    return {
      ok: false,
      code: CODES.PROVENANCE_MISSING,
      reason: `\`simulated\` must be true or false, got ${JSON.stringify(pkt.simulated)}`,
    };
  }
  return { ok: true };
}

/**
 * Consent is a hard, deterministic gate -- never a model's judgment call.
 * Mirrors ingest_queue.py's _consent_verdict exactly: absent is treated the
 * same as refused, and a withdrawal always wins even over consented:true.
 */
function consentVerdict(pkt) {
  const cs = pkt.consent_state;
  if (typeof cs !== "object" || cs === null) {
    return { ok: false, code: CODES.CONSENT_MISSING, reason: "consent_state absent -- cannot establish consent" };
  }
  if (cs.withdrawal_date) {
    return { ok: false, code: CODES.CONSENT_WITHDRAWN, reason: `consent withdrawn ${cs.withdrawal_date}` };
  }
  if (cs.consented !== true) {
    return {
      ok: false,
      code: CODES.CONSENT_NOT_GRANTED,
      reason: `consented is ${JSON.stringify(cs.consented)}, not true`,
    };
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
  return {
    ok: false,
    code: CODES.EMPTY_OBSERVATION,
    reason: "no neural_data and no report_text -- nothing observed",
  };
}

/**
 * Checks one file's CONTENT for Observation-Packet shape, provenance and
 * consent. Extension-blind: any file that parses as JSON is a candidate,
 * regardless of what it is named.
 *
 * Gate order mirrors ingest_queue.py's `_triage_one` exactly (held_out ->
 * schema -> consent -> provenance -> substance) -- not just the individual
 * checks. Order matters here for the same reason it does on the Architect:
 * a held-out packet that also happens to be missing a field must be refused
 * for being held out, not incidentally for the other flaw, because the
 * reason shown is the thing an operator acts on.
 *
 * @returns {{ compatible: boolean, code?: string, reason: string, missing?: string[] }}
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

  const heldOut = heldOutVerdict(pkt);
  if (!heldOut.ok) {
    return { compatible: false, code: heldOut.code, reason: heldOut.reason };
  }

  const missing = REQUIRED_FIELDS.filter((k) => !(k in pkt));
  if (!hasPacketId(pkt)) missing.unshift("observation_id (or session_id)");
  if (missing.length > 0) {
    return {
      compatible: false,
      code: CODES.SCHEMA_INCOMPLETE,
      reason: `missing required fields: ${missing.join(", ")}`,
      missing,
    };
  }

  const consent = consentVerdict(pkt);
  if (!consent.ok) {
    return { compatible: false, code: consent.code, reason: `consent: ${consent.reason}` };
  }

  const provenance = provenanceVerdict(pkt);
  if (!provenance.ok) {
    return { compatible: false, code: provenance.code, reason: provenance.reason };
  }

  const substance = substanceVerdict(pkt);
  if (!substance.ok) {
    return { compatible: false, code: substance.code, reason: substance.reason };
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
 * @param {{ move?: boolean }} [options] - Default is MOVE: a compatible file
 *   is staged into Syncable_Data_Files/ and removed from its source area, so
 *   a project never holds two copies of the same packet at once. This is
 *   deliberately the opposite default from the external-directory import
 *   step (project-watch.mjs), which defaults to copy -- that default is
 *   about not touching a researcher's own files outside the Vault; this one
 *   is about not duplicating a file inside it once staged. Pass
 *   `{ move: false }` to keep the source copy instead.
 */
export function checkProjectCompatibility(projectId, options = {}) {
  assertSafeId(projectId, "projectId");
  const move = options.move !== false;
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
        results.incompatible.push({ area, path: rel, code: verdict.code, reason: verdict.reason });
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
 *
 * Same MOVE default as checkProjectCompatibility -- see that function's doc
 * comment.
 */
export function checkFileCompatibility(projectId, relPath, options = {}) {
  assertSafeId(projectId, "projectId");
  const move = options.move !== false;
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
    return { ok: true, projectId, path: relPath, compatible: false, code: verdict.code, reason: verdict.reason };
  }
  const stagingDir = path.join(projectDir, "Syncable_Data_Files");
  fs.mkdirSync(stagingDir, { recursive: true });
  const finalName = uniqueDestPath(stagingDir, path.basename(relPath));
  const destPath = path.join(stagingDir, finalName);
  fs.copyFileSync(full, destPath);
  if (move) fs.unlinkSync(full);
  return { ok: true, projectId, path: relPath, compatible: true, stagedAs: finalName, moved: move };
}
