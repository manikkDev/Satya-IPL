// Whitelist projection of Mongo documents onto the engine's v2 contract.
//
// The engine's BusinessDocument/DocumentLink models are extra="forbid": a
// single unknown field anywhere (gst.itcReversed, gst.ewb, gst.irnStatus,
// payment.tds, top-level bpi, terms.templateId ...) used to 422 the whole
// reconcile for a supplier. Instead of a blacklist that is always one field
// behind, every document is projected onto the JSON schema generated from
// the engine contract (lib/engineContract.json): unknown keys are dropped,
// invalid OPTIONAL values are dropped, numbers are coerced to the decimal
// strings the contract wants, and a document whose REQUIRED fields cannot be
// satisfied is skipped with a recorded reason instead of failing the case.
import { createRequire } from "node:module";
import { fyOf, isRealDate } from "../lib/fy.js";
import { rawAmount, toDecimal, toPaiseOrNull, mulRate, fromPaise } from "../lib/money.js";

const require = createRequire(import.meta.url);
const CONTRACT = require("../lib/engineContract.json");

const INVALID = Symbol("invalid");
const DECIMAL_PATTERN = "^-?\\d{1,15}(\\.\\d{1,6})?$";
const regexCache = new Map();
const rx = (pattern) => {
  if (!regexCache.has(pattern)) regexCache.set(pattern, new RegExp(pattern));
  return regexCache.get(pattern);
};

const resolveRef = (node, defs) => {
  let n = node;
  while (n && n.$ref) n = defs[n.$ref.replace("#/$defs/", "")];
  return n;
};

const decimalText = (value) => {
  const raw = rawAmount(value);
  if (raw === null) return null;
  const text = typeof raw === "number" ? String(raw) : String(raw);
  if (rx(DECIMAL_PATTERN).test(text)) return text;
  const n = Number(text);
  if (!Number.isFinite(n)) return null;
  const fixed = n.toFixed(6).replace(/\.?0+$/, "");
  return rx(DECIMAL_PATTERN).test(fixed) ? fixed : null;
};

const projectString = (value, node) => {
  let v = value;
  if (v instanceof Date) v = v.toISOString();
  if (node.pattern === DECIMAL_PATTERN) v = decimalText(v);
  else if (typeof v === "number" || typeof v === "bigint") v = String(v);
  if (typeof v !== "string") return INVALID;
  if (node.pattern && !rx(node.pattern).test(v)) return INVALID;
  if (node.enum && !node.enum.includes(v)) return INVALID;
  if (node.const !== undefined && v !== node.const) return INVALID;
  if (node.maxLength !== undefined && v.length > node.maxLength) return INVALID;
  return v;
};

/** Project `value` onto schema `node`; returns INVALID when it can't conform. */
export const project = (value, node, defs) => {
  node = resolveRef(node, defs);
  if (!node || value === undefined) return INVALID;
  if (node.anyOf) {
    if (value === null) return node.anyOf.some((b) => b.type === "null") ? null : INVALID;
    for (const branch of node.anyOf) {
      if (branch.type === "null") continue;
      const out = project(value, branch, defs);
      if (out !== INVALID) return out;
    }
    return INVALID;
  }
  if (node.enum && !node.type) return node.enum.includes(value) ? value : INVALID;
  if (node.const !== undefined && !node.type) return value === node.const ? value : INVALID;
  switch (node.type) {
    case "null": return value === null ? null : INVALID;
    case "string": return projectString(value, node);
    case "integer": {
      const n = typeof value === "string" && /^-?\d+$/.test(value) ? Number(value) : value;
      return Number.isInteger(n) ? n : INVALID;
    }
    case "number": {
      const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      return typeof n === "number" && Number.isFinite(n) ? n : INVALID;
    }
    case "boolean": return typeof value === "boolean" ? value : INVALID;
    case "array": {
      if (!Array.isArray(value)) return INVALID;
      const items = value.map((x) => project(x, node.items, defs)).filter((x) => x !== INVALID);
      return node.maxItems !== undefined ? items.slice(0, node.maxItems) : items;
    }
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return INVALID;
      if (!node.properties) {
        // dict[str, X]
        const ap = node.additionalProperties;
        if (!ap || ap === true) return value;
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, project(v, ap, defs)]).filter(([, v]) => v !== INVALID));
      }
      const out = {};
      const required = new Set(node.required || []);
      for (const [key, sub] of Object.entries(node.properties)) {
        if (value[key] === undefined) continue;
        const projected = project(value[key], sub, defs);
        if (projected === INVALID) {
          if (required.has(key)) return INVALID;
          continue;
        }
        out[key] = projected;
      }
      for (const key of required) if (out[key] === undefined) return INVALID;
      return out;
    }
    default:
      return value;
  }
};

