import express from "express";
import Document from "../../models/Document.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
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

  const created = [], deduped = [], errors = [];
  for (const [i, row] of rows.entries()) {
    const utr = String(row[mapping.utr] || "").trim();
    const date = String(row[mapping.date] || "").trim().slice(0, 10);
    const amount = String(row[mapping.amount] || "").replace(/[₹,\s]/g, "");
    if (!utr || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d+(\.\d{1,2})?$/.test(amount)) {
      errors.push({ row: i, reason: "missing/invalid utr, date or amount" });
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
      payment: { utr, amount, mode: String(row[mapping.mode] || "NEFT").toUpperCase(), valueDate: date, allocations: [] },
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

  const flat = [];
  const b2b = gstr2b?.data?.doc_det?.b2b || gstr2b?.doc_det?.b2b || [];
  for (const sup of b2b) {
    for (const inv of sup.inv || []) {
      flat.push({ gstin: sup.ctin, number: inv.inum, date: inv.idt, total: inv.val, taxable: (inv.itms || []).reduce((s, it) => s + Number(it.txval || 0), 0), igst: (inv.itms || []).reduce((s, it) => s + Number(it.iamt || 0), 0), cgst: (inv.itms || []).reduce((s, it) => s + Number(it.camt || 0), 0), sgst: (inv.itms || []).reduce((s, it) => s + Number(it.samt || 0), 0) });
    }
  }
  for (const inv of gstr2b?.invoices || []) {
    flat.push({ gstin: inv.gstin, number: inv.number, date: inv.date, total: inv.total, taxable: inv.taxable, igst: inv.igst, cgst: inv.cgst, sgst: inv.sgst });
  }
  if (!flat.length) throw fail(422, "VALIDATION_FAILED", "No b2b invoices found — pass the GSTR-2B JSON or an {invoices:[...]} array");

  const created = [], deduped = [];
  for (const inv of flat) {
    const externalRef = `gstr2b:${inv.gstin}:${inv.number}`;
    const existing = await Document.findOne({ groupId: req.scope.groupId, externalRef }).lean();
    if (existing) { deduped.push({ number: inv.number }); continue; }
    const date = String(inv.date || "").slice(0, 10);
    await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId, type: "INVOICE_IN",
      number: inv.number, externalRef, date, fy: fyOf(date), status: "posted", revision: 0,
      seller: { name: inv.gstin, gstin: inv.gstin }, buyer: { name: "Own entity" },
      currency: "INR", lines: [],
      totals: { taxable: Number(inv.taxable || 0).toFixed(2), cgst: Number(inv.cgst || 0).toFixed(2), sgst: Number(inv.sgst || 0).toFixed(2), igst: Number(inv.igst || 0).toFixed(2), cess: "0.00", roundOff: "0.00", grand: Number(inv.total || 0).toFixed(2) },
      source: { channel: "gstr2b_json" }, provenance: "SYSTEM_GENERATED",
      observedAt: new Date().toISOString(), createdBy: actor(req),
    });
    created.push({ number: inv.number });
  }
  res.status(201).json({ created: created.length, deduped: deduped.length, detail: { created, deduped } });
}));

export default router;
