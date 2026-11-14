// Value normalisers shared by every importer: Indian number formats, the
// date shapes Indian banks/ERPs print, invoice-number and party-name keys,
// and statutory identifier checks (GSTIN, PAN, Udyam, HSN).
import { validateGstin, PAN_PATTERN } from "../../lib/gstin.js";
import { isRealDate } from "../../lib/fy.js";
import { GST_SLABS } from "../../lib/docSchemas.js";
import { serialToDate } from "./xlsx.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => {
  const yy = Number(y) < 100 ? 2000 + Number(y) : Number(y);
  const s = `${yy}-${pad(m)}-${pad(d)}`;
  return isRealDate(s) ? s : null;
};

/**
 * Any common Indian date text -> "YYYY-MM-DD" (or null). Day-first is assumed
 * for numeric dates (DD/MM/YYYY) unless the middle part cannot be a month.
 */
export const parseDate = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value).trim().replace(/\s+/g, " ");
  if (!s) return null;
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) return ymd(m[1], m[2], m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ymd(m[1], m[2], m[3]); // Tally 20261101
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:\s.*)?$/.exec(s))) {
    const a = Number(m[1]); const b = Number(m[2]);
    return b > 12 && a <= 12 ? ymd(m[3], a, b) : ymd(m[3], b, a);
  }
  if ((m = /^(\d{1,2})[-/\s]([A-Za-z]{3,9})[-/\s,]*(\d{2}|\d{4})$/.exec(s))) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
    return mon ? ymd(m[3], mon, m[1]) : null;
  }
  if ((m = /^([A-Za-z]{3,9})\s(\d{1,2}),?\s(\d{4})$/.exec(s))) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    return mon ? ymd(m[3], mon, m[2]) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) return serialToDate(s); // Excel serial
  return null;
};

/**
 * Amount text -> {value: "1234.50" (always positive), sign: 1|-1} or null.
 * Accepts ₹ / Rs. / INR prefixes, Indian grouping (1,23,456.00), trailing
 * Dr/Cr, a leading minus and accounting parentheses.
 */
export const parseAmount = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return { value: Math.abs(value).toFixed(2), sign: value < 0 ? -1 : 1 };
  }
  let s = String(value).trim();
  if (!s || s === "-" || s === "--") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  const drcr = /\s*(dr|cr)\.?$/i.exec(s);
  if (drcr) { if (drcr[1].toLowerCase() === "dr") sign = -sign; s = s.slice(0, drcr.index); }
  s = s.replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/[,\s₹]/g, "");
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, frac = ""] = s.split(".");
  // round half-up to paise
  let paise = BigInt(int) * 100n + BigInt((frac + "00").slice(0, 2));
  if (Number(frac[2] || 0) >= 5) paise += 1n;
  return { value: `${paise / 100n}.${String(paise % 100n).padStart(2, "0")}`, sign };
};
export const amountOrNull = (v) => parseAmount(v)?.value ?? null;

/** Quantity text ("15", " 15 Nos", "2.500 Kgs") -> {qty, uom}. */
export const parseQty = (value) => {
  const s = String(value ?? "").trim();
  const m = /^-?\s*([\d,]+(?:\.\d+)?)\s*([A-Za-z.]*)/.exec(s);
  if (!m) return null;
  const qty = m[1].replace(/,/g, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return { qty, uom: normUom(m[2]) };
};

const UOM = { nos: "EA", no: "EA", pcs: "EA", pc: "EA", piece: "EA", pieces: "EA", ea: "EA", each: "EA", unit: "EA", units: "EA", set: "SET", sets: "SET", kg: "KG", kgs: "KG", kilogram: "KG", mt: "MT", tonne: "MT", ton: "MT", ltr: "LTR", l: "LTR", litre: "LTR", mtr: "MTR", m: "MTR", meter: "MTR", metre: "MTR", box: "BOX", pair: "PR", prs: "PR", pkt: "PKT", roll: "ROLL" };
export const normUom = (u) => {
  const k = String(u || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return "EA";
  return UOM[k] || k.toUpperCase().slice(0, 10);
};

/** Invoice/voucher number key: case and punctuation folded ("SIS/26-27/0226" -> "SIS26270226"). */
export const normInvNo = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const LEGAL_SUFFIX = /\b(m\/s\.?|messrs\.?|private limited|pvt\.? ?ltd\.?|p\.? ?ltd\.?|limited|ltd\.?|llp|incorporated|inc\.?|company|co\.?|corporation|corp\.?|the)\b/g;
/** Party-name key for fuzzy dedupe: suffixes, punctuation and case removed. */
export const normName = (n) => String(n || "").toLowerCase()
  .replace(/&/g, " and ")
  .replace(LEGAL_SUFFIX, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
export const checkGstin = (g) => {
  const gstin = String(g || "").toUpperCase().replace(/\s/g, "");
  if (!gstin) return { ok: false, empty: true };
  const v = validateGstin(gstin);
  if (!v.wellFormed) return { ok: false, gstin, reason: "GSTIN must be 15 characters: state code, PAN, entity number, Z, checksum" };
  if (!v.checksumValid) return { ok: false, gstin, reason: "GSTIN checksum digit is wrong — likely a typo" };
  return { ok: true, gstin, stateCode: v.stateCode, pan: v.panEmbedded };
};
export const checkPan = (p) => {
  const pan = String(p || "").toUpperCase().replace(/\s/g, "");
  return pan ? { ok: PAN_PATTERN.test(pan), pan } : { ok: false, empty: true };
};
export const checkUdyam = (u) => {
  const udyam = String(u || "").toUpperCase().replace(/\s/g, "");
  return udyam ? { ok: UDYAM_PATTERN.test(udyam), udyam } : { ok: false, empty: true };
};
export const checkHsn = (h) => {
  const hsn = String(h || "").replace(/\s|\./g, "");
  return hsn ? { ok: /^\d{4,8}$/.test(hsn), hsn } : { ok: false, empty: true };
};
export const normGstRate = (r) => {
  if (r === null || r === undefined || String(r).trim() === "") return null;
  const n = Number(String(r).replace(/%/g, "").trim());
  if (!Number.isFinite(n)) return undefined;
  const s = String(n);
  return GST_SLABS.includes(s) ? s : undefined;
};

/** Truthy-ish spreadsheet booleans. */
export const parseBool = (v) => {
  const s = String(v ?? "").trim().toLowerCase();
  if (["y", "yes", "true", "1"].includes(s)) return true;
  if (["n", "no", "false", "0"].includes(s)) return false;
  return undefined;
};
