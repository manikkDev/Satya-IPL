// JS port of the engine's GSTIN validator (ml-fl-service/satya_engine/
// india/gstin.py) — identical algorithm and fixtures, for instant form-level
// checks. Syntax + checksum only; NEVER registry status. Engine remains the
// authority when FEATURE_V2 paths call /v2/validate/gstin.
// State list vendored from ml-fl-service/assets/gst_state_codes.json
// (source: NIC master codes, reviewed 2026-10-29).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const REGULAR = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const ENTITY_HINTS = {
  A: "association of persons", B: "body of individuals", C: "company",
  F: "firm", G: "government", H: "Hindu undivided family",
  J: "artificial juridical person", L: "local authority", P: "individual",
  T: "trust",
};

const asset = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "gst-state-codes.json"), "utf8")
);
const STATES = new Map(asset.states.map((s) => [s.code, s]));

export const stateFor = (code) => STATES.get(code) || null;

export const gstinChecksum = (firstFourteen) => {
  if (!/^[0-9A-Z]{14}$/.test(firstFourteen)) throw new Error("GSTIN checksum requires 14 uppercase alphanumeric characters");
  let total = 0;
  for (let index = 0; index < firstFourteen.length; index++) {
    const product = ALPHABET.indexOf(firstFourteen[index]) * (index % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (total % 36)) % 36];
};

export const validateGstin = (gstin) => {
  const shape = typeof gstin === "string" && REGULAR.test(gstin);
  const state = shape ? stateFor(gstin.slice(0, 2)) : null;
  const wellFormed = Boolean(shape && state?.registrationState);
  return {
    wellFormed,
    checksumValid: Boolean(shape && gstinChecksum(gstin.slice(0, 14)) === gstin.at(-1)),
    stateCode: shape ? gstin.slice(0, 2) : null,
    panEmbedded: shape ? gstin.slice(2, 12) : null,
    entityTypeHint: shape ? ENTITY_HINTS[gstin[5]] || "unknown" : null,
  };
};
