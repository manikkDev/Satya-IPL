// Pure unit tests (no DB) for the identifier helpers used by the curated seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGstin, gstinChecksum, validateGstin, pinMatchesState, udyamMatchesState, makeUtr, UTR_PATTERNS, makeIrn } from "../src/seed/india.js";
import { ENTITY, SUPPLIERS } from "../src/seed/company.js";
import { typoGstin } from "../src/seed/build.js";

test("GSTIN checksum matches the published algorithm on a known-good GSTIN", () => {
  // 27AAPFU0939F1ZV is the GSTN's own documentation example
  assert.equal(gstinChecksum("27AAPFU0939F1Z"), "V");
  assert.equal(validateGstin("27AAPFU0939F1ZV").checksumValid, true);
  assert.equal(validateGstin("27AAPFU0939F1ZW").checksumValid, false);
});

test("buildGstin embeds PAN and state and always passes checksum", () => {
  const g = buildGstin("29", "AACCK4412P");
  assert.match(g, /^29AACCK4412P1Z[0-9A-Z]$/);
  const v = validateGstin(g);
  assert.equal(v.wellFormed && v.checksumValid, true);
  assert.equal(v.panEmbedded, "AACCK4412P");
  assert.throws(() => buildGstin("29", "AACK4412P"), /Bad PAN/);
});

test("entity and every supplier GSTIN is valid, PAN-consistent and state-consistent", () => {
  for (const party of [ENTITY, ...SUPPLIERS]) {
    const v = validateGstin(party.gstin);
    assert.ok(v.wellFormed && v.checksumValid, `${party.legalName} ${party.gstin}`);
    assert.equal(v.panEmbedded, party.pan, party.legalName);
    assert.equal(v.stateCode, party.stateCode, party.legalName);
  }
  assert.equal(ENTITY.pan[3], "C");
});

test("deliberate GSTIN typo fails the checksum but keeps the shape", () => {
  const bad = typoGstin(SUPPLIERS[0].gstin);
  assert.notEqual(bad, SUPPLIERS[0].gstin);
  assert.equal(bad.length, 15);
  assert.equal(validateGstin(bad).checksumValid, false);
});

test("PIN and Udyam state checks", () => {
  assert.equal(pinMatchesState("410501", "27"), true);
  assert.equal(pinMatchesState("560058", "27"), false);
  assert.equal(pinMatchesState("641021", "33"), true);
  assert.equal(udyamMatchesState("UDYAM-KR-03-0009821", "29"), true);
  assert.equal(udyamMatchesState("UDYAM-MH-03-0009821", "29"), false);
  assert.equal(udyamMatchesState("UDYAM-KR-3A-00F9821", "29"), false);
});

test("UTRs follow NEFT/RTGS/IMPS formats; IRN is 64-hex and deterministic", () => {
  assert.equal(makeUtr("NEFT", "2026-10-25", 105214), "HDFCN26298105214");
  assert.match(makeUtr("NEFT", "2026-10-25", 105214), UTR_PATTERNS.NEFT);
  assert.match(makeUtr("RTGS", "2026-10-25", 12), UTR_PATTERNS.RTGS);
  assert.match(makeUtr("IMPS", "2026-10-25", 12), UTR_PATTERNS.IMPS);
  assert.equal(makeUtr("CHEQUE", "2026-10-25", 1), null);
  const irn = makeIrn("27BXJPJ7316C1ZK", "2026-27", "INV", "MPS/26-27/041");
  assert.match(irn, /^[0-9a-f]{64}$/);
  assert.equal(irn, makeIrn("27BXJPJ7316C1ZK", "2026-27", "INV", "MPS/26-27/041"));
});
