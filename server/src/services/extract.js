import ExtractionDraft from "../models/ExtractionDraft.js";
import { enginePost } from "./engine.js";
import { gatewayPost } from "./gateway.js";
import { getFileBuffer } from "./storage.js";

// Extraction orchestration (04 P2-B5):
//   1. engine /v2/docs/parse — text layer + layout text, IRP signed-QR decode,
//      deterministic text-layer fields with per-field confidence, and page
//      images when a model read is needed or recommended;
//   2. gateway /internal/llm/extract — ONLY when the engine says needsLlm or
//      llmRecommended; the text layer AND page images are sent; the gateway
//      enforces the data policy (403 AI_POLICY_BLOCKED);
//   3. engine /v2/docs/fuse — merges QR > text layer > LLM with decomposed,
//      validator-driven confidence (never the model's self-report);
//      an older engine without /fuse falls back to /v2/docs/validate with a
//      normalised draft, and every field is then marked for review.
// An unavailable LLM never blocks review. Nothing is ever auto-confirmed:
// drafts always land in needs_review and a person confirms.

const DRAFT_METHODS = new Set(["einvoice_qr", "text_layer", "vision_llm", "csv", "json", "failed"]);
const PARSE_METHOD = { einvoice_json: "json", json: "json", csv: "csv", pdf_text: "text_layer" };
const REVIEW_THRESHOLD = 0.9;
const MAX_LLM_TEXT = 60_000;
const MAX_IMAGE_PAYLOAD = 5_000_000; // gateway body limit is 6 MB

const dataPolicy = () => process.env.AI_DATA_POLICY || "demo";

// ---------------------------------------------------------------- normalise
// Gateway LLM output carries printed formats ("07/05/2026", "₹3,30,855.00"),
// task-style types ("invoice") and extra keys (quotes, fieldConfidence,
// poReference, bankDetails). The engine's PartialBusinessDocument is strict
// (extra="forbid", DecimalString, DateOnly), so normalise before validating.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const TYPE_ALIASES = {
  invoice: "INVOICE_IN", tax_invoice: "INVOICE_IN", invoice_in: "INVOICE_IN", bill: "INVOICE_IN",
  credit_note: "CREDIT_NOTE_IN", credit_note_in: "CREDIT_NOTE_IN", debit_note: "DEBIT_NOTE_IN", debit_note_in: "DEBIT_NOTE_IN",
  po: "PO", purchase_order: "PO", pi: "PI_IN", pi_in: "PI_IN", proforma: "PI_IN", proforma_invoice: "PI_IN",
  grn: "GRN", goods_receipt: "GRN", challan: "DELIVERY_CHALLAN", delivery_challan: "DELIVERY_CHALLAN",
  qc: "QC", payment_out: "PAYMENT_OUT", payment_in: "PAYMENT_IN",
};
const UOMS = new Set(["NOS", "PCS", "KG", "KGS", "MTR", "LTR", "SET", "BOX", "EA", "UNIT", "UNITS", "MT", "PAIR", "ROLL", "BAG", "BAGS", "DOZ"]);
const GST_SLABS = new Set(["0", "0.1", "0.25", "1.5", "3", "5", "12", "18", "28", "40"]);

