#!/usr/bin/env node
// Invariant checker for the curated demo dataset. Runs on the in-memory
// build (before anything is written) and — with --db — on what is actually
// stored for the demo group. Every deliberate deviation must be declared by a
// story's expected finding codes; anything else is a failure.
//
//   node src/seed/validate.js          # validate a fresh in-memory build
//   node src/seed/validate.js --db     # validate the demo group in Mongo
import { fileURLToPath } from "node:url";
import { ENTITY, SUPPLIERS, ITEMS } from "./company.js";
import { STORIES } from "./stories.js";
import { DEVIATION_CODES } from "./build.js";
import { toPaise, fmt, lineAmount, lineTax } from "./money.js";
import { fyOf, diffDays } from "./dates.js";
import {
  validateGstin, PAN_PATTERN, PAN_HOLDER, STATES, pinMatchesState, UDYAM_PATTERN,
  udyamMatchesState, IFSC_PATTERN, CIN_PATTERN, UTR_PATTERNS,
} from "./india.js";

// ---- engine contract (ml-fl-service/satya_engine/contracts_v2.py, extra=forbid) ----
// Keys the server strips before calling the engine (services/reconcile.js).
const SERVER_ONLY = ["_id", "__v", "supplierId", "approvals", "requiredApprovers", "contentHash", "issuedAt", "caseId", "taxSummary", "taxWarnings", "irn", "rateSource", "utgst", "remarks", "packing"];
const ALLOWED = {
  doc: ["id", "groupId", "entityId", "type", "number", "externalRef", "date", "fy", "status", "revision", "supersedes", "seller", "buyer", "shipTo", "placeOfSupply", "currency", "fx", "lines", "charges", "totals", "payment", "gst", "terms", "source", "provenance", "observedAt", "createdAt", "createdBy", "updatedAt", ...SERVER_ONLY],
  party: ["name", "gstin", "pan", "stateCode", "address", "udyam", "supplierId"],
  udyam: ["number", "category"],
  line: ["lineNo", "itemId", "sku", "description", "specs", "hsn", "uom", "qty", "rate", "discountPct", "taxableValue", "gstRate", "cgst", "sgst", "igst", "cess", "lineTotal", "scheduleDate", "refs", "acceptedQty", "rejectedQty", "rejectReason", "batch", "_id"],
  refs: ["poId", "poLineNo", "grnId", "grnLineNo", "invoiceId", "invoiceLineNo"],
  totals: ["taxable", "cgst", "sgst", "igst", "cess", "roundOff", "grand"],
  payment: ["amount", "utr", "mode", "valueDate", "bankAccountMasked", "allocations", "tdsAmount", "reversalOf"],
  allocation: ["documentId", "amount", "basis", "_id"],
  gst: ["irn", "ackNo", "ackDate", "signedQr", "ewayBillNo", "reverseCharge", "lut", "supplyType"],
  terms: ["paymentTerms", "creditDays", "advancePct", "deliveryTerms", "inspection", "warranty", "penalty", "validityDays", "freeText"],
  source: ["channel", "fileId", "extractionDraftId", "sourceSystem"],
  link: ["id", "fromId", "toId", "kind", "lineRefs", "certainty", "confidence", "amount", "qty", "basis", "createdBy", "decisionId", "groupId", "createdAt", "updatedAt", "_id", "__v"],
};
const STATUSES = ["draft", "pending_approval", "approved", "issued", "acknowledged", "partially_fulfilled", "fulfilled", "short_closed", "cancelled", "posted", "reversed", "confirmed", "rejected"];
const CHANNELS = ["created_in_satya", "upload_pdf", "upload_image", "csv", "excel", "json", "einvoice_json", "bank_csv", "gstr2b_json", "api"];
const DECIMAL = /^-?\d{1,15}(\.\d{1,6})?$/;
const MONEY2 = /^-?\d+\.\d{2}$/;
const OFFSET_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const extraKeys = (obj, allowed) => Object.keys(obj || {}).filter((k) => !allowed.includes(k));