const DOC_SCHEMA = CONTRACT.BusinessDocument;
const LINK_SCHEMA = CONTRACT.DocumentLink;
const docProps = DOC_SCHEMA.properties;
const enumOf = (node) => resolveRef(node, DOC_SCHEMA.$defs)?.enum || [];
const CHANNELS = new Set(enumOf(DOC_SCHEMA.$defs.Source.properties.channel));
const DOC_TYPES = new Set(enumOf(docProps.type));
const STATUSES = new Set(enumOf(docProps.status));
const PROVENANCES = new Set(enumOf(docProps.provenance));
const PAY_MODES = new Set((DOC_SCHEMA.$defs.Payment.properties.mode.anyOf || []).flatMap((b) => b.enum || []));

const isoOrNull = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const moneyStr = (v) => (v === null || v === undefined ? "0.00" : toDecimal(v));

/**
 * Normalise known server-side shapes to the contract BEFORE projection
 * (renames / reshapes that a pure whitelist can't infer).
 * Returns {doc} or {skip: reason}.
 */
export const prepareDocument = (d) => {
  if (!DOC_TYPES.has(d.type)) return { skip: `type ${d.type} not accepted by the engine` };
  if (!STATUSES.has(d.status)) return { skip: `status ${d.status} not accepted by the engine` };
  if (!isRealDate(d.date)) return { skip: `invalid business date ${JSON.stringify(d.date)}` };
  const doc = { ...d };
  const notes = [];

  // number: required by the engine; imported/system docs may not carry one
  if (!doc.number) {
    doc.number = doc.externalRef ? String(doc.externalRef) : `UNNUMBERED-${doc.id}`;
    notes.push("number synthesized");
  }
  doc.fy = /^\d{4}-\d{2}$/.test(doc.fy || "") ? doc.fy : fyOf(doc.date);
  const created = isoOrNull(doc.createdAt) || isoOrNull(doc.observedAt) || `${doc.date}T00:00:00+05:30`;
  doc.createdAt = created;
  doc.updatedAt = isoOrNull(doc.updatedAt) || created;
  doc.observedAt = isoOrNull(doc.observedAt) || created;
  doc.createdBy = doc.createdBy || "satya:system";
  doc.revision = Number.isInteger(doc.revision) ? doc.revision : 0;
  doc.currency = doc.currency || "INR";
  if (!PROVENANCES.has(doc.provenance)) doc.provenance = "SYSTEM_GENERATED";

  // source.channel: map non-contract channels (e.g. "compliance") to "api"
  const src = doc.source && typeof doc.source === "object" ? { ...doc.source } : {};
  if (!CHANNELS.has(src.channel)) {
    if (src.channel) src.sourceSystem = src.sourceSystem || String(src.channel);
    src.channel = "api";
  }
  doc.source = src;

  // parties are required
  doc.seller = { name: "Unknown party", ...(doc.seller || {}) };
  doc.buyer = { name: "Unknown party", ...(doc.buyer || {}) };
  for (const p of ["seller", "buyer"]) if (!doc[p].name) doc[p].name = "Unknown party";

  // totals: Money objects / numbers -> decimal strings; estimate when absent
  const t = doc.totals || {};
  const grand = toPaiseOrNull(t.grand ?? t.grandTotal);
  const lineSum = (doc.lines || []).reduce((s, l) => {
    const v = toPaiseOrNull(l.lineTotal ?? l.taxableValue ?? l.amount);
    if (v !== null) return s + v;
    return s + (toPaiseOrNull(mulRate(l.rate, String(rawAmount(l.qty) ?? "0"))) ?? 0n);
  }, 0n);
  const sumStr = fromPaise(lineSum);
  if (doc.totals || doc.lines?.length) {
    doc.totals = {
      taxable: toPaiseOrNull(t.taxable) ? moneyStr(t.taxable) : sumStr,
      cgst: moneyStr(t.cgst), sgst: moneyStr(t.sgst), igst: moneyStr(t.igst), cess: moneyStr(t.cess),
      roundOff: moneyStr(t.roundOff),
      grand: grand ? moneyStr(t.grand ?? t.grandTotal) : sumStr,
    };
  }

  // lines: contract requires description + uom; fill from what we know
  doc.lines = (doc.lines || []).map((l, i) => ({
    ...l,
    lineNo: Number.isInteger(l.lineNo) ? l.lineNo : i + 1,
    description: l.description || l.sku || l.hsn || `Line ${i + 1}`,
    uom: l.uom || "EA",
  }));

  // payment: tds block -> tdsAmount; TDS entries carry amount inside tds
  if (doc.payment && typeof doc.payment === "object") {
    const pay = { ...doc.payment };
    if (pay.tds && pay.tdsAmount === undefined && toPaiseOrNull(pay.tds.amount)) pay.tdsAmount = toDecimal(pay.tds.amount);
    if (pay.amount === undefined || pay.amount === null) {
      if (pay.tds?.amount) pay.amount = toDecimal(pay.tds.amount);
    } else {
      pay.amount = toDecimal(pay.amount);
    }
    if (pay.mode) {
      const mode = String(pay.mode).toUpperCase();
      pay.mode = PAY_MODES.has(mode) ? mode : "OTHER";
    }
    pay.allocations = (pay.allocations || []).map((a) => ({
      ...a, amount: toDecimal(a.amount), basis: ["reference", "reviewer", "remittance"].includes(a.basis) ? a.basis : "reference",
    }));
    doc.payment = pay;
  }

  // gst: standardise the e-way bill number on gst.ewayBillNo
  if (doc.gst && typeof doc.gst === "object") {
    const gst = { ...doc.gst };
    if (!gst.ewayBillNo && (gst.ewb || doc.ewayBillNo)) gst.ewayBillNo = String(gst.ewb || doc.ewayBillNo);
    doc.gst = gst;
  } else if (doc.ewayBillNo) {
    doc.gst = { ewayBillNo: String(doc.ewayBillNo) };
  }

  // shipTo: strict address; reshape when a pincode exists, else drop
  if (doc.shipTo) {
    const s = doc.shipTo;
    const pincode = s.pincode || s.pin;
    doc.shipTo = pincode
      ? { line1: s.line1 || s.address || s.label || "—", city: s.city || "—", stateCode: s.stateCode || s.state || "—", pincode: String(pincode), country: s.country || "IN" }
      : undefined;
  }
  return { doc, notes };
};

