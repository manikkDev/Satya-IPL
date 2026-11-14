// Indian identifier builders/checkers used by the curated seed and its
// validator. GSTIN checksum reuses the server's port of the engine algorithm
// (src/lib/gstin.js) so seed, server and engine agree on one implementation.
import crypto from "node:crypto";
import { gstinChecksum, validateGstin, stateFor, PAN_PATTERN } from "../lib/gstin.js";

export { gstinChecksum, validateGstin, stateFor, PAN_PATTERN };

// PAN 4th character = holder type (C company, F firm/LLP, P individual/proprietor …)
export const PAN_HOLDER = { company: "C", firm: "F", llp: "F", proprietor: "P" };

// Regular-taxpayer GSTIN: state code + PAN + entity number + "Z" + checksum.
export const buildGstin = (stateCode, pan, entityNo = "1") => {
  if (!/^\d{2}$/.test(stateCode)) throw new Error(`Bad state code ${stateCode}`);
  if (!PAN_PATTERN.test(pan)) throw new Error(`Bad PAN ${pan}`);
  const first14 = `${stateCode}${pan}${entityNo}Z`;
  return `${first14}${gstinChecksum(first14)}`;
};

// Two-digit GST state code -> {name, udyamCode, pinPrefixes}. PIN prefixes are
// the India Post first-two-digit ranges for that state (postal circles).
export const STATES = {
  "06": { name: "Haryana", udyam: "HR", pin: ["12", "13"] },
  "24": { name: "Gujarat", udyam: "GJ", pin: ["36", "37", "38", "39"] },
  "27": { name: "Maharashtra", udyam: "MH", pin: ["40", "41", "42", "43", "44"] },
  "29": { name: "Karnataka", udyam: "KR", pin: ["56", "57", "58", "59"] },
  "33": { name: "Tamil Nadu", udyam: "TN", pin: ["60", "61", "62", "63", "64"] },
};

export const pinMatchesState = (pin, stateCode) =>
  /^[1-9]\d{5}$/.test(pin) && Boolean(STATES[stateCode]?.pin.includes(pin.slice(0, 2)));

// Udyam Registration Number: UDYAM-<state>-<2-digit district>-<7 digits>.
export const UDYAM_PATTERN = /^UDYAM-([A-Z]{2})-(\d{2})-(\d{7})$/;
export const udyamMatchesState = (udyam, stateCode) => {
  const m = UDYAM_PATTERN.exec(udyam || "");
  return Boolean(m && STATES[stateCode]?.udyam === m[1]);
};

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}(PTC|PLC|FTC|GOI|NPL|ULL|ULT)\d{6}$/;

// Bank transfer references as Indian banks issue them (remitter bank HDFC):
//   NEFT  — 16 chars: <bank4>N<YY><JJJ><6-digit seq>
//   RTGS  — 22 chars: <bank4>R<channel digit><YYYYMMDD><8-digit seq>
//   IMPS  — 12-digit RRN: <Y><JJJ><HH><6-digit seq>
const julian = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return String(Math.floor((d.getTime() - start) / 86400000) + 1).padStart(3, "0");
};
export const UTR_PATTERNS = {
  NEFT: /^[A-Z]{4}N\d{11}$/,
  RTGS: /^[A-Z]{4}R\d{17}$/,
  IMPS: /^\d{12}$/,
};
export const makeUtr = (mode, valueDate, seq, bank = "HDFC") => {
  const s = Number(seq);
  if (mode === "NEFT") return `${bank}N${valueDate.slice(2, 4)}${julian(valueDate)}${String(s).padStart(6, "0")}`;
  if (mode === "RTGS") return `${bank}R5${valueDate.replaceAll("-", "")}${String(s).padStart(8, "0")}`;
  if (mode === "IMPS") return `${valueDate.slice(3, 4)}${julian(valueDate)}11${String(s).padStart(6, "0")}`;
  return null; // CHEQUE carries no UTR
};

// IRN = SHA-256 over supplier GSTIN + FY + document type + document number
// (the IRP's published construction), so it is reproducible from the invoice.
export const makeIrn = (sellerGstin, fy, docType, number) =>
  crypto.createHash("sha256").update(`${sellerGstin}${fy}${docType}${number}`).digest("hex");

// Deterministic pseudo-random digits for ack/e-way numbers and bank accounts.
export const digitsFrom = (seed, length) => {
  let out = "";
  let counter = 0;
  while (out.length < length) {
    out += crypto.createHash("sha256").update(`${seed}:${counter++}`).digest("hex").replace(/[a-f]/g, "");
  }
  return out.slice(0, length);
};