const isoOf = (y, m, d) => {
  const year = y < 100 ? 2000 + y : y;
  const dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/** Printed Indian date (day-first) -> YYYY-MM-DD, or undefined. */
export const toIsoDate = (raw) => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoOf(+m[1], +m[2], +m[3]);
  m = s.match(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/);
  if (m) return isoOf(+m[3], +m[2], +m[1]);
  m = s.match(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s/.,-]*(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?[\s/.,'-]*(\d{4}|\d{2})(?![0-9a-z])/i);
  if (m) return isoOf(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (m) return isoOf(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return undefined;
};

/** "₹ 3,30,855.00" / "Rs. 1,234.5" / "(-) 0.35" -> plain decimal string, or undefined. */
export const toDecimalString = (raw) => {
  if (raw === undefined || raw === null || raw === "" || typeof raw === "boolean") return undefined;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : undefined;
  let s = String(raw).trim();
  const negative = /\(\s*-\s*\)|^\s*-|^\(.*\)$/.test(s);
  s = s.replace(/₹|\bRs\.?|\bINR\b|\/-$|\bonly\b/gi, "").replace(/\(\s*-\s*\)/g, "").replace(/[\s()]/g, "").replace(/^[-+:]+/, "");
  if (!/^(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?$/.test(s)) return undefined;
  s = s.replace(/,/g, "");
  if (s.includes(".")) s = s.replace(/^0+(?=\d)/, "");
  const out = negative && Number(s) !== 0 ? `-${s}` : s;
  return /^-?\d{1,15}(\.\d{1,6})?$/.test(out) ? out : undefined;
};

export const toDocType = (raw) => {
  if (!raw) return undefined;
  const key = String(raw).trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
  return TYPE_ALIASES[key] || (/^[A-Z_]+$/.test(String(raw)) ? String(raw) : undefined);
};

const str = (v) => (v === undefined || v === null || typeof v === "object" ? undefined : String(v).trim() || undefined);

const party = (p) => {
  if (!p || typeof p !== "object") return undefined;
  const gstin = str(p.gstin)?.replace(/\s/g, "").toUpperCase();
  const out = { name: str(p.name) || "" };
  if (gstin && /^[0-9]{2}[0-9A-Z]{13}$/.test(gstin)) {
    out.gstin = gstin;
    out.stateCode = gstin.slice(0, 2);
    out.pan = gstin.slice(2, 12);
  }
  if (!out.stateCode && /^\d{2}$/.test(str(p.stateCode) || "")) out.stateCode = str(p.stateCode);
  return out.name || out.gstin ? out : undefined;
};

/**
 * Any extraction JSON (gateway LLM output or the engine's parse `extracted`)
 * -> object valid as the engine's PartialBusinessDocument.
 */
export const normalizeDraft = (raw = {}) => {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  const type = toDocType(src.type);
  if (type) out.type = type;
  if (str(src.number)) out.number = str(src.number).slice(0, 60);
  const date = toIsoDate(src.date);
  if (date) out.date = date;
  for (const role of ["seller", "buyer"]) {
    const p = party(src[role]);
    if (p) out[role] = p;
  }
  const pos = str(src.placeOfSupply)?.match(/(?<!\d)(\d{2})(?!\d)/);
  if (pos) out.placeOfSupply = pos[1];
  if (str(src.currency)) out.currency = str(src.currency).toUpperCase().slice(0, 3);
  const ref = str(src.externalRef) || str(src.poReference);
  if (ref) out.externalRef = ref.slice(0, 80);
  const t = src.totals && typeof src.totals === "object" ? src.totals : {};
  const taxable = toDecimalString(t.taxable);
  const grand = toDecimalString(t.grand);
  if (taxable && grand) {
    out.totals = { taxable, grand };
    for (const k of ["cgst", "sgst", "igst", "cess", "roundOff"]) out.totals[k] = toDecimalString(t[k]) || "0";
  }
  const g = src.gst && typeof src.gst === "object" ? src.gst : {};
  const irn = str(g.irn)?.replace(/\s/g, "").toLowerCase();
  const gst = {};
  if (irn && /^[0-9a-f]{64}$/.test(irn)) gst.irn = irn;
  if (str(g.ackNo)) gst.ackNo = str(g.ackNo);
  if (str(g.ewayBillNo)) gst.ewayBillNo = str(g.ewayBillNo);
  if (typeof g.reverseCharge === "boolean") gst.reverseCharge = g.reverseCharge;
  if (Object.keys(gst).length) out.gst = gst;
  const lines = [];
  (Array.isArray(src.lines) ? src.lines : []).forEach((l, i) => {
    if (!l || typeof l !== "object") return;
    const qty = toDecimalString(l.qty);
    if (!qty || Number(qty) <= 0) return;
    const line = { lineNo: lines.length + 1, description: (str(l.description) || `Line ${i + 1}`).slice(0, 500), qty };
    const uom = str(l.uom)?.toUpperCase();
    line.uom = uom && UOMS.has(uom) ? uom : "NOS";
    const rate = toDecimalString(l.rate);
    if (rate && !rate.startsWith("-")) line.rate = rate;
    const value = toDecimalString(l.taxableValue ?? l.amount);
    if (value) line.taxableValue = value;
    const hsn = str(l.hsn)?.replace(/\D/g, "");
    if (hsn && hsn.length >= 4 && hsn.length <= 8) line.hsn = hsn;
    const pct = toDecimalString(str(l.gstRate)?.replace("%", ""));
    if (pct && GST_SLABS.has(String(Number(pct)))) line.gstRate = String(Number(pct));
    lines.push(line);
  });
  if (lines.length) out.lines = lines;
  return out;
};

// ------------------------------------------------------------- field maps

const entry = (value, source, confidence, issues = [], quote) => {
  const e = { value, confidence: Math.round(confidence * 1000) / 1000, source, issues };
  if (quote) e.quote = String(quote).slice(0, 200);
  e.needsReview = e.confidence < REVIEW_THRESHOLD || issues.length > 0;
  return e;
};

/**
 * Degraded mode (engine without /v2/docs/fuse): build the reviewable fields
 * map from the normalised draft + /v2/docs/validate output. Confidence is
 * capped below the review threshold — every field is checked by a person.
 */
export const fallbackFields = (draft, validated = {}, source = "text_layer", quotes = {}) => {
  const vf = validated.fields || {};
  const cap = 0.6;
  const issuesFor = (name) => (vf[name]?.issues || []).map(String);
  const quoteOf = (name) => quotes?.[name]?.quote || (typeof quotes?.[name] === "string" ? quotes[name] : undefined);
  const fields = {};
  if (draft.type) fields.type = entry(draft.type, source, cap);
  for (const name of ["number", "date", "placeOfSupply", "currency", "externalRef"]) {
    if (draft[name] !== undefined) fields[name] = entry(draft[name], source, cap, name === "date" ? issuesFor("date") : [], quoteOf(name));
  }
  for (const role of ["seller", "buyer"]) {
    if (!draft[role]) continue;
    fields[role] = entry(draft[role], source, Math.min(cap, vf[`${role}.gstin`]?.confidence ?? cap), issuesFor(`${role}.gstin`), quoteOf(role));
    if (draft[role].name) fields[`${role}Name`] = entry(draft[role].name, source, cap);
  }
  if (draft.totals) fields.totals = entry(draft.totals, source, Math.min(cap, vf["totals.grand"]?.confidence ?? cap), issuesFor("totals.grand"), quoteOf("totals"));
  if (draft.gst) fields.gst = entry(draft.gst, source, cap);
  return fields;
};

const toImageObjects = (pageImages = []) => {
  const out = [];
  let size = 0;
  for (const [i, img] of (pageImages || []).slice(0, 3).entries()) {
    const obj = typeof img === "string" ? { pngBase64: img, mime: "image/png", page: i + 1 } : img;
    const data = obj?.pngBase64 || obj?.data;
    if (!data) continue;
    size += data.length;
    if (size > MAX_IMAGE_PAYLOAD) break;
    out.push({ pngBase64: data, mime: obj.mime || "image/png", page: obj.page || i + 1 });
  }
  return out;
};

const parsedForFuse = (parsed) => {
  const out = {};
  for (const k of ["text", "layoutText", "detectedType", "method", "pages", "qr", "extracted"]) {
    if (parsed[k] !== undefined && parsed[k] !== null) out[k] = parsed[k];
  }
  return out;
};

const llmForFuse = (llm) => {
  const out = {};
  for (const k of ["extracted", "quotes", "fieldConfidence", "model", "usage"]) {
    if (llm[k] !== undefined && llm[k] !== null) out[k] = llm[k];
  }
  return out;
};

const draftMethod = (candidate, parsed, usedLlm) => {
  if (DRAFT_METHODS.has(candidate)) return candidate;
  if (PARSE_METHOD[parsed.method]) return PARSE_METHOD[parsed.method];
  return usedLlm ? "vision_llm" : "text_layer";
};

// ------------------------------------------------------------------- run

export const runExtraction = async (draft, file) => {
  try {
    await ExtractionDraft.updateOne({ id: draft.id }, { $set: { status: "parsing" } });
    const buffer = await getFileBuffer(file);
    const parsed = await enginePost("/v2/docs/parse", {
      fileBase64: buffer.toString("base64"), mime: file.mime,
    }, { timeoutMs: 30000 });

    const issues = [...(parsed.issues || [])];
    let llm;
    let aiUsage;

    if (parsed.needsLlm || parsed.llmRecommended) {
      await ExtractionDraft.updateOne({ id: draft.id }, { $set: { status: "extracting" } });
      const text = typeof parsed.text === "string" && parsed.text.trim() ? parsed.text.slice(0, MAX_LLM_TEXT) : undefined;
      const pageImages = toImageObjects(parsed.pageImages);
      if (text || pageImages.length) {
        try {
          llm = await gatewayPost("/internal/llm/extract", {
            task: parsed.detectedType?.toLowerCase() || "generic",
            text,
            pageImages,
            schemaVersion: "v1",
            dataPolicy: dataPolicy(),
          }, { timeoutMs: 60000 });
          aiUsage = { ...(llm.usage || {}), model: llm.model };
        } catch (err) {
          issues.push(err.code === "AI_POLICY_BLOCKED"
            ? { code: "AI_POLICY_BLOCKED", severity: "info", message: "AI reading is off for this document under the data policy — review the fields read from the file" }
            : { code: "LLM_UNAVAILABLE", severity: "warning", message: "AI reading unavailable — extracted fields may be incomplete; review carefully" });
        }
      }
    }

    let result;
    if (!llm && parsed.fields) {
      // Engine already fused the deterministic sources (text layer + QR).
      result = {
        method: parsed.extractionMethod, detectedType: parsed.detectedType, fields: parsed.fields,
        lines: parsed.lines || [], issues: parsed.fieldIssues || [], suggestions: parsed.suggestions || {},
      };
    } else {
      result = await enginePost("/v2/docs/fuse", {
        parsed: parsedForFuse(parsed), ...(llm ? { llm: llmForFuse(llm) } : {}),
      }, { timeoutMs: 20000 }).catch(() => null);
    }

    if (!result) {
      // Older engine (no /v2/docs/fuse): normalise, validate, review everything.
      const source = llm ? "vision_llm" : "text_layer";
      const normalized = normalizeDraft({ ...(parsed.extracted || {}), ...(llm?.extracted || {}) });
      const validated = await enginePost("/v2/docs/validate", {
        draft: normalized, ...(parsed.qr?.fields ? { qrFields: parsed.qr.fields } : {}),
      }, { timeoutMs: 15000 }).catch(() => {
        issues.push({ code: "VALIDATE_SKIPPED", severity: "warning", message: "Field validation unavailable — every field needs a manual check" });
        return { fields: {}, lines: normalized.lines || [], issues: [], suggestions: {} };
      });
      result = {
        method: llm ? "vision_llm" : undefined,
        detectedType: normalized.type,
        fields: fallbackFields(normalized, validated, source, llm?.quotes),
        lines: (validated.lines || normalized.lines || []).map((l) => ({ ...l, amount: l.taxableValue, source, confidence: 0.6, needsReview: true })),
        issues: validated.issues || [],
        suggestions: { ...(validated.suggestions || {}), poNumber: normalized.externalRef },
      };
    }

    await ExtractionDraft.updateOne({ id: draft.id }, {
      $set: {
        status: "needs_review", // never auto-confirmed: a person confirms every draft
        detectedType: result.detectedType || parsed.detectedType || result.fields?.type?.value,
        method: draftMethod(result.method, parsed, Boolean(llm)),
        fields: result.fields || {},
        lines: result.lines || [],
        issues: [...issues, ...(result.issues || [])],
        suggestions: result.suggestions || {},
        aiUsage,
      },
    });
    return { autoOk: false };
  } catch (error) {
    await ExtractionDraft.updateOne({ id: draft.id }, {
      $set: { status: "failed", method: "failed", issues: [{ code: error.code || "EXTRACTION_FAILED", severity: "error", message: error.message }] },
    });
    return { autoOk: false, error };
  }
};
