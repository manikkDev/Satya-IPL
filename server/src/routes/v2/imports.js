import express from "express";
import Document from "../../models/Document.js";
import { newId } from "../../lib/ids.js";
import { fyOf, isRealDate } from "../../lib/fy.js";
import { toPaise, toDecimal, sum } from "../../lib/money.js";
import { PAYMENT_MODES } from "../../lib/docSchemas.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const MODE_ALIASES = { CHQ: "CHEQUE", CHECK: "CHEQUE", "CHEQUE/DD": "CHEQUE", DD: "CHEQUE", "NEFT/RTGS": "NEFT", FT: "OTHER", TRANSFER: "OTHER" };
const actor = (req) => req.user.v2id || String(req.user._id);
const canImport = (req) => {
  if (!scopeAllows(req.scope, "doc.upload", req.body?.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot import documents", { reason: "Requires doc.upload" });
};

// POST /api/v2/import/bank-csv — {entityId, mapping:{date,utr,amount,payeeName,mode?,direction}, rows:[{...headers}]}
// UTR dedupe: a row whose UTR already exists in the group is skipped, not re-created (04 P2-B5).
router.post("/bank-csv", handle(async (req, res) => {
  assertPlainInput(req.body);
  canImport(req);
  const { entityId, mapping = {}, rows = [] } = req.body;
  if (!entityId || !Array.isArray(rows) || !rows.length) throw fail(422, "VALIDATION_FAILED", "rows[] and entityId are required");
  if (!mapping.utr || !mapping.date || !mapping.amount) throw fail(422, "VALIDATION_FAILED", "mapping needs date, utr and amount column names");
  if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
  if (rows.length > 5000) throw fail(422, "VALIDATION_FAILED", "At most 5000 rows per import");

  const created = [], deduped = [], errors = [];
  for (const [i, row] of rows.entries()) {
    const utr = String(row[mapping.utr] || "").trim().toUpperCase();
    const date = String(row[mapping.date] || "").trim().slice(0, 10);
    const amount = String(row[mapping.amount] || "").replace(/[₹,\s]/g, "");
    if (!/^[A-Z0-9]{6,35}$/.test(utr) || !isRealDate(date) || !/^\d{1,13}(\.\d{1,2})?$/.test(amount) || toPaise(amount) <= 0n) {
      errors.push({ row: i, reason: "missing/invalid utr, date or amount" });
      continue;
    }
    const rawMode = mapping.mode ? String(row[mapping.mode] || "").trim().toUpperCase() : "";
    const mode = rawMode ? MODE_ALIASES[rawMode] || (PAYMENT_MODES.includes(rawMode) ? rawMode : null) : "OTHER";
    if (!mode) {
      errors.push({ row: i, reason: `payment mode "${rawMode}" is not one of ${PAYMENT_MODES.join(", ")}` });
      continue;
    }
    const dup = await Document.exists({ groupId: req.scope.groupId, "payment.utr": utr });
    if (dup) { deduped.push({ row: i, utr }); continue; }
    const direction = mapping.direction ? String(row[mapping.direction] || "") : "out";
    const type = direction.toLowerCase().startsWith("in") ? "PAYMENT_IN" : "PAYMENT_OUT";
    const doc = await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId, type,
      externalRef: `bankcsv:${utr}`, date, fy: fyOf(date), status: "posted", revision: 0,
      seller: { name: String(row[mapping.payeeName] || "Counterparty").slice(0, 200) },
      buyer: { name: "Bank account" }, currency: "INR", lines: [],
      payment: { utr, amount: toDecimal(amount), mode, valueDate: date, allocations: [] },
      source: { channel: "bank_csv" }, provenance: "SYSTEM_GENERATED",
      observedAt: new Date().toISOString(), createdBy: actor(req),
    });
    created.push({ row: i, documentId: doc.id, utr });
  }
  res.status(201).json({ created: created.length, deduped: deduped.length, errors: errors.length, detail: { created, deduped, errors } });
}));

// POST /api/v2/import/gstr2b — official nested shape OR flat invoices array.
// Dedupe by supplier-GSTIN + invoice number per group.
router.post("/gstr2b", handle(async (req, res) => {
  assertPlainInput(req.body);
  canImport(req);
  const { entityId, gstr2b } = req.body;
  if (!entityId || !gstr2b) throw fail(422, "VALIDATION_FAILED", "entityId and gstr2b payload required");
  const period = String(req.body.period || gstr2b.period || "").slice(0, 7) || null;

  const flat = [];
  const b2b = gstr2b?.data?.doc_det?.b2b || gstr2b?.doc_det?.b2b || [];
  for (const sup of b2b) {
    for (const inv of sup.inv || []) {
      const items = inv.itms || [];
      flat.push({ gstin: sup.ctin, number: inv.inum, date: inv.idt, total: inv.val, taxable: sum(items, (it) => it.txval), igst: sum(items, (it) => it.iamt), cgst: sum(items, (it) => it.camt), sgst: sum(items, (it) => it.samt), cess: sum(items, (it) => it.csamt) });
    }
  }
  for (const inv of gstr2b?.invoices || []) {
    flat.push({ gstin: inv.gstin, number: inv.number, date: inv.date, total: inv.total, taxable: inv.taxable, igst: inv.igst, cgst: inv.cgst, sgst: inv.sgst, cess: inv.cess });
  }
  if (!flat.length) throw fail(422, "VALIDATION_FAILED", "No b2b invoices found — pass the GSTR-2B JSON or an {invoices:[...]} array");

  if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
  if (flat.length > 20000) throw fail(422, "VALIDATION_FAILED", "At most 20000 invoices per import");

  // 2B entries are stored as GSTR2B_ENTRY (they are the supplier's filing,
  // not a second copy of the purchase invoice) — as INVOICE_IN they doubled
  // payables, dashboards and supplier balances. Official dates are DD-MM-YYYY.
  const created = [], deduped = [], errors = [];
  for (const [i, inv] of flat.entries()) {
    const rawDate = String(inv.date || "").trim();
    const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(rawDate);
    const date = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : rawDate.slice(0, 10);
    if (!inv.gstin || !inv.number || !isRealDate(date)) { errors.push({ row: i, reason: "missing GSTIN, invoice number or valid date" }); continue; }
    const externalRef = `gstr2b:${inv.gstin}:${inv.number}`;
    const existing = await Document.findOne({ groupId: req.scope.groupId, externalRef }, { _id: 1 }).lean();
    if (existing) { deduped.push({ number: inv.number }); continue; }
    await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId, type: "GSTR2B_ENTRY",
      number: String(inv.number), externalRef, date, fy: fyOf(date), status: "posted", revision: 0,
      seller: { name: inv.gstin, gstin: inv.gstin }, buyer: { name: "Own entity" },
      currency: "INR", lines: [],
      gst: { gstr2bPeriod: period || date.slice(0, 7) },
      totals: { taxable: toDecimal(inv.taxable), cgst: toDecimal(inv.cgst), sgst: toDecimal(inv.sgst), igst: toDecimal(inv.igst), cess: toDecimal(inv.cess), roundOff: "0.00", grand: toDecimal(inv.total) },
      source: { channel: "gstr2b_json" }, provenance: "SYSTEM_GENERATED",
      observedAt: new Date().toISOString(), createdBy: actor(req),
    });
    created.push({ number: inv.number });
  }
  res.status(201).json({ created: created.length, deduped: deduped.length, errors: errors.length, detail: { created, deduped, errors } });
}));

export default router;
