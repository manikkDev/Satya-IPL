// Client-side GSTIN check — same algorithm as server/src/lib/gstin.js (and
// the engine's india/gstin.py): shape + state code + mod-36 checksum. It
// never claims a GSTIN is *registered*; only that it is well-formed.

import { GST_STATE_NAMES } from "./india.ts";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function gstinChecksum(firstFourteen: string): string {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const product = ALPHABET.indexOf(firstFourteen[i]) * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36];
}

export type GstinCheck =
  | { ok: true; gstin: string; stateCode: string; stateName: string; pan: string }
  | { ok: false; gstin: string; reason: "empty" | "length" | "shape" | "state" | "checksum"; message: string };

/** Validate a GSTIN typed by a person. Spaces are ignored, case is fixed. */
export function checkGstin(raw: string): GstinCheck {
  const gstin = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  if (!gstin) return { ok: false, gstin, reason: "empty", message: "Enter your 15-character GSTIN." };
  if (gstin.length !== 15) return { ok: false, gstin, reason: "length", message: `A GSTIN has 15 characters — this one has ${gstin.length}.` };
  if (!SHAPE.test(gstin)) {
    return { ok: false, gstin, reason: "shape", message: "This doesn’t look like a GSTIN. It should be: 2 digits, your 10-character PAN, then 3 more characters (e.g. 27AAPFU0939F1ZV)." };
  }
  const stateCode = gstin.slice(0, 2);
  const stateName = GST_STATE_NAMES[stateCode];
  if (!stateName) return { ok: false, gstin, reason: "state", message: `“${stateCode}” isn’t a GST state code.` };
  if (gstinChecksum(gstin.slice(0, 14)) !== gstin[14]) {
    return { ok: false, gstin, reason: "checksum", message: "The last character doesn’t match the rest — please check for a typo." };
  }
  return { ok: true, gstin, stateCode, stateName, pan: gstin.slice(2, 12) };
}
