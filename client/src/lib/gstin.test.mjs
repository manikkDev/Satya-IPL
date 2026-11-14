import test from "node:test";
import assert from "node:assert/strict";
import { checkGstin, gstinChecksum } from "./gstin.ts";

test("valid GSTIN resolves state and PAN", () => {
  const result = checkGstin(" 27aapfu0939f1zv ");
  assert.equal(result.ok, true);
  assert.equal(result.gstin, "27AAPFU0939F1ZV");
  assert.equal(result.stateName, "Maharashtra");
  assert.equal(result.pan, "AAPFU0939F");
});

test("checksum matches the server/engine algorithm", () => {
  assert.equal(gstinChecksum("27AAPFU0939F1Z"), "V");
  assert.equal(gstinChecksum("29AABCV1234M1Z"), "5");
});

test("each failure explains itself in plain words", () => {
  assert.equal(checkGstin("").reason, "empty");
  assert.equal(checkGstin("27AAPFU0939F1Z").reason, "length");
  assert.equal(checkGstin("27AAPFU09391FZV").reason, "shape");
  assert.equal(checkGstin("99AAPFU0939F1ZV").reason, "state");
  const bad = checkGstin("27AAPFU0939F1ZA");
  assert.equal(bad.reason, "checksum");
  assert.match(bad.message, /typo/);
});
