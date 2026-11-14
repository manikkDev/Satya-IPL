import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import fs from "node:fs";
import { resolveRate } from "../src/routes/v2/hsn.js";
import { findArtifact } from "../src/services/seed/hsn.js";

// The API image ships its own copy of the engine's HSN master; resolution
// must match the engine (longest prefix, conditional/overlap -> null).
const artifact = JSON.parse(zlib.gunzipSync(fs.readFileSync(findArtifact())).toString("utf8"));
const byPrefix = new Map();
for (const r of artifact.rateRules) byPrefix.set(r.prefix, [...(byPrefix.get(r.prefix) || []), r]);
const rate = (code) => resolveRate(code, byPrefix, "2026-10-01")?.rate;

test("server HSN resolution agrees with the repaired engine master", () => {
  assert.ok(findArtifact().includes("server/assets") || findArtifact().includes("ml-fl-service/assets"));
  for (const code of ["84821011", "84811000", "85011011", "85371000", "84841010"]) assert.equal(rate(code), "18", code);
  assert.equal(rate("84137010"), "5");
  assert.equal(rate("84138190"), "5");
  const concrete = resolveRate("84134000", byPrefix, "2026-10-01");
  assert.equal(concrete.rate, null);
  assert.ok(concrete.candidates.length >= 1);
});