export const validateDataset = ({ documents, links, cases, suppliers = SUPPLIERS, items = ITEMS, entity = ENTITY, today }) => {
  const results = [];
  const check = (name, fn) => {
    const failures = [];
    try { fn((msg) => failures.push(msg)); } catch (e) { failures.push(`threw: ${e.message}`); }
    results.push({ name, pass: failures.length === 0, failures });
  };
  const byId = new Map(documents.map((d) => [d.id, d]));
  const supById = new Map(suppliers.map((s) => [s.id, s]));
  const storyOf = (d) => STORIES.find((s) => `case_cur_${s.id.toLowerCase()}` === d.caseId);
  const declares = (story, kind) => Boolean(story && story.expected.some((c) => DEVIATION_CODES[kind].includes(c)));
  const poLinesOf = (poId) => byId.get(poId)?.lines || [];

  // ---------------- identities ----------------
  check("entity: GSTIN format + checksum + PAN + state", (fail) => {
    const v = validateGstin(entity.gstin);
    if (!v.wellFormed || !v.checksumValid) fail(`entity GSTIN ${entity.gstin} invalid`);
    if (v.panEmbedded !== entity.pan) fail(`entity GSTIN PAN ${v.panEmbedded} != PAN ${entity.pan}`);
    if (entity.pan[3] !== "C") fail(`entity PAN 4th char ${entity.pan[3]} != C (company)`);
    if (v.stateCode !== entity.stateCode) fail("entity GSTIN state != entity state");
    const addr = entity.address || entity.addresses?.billing;
    if (addr && !pinMatchesState(addr.pin, entity.stateCode)) fail(`entity PIN ${addr.pin} not in state ${entity.stateCode}`);
    if (entity.cin && !CIN_PATTERN.test(entity.cin)) fail(`CIN ${entity.cin} malformed`);
    if (entity.cin && entity.cin.slice(6, 8) !== STATES[entity.stateCode].udyam.replace("KR", "KA")) fail(`CIN state ${entity.cin.slice(6, 8)} != entity state`);
  });

  check("suppliers: GSTIN/PAN/holder/state/PIN/Udyam/IFSC/terms", (fail) => {
    const seenPan = new Set(), seenGstin = new Set();
    for (const s of suppliers) {
      const gstin = s.gstin || s.gstins?.[0]?.gstin;
      const v = validateGstin(gstin);
      if (!v.wellFormed || !v.checksumValid) fail(`${s.legalName}: GSTIN ${gstin} fails format/checksum`);
      if (!PAN_PATTERN.test(s.pan)) fail(`${s.legalName}: PAN ${s.pan} malformed`);
      if (v.panEmbedded !== s.pan) fail(`${s.legalName}: GSTIN PAN ${v.panEmbedded} != PAN ${s.pan}`);
      if (s.holder && s.pan[3] !== PAN_HOLDER[s.holder]) fail(`${s.legalName}: PAN holder char ${s.pan[3]} != ${PAN_HOLDER[s.holder]} (${s.holder})`);
      if (/\b(Pvt Ltd|Ltd)\b/.test(s.legalName) && s.pan[3] !== "C") fail(`${s.legalName}: company without C PAN`);
      if (/\bLLP\b/.test(s.legalName) && s.pan[3] !== "F") fail(`${s.legalName}: LLP without F PAN`);
      const stateCode = s.stateCode || s.gstins?.[0]?.stateCode;
      if (v.stateCode !== stateCode) fail(`${s.legalName}: GSTIN state ${v.stateCode} != ${stateCode}`);
      const pin = s.address?.pin || s.addresses?.[0]?.pin;
      if (!pinMatchesState(pin, stateCode)) fail(`${s.legalName}: PIN ${pin} not in ${STATES[stateCode]?.name || stateCode}`);
      if (/\(Unit \d+\)/.test(s.legalName)) fail(`${s.legalName}: synthetic unit suffix`);
      if (s.udyam) {
        if (!UDYAM_PATTERN.test(s.udyam.number)) fail(`${s.legalName}: Udyam ${s.udyam.number} malformed`);
        if (!udyamMatchesState(s.udyam.number, stateCode)) fail(`${s.legalName}: Udyam state != ${stateCode}`);
        const days = s.termsDays ?? s.paymentTermsDays;
        if (["micro", "small"].includes(s.udyam.category) && days > 45) fail(`${s.legalName}: ${s.udyam.category} enterprise on ${days}-day terms (> 45)`);
      }
      const ifsc = s.bank?.ifsc || s.bankAccounts?.[0]?.ifsc;
      if (!IFSC_PATTERN.test(ifsc || "")) fail(`${s.legalName}: IFSC ${ifsc} malformed`);
      if (seenPan.has(s.pan)) fail(`${s.legalName}: duplicate PAN`);
      if (seenGstin.has(gstin)) fail(`${s.legalName}: duplicate GSTIN`);
      seenPan.add(s.pan); seenGstin.add(gstin);
    }
  });

  check("items: 8-digit HSN, GST rate 5 (water pumps 8413 70) or 18, no 28%", (fail) => {
    for (const i of items) {
      const rate = i.gstRate || i.defaultGstRate;
      if (!/^\d{8}$/.test(i.hsn)) fail(`${i.code}: HSN ${i.hsn} not 8-digit`);
      const want = i.hsn.startsWith("841370") ? "5" : "18";
      if (rate !== want) fail(`${i.code}: rate ${rate} != expected ${want} for HSN ${i.hsn}`);
    }
  });

  // ---------------- documents ----------------
  check("documents: engine contract shape (no forbidden fields)", (fail) => {
    for (const d of documents) {
      const bad = extraKeys(d, ALLOWED.doc);
      if (bad.length) fail(`${d.id}: extra fields ${bad.join(",")}`);
      for (const role of ["seller", "buyer"]) {
        if (extraKeys(d[role], ALLOWED.party).length) fail(`${d.id}.${role}: extra ${extraKeys(d[role], ALLOWED.party)}`);
        if (d[role]?.udyam && extraKeys(d[role].udyam, ALLOWED.udyam).length) fail(`${d.id}.${role}.udyam: extra fields`);
      }
      for (const l of d.lines || []) {
        if (extraKeys(l, ALLOWED.line).length) fail(`${d.id} line ${l.lineNo}: extra ${extraKeys(l, ALLOWED.line)}`);
        if (l.refs && extraKeys(l.refs, ALLOWED.refs).length) fail(`${d.id} line ${l.lineNo} refs: extra ${extraKeys(l.refs, ALLOWED.refs)}`);
        for (const k of ["qty", "rate", "taxableValue", "gstRate", "cgst", "sgst", "igst", "cess", "lineTotal", "acceptedQty", "rejectedQty"]) {
          if (l[k] !== undefined && (typeof l[k] !== "string" || !DECIMAL.test(l[k]))) fail(`${d.id} line ${l.lineNo}.${k} not a decimal string`);
        }
        if (!l.description || !l.uom) fail(`${d.id} line ${l.lineNo}: description/uom required`);
      }
      if (d.totals && (extraKeys(d.totals, ALLOWED.totals).length || ALLOWED.totals.some((k) => !MONEY2.test(d.totals[k] ?? "")))) fail(`${d.id}: totals must be exactly ${ALLOWED.totals} as 2-dp strings`);
      if (d.payment) {
        if (extraKeys(d.payment, ALLOWED.payment).length) fail(`${d.id}.payment extra ${extraKeys(d.payment, ALLOWED.payment)}`);
        for (const a of d.payment.allocations || []) if (extraKeys(a, ALLOWED.allocation).length || !["reference", "reviewer", "remittance"].includes(a.basis)) fail(`${d.id} allocation shape`);
        if (!["NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER"].includes(d.payment.mode)) fail(`${d.id}: mode ${d.payment.mode}`);
      }
      if (d.gst && extraKeys(d.gst, ALLOWED.gst).length) fail(`${d.id}.gst extra ${extraKeys(d.gst, ALLOWED.gst)}`);
      if (d.gst?.ackDate && !OFFSET_TS.test(d.gst.ackDate)) fail(`${d.id}: ackDate needs offset`);
      if (d.gst?.irn && !/^[0-9a-f]{64}$/.test(d.gst.irn)) fail(`${d.id}: IRN not 64-hex`);
      if (d.terms && extraKeys(d.terms, ALLOWED.terms).length) fail(`${d.id}.terms extra ${extraKeys(d.terms, ALLOWED.terms)}`);
      if (!d.source || extraKeys(d.source, ALLOWED.source).length || !CHANNELS.includes(d.source.channel)) fail(`${d.id}: source invalid`);
      if (d.shipTo && !(d.shipTo.pincode || d.shipTo.pin)) fail(`${d.id}: shipTo without pincode`);
      if (!STATUSES.includes(d.status)) fail(`${d.id}: status ${d.status}`);
      if (d.provenance !== "CONSTRUCTED_DEMO") fail(`${d.id}: provenance ${d.provenance}`);
      if (!d.number) fail(`${d.id}: number required by engine contract`);
      if (!OFFSET_TS.test(d.observedAt || "")) fail(`${d.id}: observedAt needs explicit offset`);
      if (!d.createdBy) fail(`${d.id}: createdBy missing`);
    }
  });

  check("dates: none in the future, FY tag matches date", (fail) => {
    for (const d of documents) {
      if (d.date > today) fail(`${d.id}: date ${d.date} is after today ${today}`);
      if (d.observedAt.slice(0, 10) > today) fail(`${d.id}: observed in the future`);
      if (d.fy !== fyOf(d.date)) fail(`${d.id}: fy ${d.fy} != ${fyOf(d.date)}`);
      if (d.payment?.valueDate && d.payment.valueDate > today) fail(`${d.id}: value date in the future`);
      if (d.gst?.ackDate && d.gst.ackDate.slice(0, 10) !== d.date) fail(`${d.id}: IRN ack date != invoice date`);
    }
  });

  check("numbers: unique, entity series + FY tag, supplier numbers ≤16 chars", (fail) => {
    const seen = new Map();
    for (const d of documents) {
      const own = ["PO", "GRN", "QC", "RETURN", "PAYMENT_OUT"].includes(d.type);
      const key = own ? `${d.type}|${d.number}` : `${d.type}|${d.seller.gstin}|${d.seller.supplierId}|${d.number}|${d.fy}`;
      if (seen.has(key)) {
        const ex = d.type === "INVOICE_IN" && exceptionsOf(d, documents);
        if (!ex) fail(`${d.id}: duplicate number ${d.number} (also ${seen.get(key)})`);
      }
      seen.set(key, d.id);
      if (own) {
        const tag = d.fy.slice(2);
        if (!new RegExp(`^${ENTITY.code}/[A-Z]+/${tag}/\\d{6}$`).test(d.number)) fail(`${d.id}: ${d.number} not ${ENTITY.code}/<DOC>/${tag}/NNNNNN`);
      } else if (d.number.length > 16) fail(`${d.id}: supplier document number ${d.number} > 16 chars (CGST Rule 46)`);
    }
  });

  check("chronology: PO ≤ GRN ≤ QC ≤ invoice ≤ payment; schedules after PO", (fail) => {
    for (const po of documents.filter((d) => d.type === "PO")) {
      const story = storyOf(po);
      const chain = documents.filter((d) => d.caseId === po.caseId && d.id !== po.id);
      const of = (t) => chain.filter((d) => d.type === t);
      for (const d of chain) if (d.date < po.date) fail(`${d.id} (${d.date}) precedes PO ${po.date}`);
      for (const l of po.lines) if (l.scheduleDate <= po.date) fail(`${po.id} line ${l.lineNo}: schedule ${l.scheduleDate} not after PO date`);
      const firstGrn = of("GRN").map((d) => d.date).sort()[0];
      for (const qc of of("QC")) if (!firstGrn || qc.date < firstGrn) fail(`${qc.id}: QC before GRN`);
      const lastQc = of("QC").map((d) => d.date).sort().at(-1);
      for (const inv of of("INVOICE_IN")) {
        if (!firstGrn && !story?.allowInvoiceBeforeReceipt) fail(`${inv.id}: invoice with no GRN not declared by story`);
        if (firstGrn && inv.date < firstGrn) fail(`${inv.id}: invoice ${inv.date} before GRN ${firstGrn}`);
        if (lastQc && inv.date < lastQc) fail(`${inv.id}: invoice ${inv.date} before QC ${lastQc}`);
      }
      for (const r of of("RETURN")) if (!firstGrn || r.date < firstGrn) fail(`${r.id}: return before receipt`);
      for (const p of of("PAYMENT_OUT")) for (const a of p.payment.allocations || []) {
        const inv = byId.get(a.documentId);
        if (inv && p.date < inv.date) fail(`${p.id}: paid ${p.date} before invoice ${inv.date}`);
      }
      for (const cn of of("CREDIT_NOTE_IN")) for (const l of cn.lines) {
        const inv = byId.get(l.refs?.invoiceId);
        if (!inv || cn.date < inv.date) fail(`${cn.id}: credit note before its invoice`);
      }
    }
  });

  check("line math: taxable = qty × rate, GST split, line totals, document totals", (fail) => {
    for (const d of documents.filter((x) => x.totals && ["PO", "INVOICE_IN", "CREDIT_NOTE_IN"].includes(x.type))) {
      const supplier = supById.get(d.supplierId);
      const intraBySupply = supplier.stateCode === (d.placeOfSupply || entity.stateCode);
      const ex = exceptionsOf(d, documents) || {};
      const intra = ex.forceIgst ? false : intraBySupply;
      let taxable = 0n, cgst = 0n, sgst = 0n, igst = 0n, grand = 0n;
      for (const l of d.lines) {
        const t = lineAmount(l.qty, l.rate);
        const tax = lineTax(t, l.gstRate, intra);
        if (fmt(t) !== l.taxableValue) fail(`${d.id} line ${l.lineNo}: taxable ${l.taxableValue} != ${fmt(t)}`);
        if (fmt(tax.cgst) !== l.cgst || fmt(tax.sgst) !== l.sgst || fmt(tax.igst) !== l.igst) fail(`${d.id} line ${l.lineNo}: tax split wrong`);
        if (toPaise(l.cgst) + toPaise(l.sgst) + toPaise(l.igst) !== tax.tax) fail(`${d.id} line ${l.lineNo}: CGST+SGST+IGST != tax`);
        if (intra && toPaise(l.igst) !== 0n) fail(`${d.id} line ${l.lineNo}: IGST on intra-state supply`);
        if (!intra && toPaise(l.cgst) + toPaise(l.sgst) !== 0n) fail(`${d.id} line ${l.lineNo}: CGST/SGST on inter-state supply`);
        if (fmt(t + tax.tax) !== l.lineTotal) fail(`${d.id} line ${l.lineNo}: lineTotal`);
        taxable += t; cgst += tax.cgst; sgst += tax.sgst; igst += tax.igst; grand += t + tax.tax;
      }
      const T = d.totals;
      if (fmt(taxable) !== T.taxable || fmt(cgst) !== T.cgst || fmt(sgst) !== T.sgst || fmt(igst) !== T.igst) fail(`${d.id}: totals != sum of lines`);
      const parts = ["taxable", "cgst", "sgst", "igst", "cess", "roundOff"].reduce((s, k) => s + toPaise(T[k]), 0n);
      if (parts !== toPaise(T.grand) || fmt(grand) !== T.grand) fail(`${d.id}: grand ${T.grand} != parts ${fmt(parts)}`);
      if (Boolean(ex.forceIgst) !== (intraBySupply !== intra)) fail(`${d.id}: tax type deviation not declared`);
      if (ex.forceIgst && !declares(storyOf(d), "taxType")) fail(`${d.id}: IGST-on-intra not declared by its story`);
    }
  });

  check("parties: seller GSTIN matches supplier master; buyer is the entity", (fail) => {
    for (const d of documents) {
      const s = supById.get(d.supplierId);
      if (!s) { fail(`${d.id}: unknown supplier ${d.supplierId}`); continue; }
      const masterGstin = s.gstin || s.gstins?.[0]?.gstin;
      if (d.seller.gstin !== masterGstin) {
        const v = validateGstin(d.seller.gstin);
        if (!(d.type === "INVOICE_IN" && declares(storyOf(d), "gstinInvalid") && !v.checksumValid)) fail(`${d.id}: seller GSTIN ${d.seller.gstin} != master ${masterGstin}`);
      }
      if (d.seller.stateCode !== (s.stateCode || s.gstins?.[0]?.stateCode)) fail(`${d.id}: seller state`);
      if (d.seller.supplierId !== s.id) fail(`${d.id}: seller.supplierId`);
      if (d.buyer.gstin !== entity.gstin || d.buyer.name !== entity.legalName) fail(`${d.id}: buyer is not the entity`);
    }
  });

  check("quantities: received ≤ ordered, QC accepted+rejected = inspected, billing per story", (fail) => {
    for (const po of documents.filter((d) => d.type === "PO")) {
      const story = storyOf(po);
      const chain = documents.filter((d) => d.caseId === po.caseId);
      for (const l of po.lines) {
        const sumOf = (type, field = "qty") => chain.filter((d) => d.type === type).flatMap((d) => d.lines).filter((x) => x.refs?.poId === po.id && x.refs?.poLineNo === l.lineNo).reduce((s, x) => s + Number(x[field] ?? 0), 0);
        const ordered = Number(l.qty), received = sumOf("GRN"), returned = sumOf("RETURN"), accepted = sumOf("QC", "acceptedQty"), rejected = sumOf("QC", "rejectedQty");
        const invoices = chain.filter((d) => d.type === "INVOICE_IN");
        const billed = invoices.filter((d) => !exceptionsOf(d, documents)?.duplicateOf).flatMap((d) => d.lines).filter((x) => x.refs?.poLineNo === l.lineNo).reduce((s, x) => s + Number(x.qty), 0);
        const billedAll = invoices.flatMap((d) => d.lines).filter((x) => x.refs?.poLineNo === l.lineNo).reduce((s, x) => s + Number(x.qty), 0);
        if (received > ordered) fail(`${po.number} line ${l.lineNo}: received ${received} > ordered ${ordered}`);
        if (returned > rejected && returned > 0) fail(`${po.number} line ${l.lineNo}: returned ${returned} > rejected ${rejected}`);
        if (accepted > received) fail(`${po.number} line ${l.lineNo}: accepted ${accepted} > received ${received}`);
        for (const qc of chain.filter((d) => d.type === "QC")) for (const x of qc.lines) {
          if (Number(x.acceptedQty) + Number(x.rejectedQty) !== Number(x.qty)) fail(`${qc.id} line ${x.lineNo}: accepted+rejected != inspected`);
        }
        const delivered = received - returned;
        if (billed > delivered && !declares(story, "overBilled")) fail(`${po.number} line ${l.lineNo}: billed ${billed} > delivered ${delivered} without a declared story`);
        if (billedAll > billed && !story.expected.some((c) => ["DUP_EXACT_INVOICE", "INVOICE_QTY_EXCEEDS_RECEIVED"].includes(c))) fail(`${po.number}: duplicate posting not declared`);
        for (const inv of invoices) for (const x of inv.lines.filter((y) => y.refs?.poLineNo === l.lineNo)) {
          if (x.rate !== l.rate && !declares(story, "priceVariance")) fail(`${inv.id}: rate ${x.rate} != PO ${l.rate} without a declared story`);
          if (x.hsn !== l.hsn || x.gstRate !== l.gstRate || x.uom !== l.uom) fail(`${inv.id}: HSN/rate/UOM differ from PO`);
        }
      }
      // PO status must match the receipt picture
      const st = po.status;
      const lineState = po.lines.map((l) => {
        const rec = chain.filter((d) => d.type === "GRN").flatMap((d) => d.lines).filter((x) => x.refs.poLineNo === l.lineNo).reduce((s, x) => s + Number(x.qty), 0)
          - chain.filter((d) => d.type === "RETURN").flatMap((d) => d.lines).filter((x) => x.refs.poLineNo === l.lineNo).reduce((s, x) => s + Number(x.qty), 0);
        return [rec, Number(l.qty)];
      });
      const any = lineState.some(([r]) => r > 0), all = lineState.every(([r, o]) => r >= o);
      const ok = st === "short_closed" ? all : st === "fulfilled" ? all : st === "partially_fulfilled" ? any && !all : ["issued", "acknowledged"].includes(st) ? !any : false;
      if (!ok) fail(`${po.number}: status ${st} inconsistent with receipts ${JSON.stringify(lineState)}`);
    }
  });

  check("payments: UTR format + uniqueness, allocations ≤ open, lines = allocations", (fail) => {
    const utrs = new Set();
    const settled = new Map();
    for (const p of documents.filter((d) => d.type === "PAYMENT_OUT").sort((a, b) => a.date.localeCompare(b.date))) {
      const { mode, utr, amount, allocations = [] } = p.payment;
      if (mode === "CHEQUE") { if (utr) fail(`${p.id}: cheque with UTR`); }
      else {
        if (!UTR_PATTERNS[mode]?.test(utr || "")) fail(`${p.id}: ${mode} UTR ${utr} malformed`);
        if (utrs.has(utr)) fail(`${p.id}: UTR ${utr} repeated`);
        utrs.add(utr);
      }
      if (mode === "RTGS" && toPaise(amount) < 20000000n) fail(`${p.id}: RTGS below ₹2,00,000`);
      if (mode === "IMPS" && toPaise(amount) > 50000000n) fail(`${p.id}: IMPS above ₹5,00,000`);
      const allocated = allocations.reduce((s, a) => s + toPaise(a.amount), 0n);
      if (allocated > toPaise(amount)) fail(`${p.id}: allocations exceed amount`);
      if (!allocations.length && !declares(storyOf(p), "unreferencedPayment")) fail(`${p.id}: unreferenced payment not declared by its story`);
      if (allocations.length && allocated !== toPaise(amount)) fail(`${p.id}: partly allocated payment`);
      const lineSum = (p.lines || []).reduce((s, l) => s + toPaise(l.lineTotal), 0n);
      if (lineSum !== allocated) fail(`${p.id}: payment lines ${fmt(lineSum)} != allocations ${fmt(allocated)}`);
      for (const a of allocations) {
        const inv = byId.get(a.documentId);
        if (!inv || inv.type !== "INVOICE_IN") { fail(`${p.id}: allocation to ${a.documentId} is not an invoice`); continue; }
        const credits = documents.filter((d) => d.type === "CREDIT_NOTE_IN" && d.lines.some((l) => l.refs?.invoiceId === inv.id)).reduce((s, d) => s + toPaise(d.totals.grand), 0n);
        const before = settled.get(inv.id) || 0n;
        const open = toPaise(inv.totals.grand) - before - (credits && p.date >= documents.find((d) => d.type === "CREDIT_NOTE_IN" && d.lines.some((l) => l.refs?.invoiceId === inv.id)).date ? credits : 0n);
        if (toPaise(a.amount) > open) fail(`${p.id}: allocates ${a.amount} to ${inv.number} but only ${fmt(open)} open`);
        if (toPaise(a.amount) <= 0n) fail(`${p.id}: non-positive allocation`);
        settled.set(inv.id, before + toPaise(a.amount));
        const exp = links.find((l) => l.fromId === p.id && l.toId === inv.id && l.kind === "SETTLES");
        if (!exp || exp.amount?.amount !== a.amount) fail(`${p.id}: SETTLES link missing or amount differs`);
        const dup = exceptionsOf(inv, documents)?.duplicateOf;
        if (dup) fail(`${p.id}: pays a duplicate posting ${inv.number}`);
      }
      for (const pl of p.lines || []) {
        const inv = byId.get(pl.refs?.invoiceId);
        const il = inv?.lines.find((x) => x.lineNo === pl.refs.invoiceLineNo);
        if (!il || il.refs.poLineNo !== pl.refs.poLineNo || inv.lines[0].refs.poId !== pl.refs.poId) { fail(`${p.id} line ${pl.lineNo}: refs do not match an invoice line`); continue; }
        const credit = documents.filter((d) => d.type === "CREDIT_NOTE_IN").flatMap((d) => d.lines).filter((x) => x.refs?.invoiceId === inv.id && x.refs?.invoiceLineNo === il.lineNo).reduce((s, x) => s + toPaise(x.lineTotal), 0n);
        const paidOnLine = documents.filter((d) => d.type === "PAYMENT_OUT").flatMap((d) => d.lines || []).filter((x) => x.refs?.invoiceId === inv.id && x.refs?.invoiceLineNo === il.lineNo).reduce((s, x) => s + toPaise(x.lineTotal), 0n);
        if (paidOnLine > toPaise(il.lineTotal) - credit) fail(`${inv.number} line ${il.lineNo}: paid ${fmt(paidOnLine)} > net billed ${fmt(toPaise(il.lineTotal) - credit)}`);
      }
      if (p.payment.bankAccountMasked !== supById.get(p.supplierId)?.bankMasked && p.payment.bankAccountMasked !== supById.get(p.supplierId)?.bankAccounts?.[0]?.accountMasked) fail(`${p.id}: paid to an account not on the supplier master`);
    }
  });

  check("MSME: micro/small invoices paid within min(terms, 45) days unless declared", (fail) => {
    for (const inv of documents.filter((d) => d.type === "INVOICE_IN")) {
      const s = supById.get(inv.supplierId);
      const cat = s.udyam?.category;
      if (!["micro", "small"].includes(cat)) continue;
      const limit = Math.min(s.termsDays ?? s.paymentTermsDays, 45);
      const pays = documents.filter((d) => d.type === "PAYMENT_OUT").flatMap((p) => (p.payment.allocations || []).filter((a) => a.documentId === inv.id).map((a) => ({ date: p.date, amount: toPaise(a.amount) })));
      for (const p of pays) if (diffDays(inv.date, p.date) > limit) fail(`${inv.number}: paid after ${diffDays(inv.date, p.date)} days (> ${limit})`);
      const credits = documents.filter((d) => d.type === "CREDIT_NOTE_IN" && d.lines.some((l) => l.refs?.invoiceId === inv.id)).reduce((s2, d) => s2 + toPaise(d.totals.grand), 0n);
      const open = toPaise(inv.totals.grand) - credits - pays.reduce((s2, p) => s2 + p.amount, 0n);
      const story = storyOf(inv);
      const ex = exceptionsOf(inv, documents) || {};
      if (open > 0n && diffDays(inv.date, today) > limit && !story.msmeOverdueAllowed && !ex.duplicateOf && !ex.gstinTypo) fail(`${inv.number}: MSME invoice overdue (${diffDays(inv.date, today)} days) without a declared story`);
    }
  });

  check("e-way bill: invoices > ₹50,000 carry gst.ewayBillNo unless declared", (fail) => {
    for (const inv of documents.filter((d) => d.type === "INVOICE_IN")) {
      const need = toPaise(inv.totals.grand) > 5000000n;
      const has = /^\d{12}$/.test(inv.gst?.ewayBillNo || "");
      if (need && !has && !declares(storyOf(inv), "noEway")) fail(`${inv.number}: ₹${inv.totals.grand} without e-way bill`);
      if (inv.gst?.ewayBillNo && !has) fail(`${inv.number}: e-way bill number not 12 digits`);
    }
  });

  check("links: endpoints exist, kinds match document types, no orphans", (fail) => {
    const ids = new Set();
    const expectKind = { GRN: ["RECEIVES"], QC: ["INSPECTS"], RETURN: ["RETURNS"], INVOICE_IN: ["BILLS"], CREDIT_NOTE_IN: ["ADJUSTS"], PAYMENT_OUT: ["SETTLES"] };
    for (const l of links) {
      if (extraKeys(l, ALLOWED.link).length) fail(`${l.id}: extra ${extraKeys(l, ALLOWED.link)}`);
      if (ids.has(l.id)) fail(`${l.id}: duplicate link id`);
      ids.add(l.id);
      const from = byId.get(l.fromId), to = byId.get(l.toId);
      if (!from || !to) { fail(`${l.id}: dangling endpoint`); continue; }
      if (!expectKind[from.type]?.includes(l.kind)) fail(`${l.id}: ${from.type} cannot ${l.kind}`);
      if (from.caseId !== to.caseId) fail(`${l.id}: crosses cases`);
    }
    for (const d of documents.filter((x) => x.type !== "PO")) {
      if (!links.some((l) => l.fromId === d.id) && !(d.type === "PAYMENT_OUT" && !(d.payment.allocations || []).length)) fail(`${d.id}: not linked to its PO chain`);
    }
  });

  check("cases: one per PO, subjects valid, unreferenced payments are subjects", (fail) => {
    const pos = documents.filter((d) => d.type === "PO");
    if (cases.length !== pos.length) fail(`${cases.length} cases for ${pos.length} POs`);
    for (const c of cases) {
      if (c.kind !== "po") fail(`${c.id}: kind ${c.kind}`);
      const po = byId.get(c.subjectIds[0]);
      if (!po || po.type !== "PO" || po.caseId !== c.id) fail(`${c.id}: first subject is not its PO`);
      if (!c.title.includes(po?.number)) fail(`${c.id}: title lacks PO number`);
      for (const id of c.subjectIds.slice(1)) {
        const p = byId.get(id);
        if (!p || p.type !== "PAYMENT_OUT" || (p.payment.allocations || []).length) fail(`${c.id}: extra subject ${id} is not an unreferenced payment`);
      }
    }
    for (const p of documents.filter((d) => d.type === "PAYMENT_OUT" && !(d.payment.allocations || []).length)) {
      if (!cases.some((c) => c.subjectIds.includes(p.id))) fail(`${p.id}: unreferenced payment is in no case`);
    }
  });

  const failed = results.filter((r) => !r.pass);
  return { ok: failed.length === 0, results };
};