/** Project a document; {document} on success or {skip: reason}. */
export const toEngineDocument = (raw) => {
  const prepared = prepareDocument(raw);
  if (prepared.skip) return { skip: prepared.skip };
  const out = project(JSON.parse(JSON.stringify(prepared.doc, (_k, v) => (typeof v === "bigint" ? String(v) : v))), DOC_SCHEMA, DOC_SCHEMA.$defs);
  if (out === INVALID) {
    const missing = (DOC_SCHEMA.required || []).filter((k) => project(prepared.doc[k], docProps[k], DOC_SCHEMA.$defs) === INVALID);
    return { skip: `cannot satisfy engine contract (${missing.join(", ") || "structure"})` };
  }
  return { document: out, notes: prepared.notes };
};

export const toEngineLink = (raw) => {
  const l = { ...raw, certainty: raw.certainty || "CONFIRMED" };
  if (l.amount !== undefined && l.amount !== null) l.amount = { amount: toDecimal(l.amount), currency: l.amount?.currency || "INR" };
  if (l.basis === "model" && (l.confidence === undefined || l.confidence === null)) return null;
  const out = project(JSON.parse(JSON.stringify(l)), LINK_SCHEMA, LINK_SCHEMA.$defs || {});
  return out === INVALID ? null : out;
};

/** Project a whole case input; returns {documents, links, skipped}. */
export const toEngineInputs = (documents, links) => {
  const skipped = [];
  const docs = [];
  const synthesized = [];
  for (const d of documents) {
    const r = toEngineDocument(d);
    if (r.skip) skipped.push({ id: d.id, type: d.type, reason: r.skip });
    else {
      docs.push(r.document);
      if (r.notes?.length) synthesized.push({ id: d.id, notes: r.notes });
    }
  }
  const outLinks = [];
  for (const l of links) {
    const p = toEngineLink(l);
    if (p) outLinks.push(p);
    else skipped.push({ id: l.id || `${l.fromId}->${l.toId}`, type: "link", reason: "link does not satisfy engine contract" });
  }
  return { documents: docs, links: outLinks, skipped, synthesized };
};
