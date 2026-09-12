// Proves two different things, deliberately kept in one file:
//
// 1. checkPacketCompatibility() actually enforces every gate it claims to
//    (held_out, schema, consent, provenance, substance), in the same order
//    the Architect's ingest_queue.py checks them.
// 2. The Node's contract (REQUIRED_FIELDS, CODES) has not silently drifted
//    from the Architect's. It already did once -- see
//    archive/schema/NODE-PACKET-COMPAT-GAP.md in psyntient/The-Architect --
//    and nothing caught it because nothing was asserting the mirror, only
//    claiming it in a comment. This file is that assertion.
//
// Run: node --test daemon/packet-compat.test.mjs  (or `npm test`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPacketCompatibility, REQUIRED_FIELDS, CODES } from "./packet-compat.mjs";

// Pinned literals, not derived from packet-compat.mjs -- the whole point is
// to catch this file's own exports drifting from the Architect's contract,
// so the expectation cannot be read off the thing being tested. Source:
// archive/schema/observation-packet-v2.md ("Required top-level fields") and
// archive/tools/ingest_queue.py's REQUIRED tuple + REJECTION_MESSAGES keys,
// psyntient/The-Architect @ main, checked 2026-09-12. A change on either
// side has to touch this literal on purpose -- that is the guarantee this
// test buys.
const ARCHITECT_REQUIRED_FIELDS = [
  "subject_id",
  "timestamp",
  "modalities",
  "neural_data",
  "phenomenology_available",
];
const ARCHITECT_CODES = [
  "HELD_OUT_PACKET",
  "SCHEMA_INCOMPLETE",
  "CONSENT_MISSING",
  "CONSENT_WITHDRAWN",
  "CONSENT_NOT_GRANTED",
  "PROVENANCE_MISSING",
  "EMPTY_OBSERVATION",
];

test("REQUIRED_FIELDS matches the Architect's schema contract", () => {
  assert.deepEqual([...REQUIRED_FIELDS].sort(), [...ARCHITECT_REQUIRED_FIELDS].sort());
});

test("CODES matches the Architect's rejection-code contract", () => {
  assert.deepEqual(Object.keys(CODES).sort(), ARCHITECT_CODES.sort());
});

// --- fixtures ---------------------------------------------------------

function validPacket(overrides = {}) {
  return {
    observation_id: "obs_test_001",
    subject_id: "subj_001",
    timestamp: "2026-09-12T00:00:00Z",
    modalities: ["EEG"],
    neural_data: { EEG: { summary_features: { alpha: 0.5 } } },
    phenomenology_available: true,
    simulated: false,
    consent_state: { consented: true, withdrawal_date: null },
    ...overrides,
  };
}

function checkJson(obj) {
  return checkPacketCompatibility(JSON.stringify(obj));
}

// --- provenance (`simulated`) -------------------------------------------

test("a packet with no simulated field is refused, naming the field", () => {
  const { simulated, ...rest } = validPacket();
  const verdict = checkJson(rest);
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.PROVENANCE_MISSING);
  assert.match(verdict.reason, /simulated/);
});

test("simulated: null is refused", () => {
  const verdict = checkJson(validPacket({ simulated: null }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.PROVENANCE_MISSING);
});

test('simulated: "false" (string) is refused', () => {
  const verdict = checkJson(validPacket({ simulated: "false" }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.PROVENANCE_MISSING);
});

test('simulated: "true" (string) is refused', () => {
  const verdict = checkJson(validPacket({ simulated: "true" }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.PROVENANCE_MISSING);
});

test("simulated: false (real boolean) passes, with everything else valid", () => {
  const verdict = checkJson(validPacket({ simulated: false }));
  assert.equal(verdict.compatible, true);
});

test("simulated: true (real boolean) passes, with everything else valid", () => {
  const verdict = checkJson(validPacket({ simulated: true }));
  assert.equal(verdict.compatible, true);
});

// --- held_out -------------------------------------------------------------

test("held_out: true is refused, even when everything else is valid", () => {
  const verdict = checkJson(validPacket({ held_out: true }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.HELD_OUT_PACKET);
});

test("held_out is checked before every other gate -- a packet broken in every other way still reports HELD_OUT_PACKET, not some other code", () => {
  const verdict = checkJson({ held_out: true }); // missing everything else too
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.HELD_OUT_PACKET);
});

test("held_out: false does not trip the gate", () => {
  const verdict = checkJson(validPacket({ held_out: false }));
  assert.equal(verdict.compatible, true);
});

// --- schema -----------------------------------------------------------

test("a missing required field is refused with SCHEMA_INCOMPLETE, naming it", () => {
  const { timestamp, ...rest } = validPacket();
  const verdict = checkJson(rest);
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.SCHEMA_INCOMPLETE);
  assert.ok(verdict.missing.includes("timestamp"));
});

test("missing both observation_id and session_id is refused", () => {
  const { observation_id, ...rest } = validPacket();
  const verdict = checkJson(rest);
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.SCHEMA_INCOMPLETE);
});

test("session_id satisfies the id requirement (v1 alias)", () => {
  const { observation_id, ...rest } = validPacket();
  const verdict = checkJson({ ...rest, session_id: "sess_legacy_001" });
  assert.equal(verdict.compatible, true);
});

// --- consent ------------------------------------------------------------

test("consent_state absent is refused with CONSENT_MISSING", () => {
  const { consent_state, ...rest } = validPacket();
  const verdict = checkJson(rest);
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.CONSENT_MISSING);
});

test("a withdrawn consent is refused with CONSENT_WITHDRAWN, even though consented is true", () => {
  const verdict = checkJson(
    validPacket({ consent_state: { consented: true, withdrawal_date: "2026-01-01" } }),
  );
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.CONSENT_WITHDRAWN);
});

test("consented: false is refused with CONSENT_NOT_GRANTED", () => {
  const verdict = checkJson(validPacket({ consent_state: { consented: false } }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.CONSENT_NOT_GRANTED);
});

// --- substance ------------------------------------------------------------

test("no neural_data and no report_text is refused with EMPTY_OBSERVATION", () => {
  const verdict = checkJson(validPacket({ neural_data: {} }));
  assert.equal(verdict.compatible, false);
  assert.equal(verdict.code, CODES.EMPTY_OBSERVATION);
});

test("a report-only packet (no neural_data) is accepted", () => {
  const verdict = checkJson(validPacket({ neural_data: {}, report_text: "It felt like the room widened." }));
  assert.equal(verdict.compatible, true);
});

// --- baseline -------------------------------------------------------------

test("a fully valid real (non-simulated) packet is compatible end to end", () => {
  const verdict = checkJson(validPacket({ simulated: false }));
  assert.equal(verdict.compatible, true);
});