// Story exceptions are derivable from deterministic ids, so the same check
// works on a stored dataset.
const EXCEPTION_CACHE = new WeakMap();
const exceptionsOf = (doc, documents) => {
  let map = EXCEPTION_CACHE.get(documents);
  if (!map) {
    map = new Map();
    for (const story of STORIES) {
      for (const ev of story.events.filter((e) => e.type === "INV")) {
        const id = `doc_cur_${story.id.toLowerCase()}_${ev.key}`;
        map.set(id, {
          story: story.id, gstinTypo: Boolean(ev.gstinTypo), forceIgst: Boolean(ev.forceIgst), noEway: Boolean(ev.noEway),
          duplicateOf: ev.duplicateOf ? `doc_cur_${story.id.toLowerCase()}_${ev.duplicateOf}` : null,
        });
      }
    }
    EXCEPTION_CACHE.set(documents, map);
  }
  return map.get(doc.id) || null;
};

export const printReport = ({ ok, results }, log = console.log) => {
  for (const r of results) {
    log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    for (const f of r.failures.slice(0, 12)) log(`        - ${f}`);
    if (r.failures.length > 12) log(`        … ${r.failures.length - 12} more`);
  }
  log(ok ? `\nVALIDATION PASSED (${results.length} checks)` : `\nVALIDATION FAILED (${results.filter((r) => !r.pass).length} of ${results.length} checks)`);
};

// Load the stored demo group back into validator shape.
export const loadFromDb = async (db, groupId) => {
  const [documents, links, cases, suppliers, items, entity] = await Promise.all([
    db.collection("documents").find({ groupId }).toArray(),
    db.collection("documentlinks").find({ groupId }).toArray(),
    db.collection("cases").find({ groupId }).toArray(),
    db.collection("suppliers").find({ groupId }).toArray(),
    db.collection("items").find({ groupId }).toArray(),
    db.collection("entities").findOne({ groupId }),
  ]);
  const master = new Map(SUPPLIERS.map((s) => [s.id, s]));
  return {
    documents: documents.map(({ _id, ...d }) => d), links, cases,
    suppliers: suppliers.map((s) => ({ ...s, holder: master.get(s.id)?.holder, termsDays: s.paymentTermsDays, stateCode: s.gstins?.[0]?.stateCode, gstin: s.gstins?.[0]?.gstin, bankMasked: s.bankAccounts?.[0]?.accountMasked })),
    items: items.map((i) => ({ ...i, gstRate: i.defaultGstRate })),
    entity: { ...entity, address: entity?.addresses?.billing },
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { istDate } = await import("./dates.js");
  const today = istDate();
  if (process.argv.includes("--db")) {
    const { connect, findDemoGroup } = await import("./curated.js");
    const conn = await connect();
    const group = await findDemoGroup(conn.db);
    if (!group) { console.error("Demo group not found"); process.exit(1); }
    const data = await loadFromDb(conn.db, group.id);
    const report = validateDataset({ ...data, today });
    printReport(report);
    await conn.close();
    process.exit(report.ok ? 0 : 1);
  } else {
    const { buildDataset } = await import("./build.js");
    const ds = buildDataset({ today, groupId: "grp_validate", entityId: "ent_validate", actors: { analyst: "usr_analyst", manager: "usr_manager" } });
    const report = validateDataset({ ...ds, today });
    printReport(report);
    process.exit(report.ok ? 0 : 1);
  }
}
