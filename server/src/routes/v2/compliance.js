import express from "express";
import Document from "../../models/Document.js";
import Supplier from "../../models/Supplier.js";
import { handle } from "./util.js";

const router = express.Router();
const days = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

// GET /compliance/summary?entityId — statutory watch items (04 P3-B8):
// msme45, rule37 ITC reversal, TDS by section, ITC totals, e-invoice coverage.
router.get("/summary", handle(async (req, res) => {
  const entityFilter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (req.query.entityId) entityFilter.entityId = req.query.entityId;

  const [invoices, payments, tdsDocs, creditNotes, suppliers] = await Promise.all([
    Document.find({ ...entityFilter, type: "INVOICE_IN", status: { $nin: ["draft", "cancelled", "reversed"] } }).lean(),
    Document.find({ ...entityFilter, type: { $in: ["PAYMENT_OUT", "ADVANCE_OUT"] }, status: { $nin: ["draft", "cancelled"] } }).lean(),
    Document.find({ ...entityFilter, type: "TDS_ENTRY", status: { $nin: ["draft", "cancelled"] } }).lean(),
    Document.find({ ...entityFilter, type: { $in: ["CREDIT_NOTE_IN", "DEBIT_NOTE_IN"] }, status: { $nin: ["draft", "cancelled"] } }).lean(),
    Supplier.find({ groupId: req.scope.groupId }).lean(),
  ]);

  const msmeSupplierIds = new Set(suppliers.filter((s) => s.udyam?.category || s.msme).map((s) => s.id));
  const today = new Date().toISOString().slice(0, 10);

  // paid allocations per invoice (allocation shape: {documentId, amount, basis})
  const paidFor = new Map();
  for (const p of payments) for (const a of p.payment?.allocations || []) {
    paidFor.set(a.documentId, (paidFor.get(a.documentId) || 0) + Number(a.amount || 0));
  }

  const msme45 = invoices.filter((d) => {
    const isMsme = (d.supplierId && msmeSupplierIds.has(d.supplierId)) || d.seller?.udyam;
    if (!isMsme) return false;
    const creditDays = Number(d.terms?.creditDays || 45);
    const due = days(d.date, today) > creditDays;
    const paid = (paidFor.get(d.id) || 0) >= Number(d.totals?.grand || 0) - 0.01;
    return due && !paid;
  }).map((d) => ({ documentId: d.id, number: d.number, date: d.date, overdueDays: days(d.date, today) - Number(d.terms?.creditDays || 45), total: d.totals?.grand }));

  const rule37 = invoices.filter((d) => {
    const itc = Number(d.gst?.itcAmount || d.totals?.totalTax || 0);
    return itc > 0 && (paidFor.get(d.id) || 0) < Number(d.totals?.grand || 0) - 0.01 && days(d.date, today) > 180;
  }).map((d) => ({ documentId: d.id, number: d.number, date: d.date, daysSinceInvoice: days(d.date, today), itcAtRisk: d.gst?.itcAmount || d.totals?.totalTax }));

  const tdsSummary = Object.fromEntries(tdsDocs.map((d) => {
    const section = d.payment?.tds?.section || "unknown";
    return [section, 0];
  }));
  for (const d of tdsDocs) {
    const section = d.payment?.tds?.section || "unknown";
    tdsSummary[section] = (tdsSummary[section] || 0) + Number(d.payment?.tds?.amount || 0);
  }

  const einvoiceDocs = invoices.filter((d) => d.gst?.irn);
  const creditNotesUnapplied = creditNotes.filter((d) => !d.payment?.allocations?.length)
    .map((d) => ({ documentId: d.id, number: d.number, date: d.date, total: d.totals?.grand }));

  const itcTotal = invoices.reduce((s, d) => s + Number(d.gst?.itcAmount || 0), 0);
  const itcBlocked = rule37.reduce((s, d) => s + Number(d.itcAtRisk || 0), 0);

  res.json({
    msme45: { count: msme45.length, items: msme45 },
    rule37: { count: rule37.length, items: rule37, itcAtRisk: itcBlocked.toFixed(2) },
    tdsSummary: Object.fromEntries(Object.entries(tdsSummary).map(([k, v]) => [k, Number(v).toFixed(2)])),
    itcSummary: { total: itcTotal.toFixed(2), blockedOrAtRisk: itcBlocked.toFixed(2) },
    einvoiceCoverage: { withIrn: einvoiceDocs.length, invoices: invoices.length, pct: invoices.length ? Number(((einvoiceDocs.length / invoices.length) * 100).toFixed(1)) : 0 },
    creditNotesUnapplied: { count: creditNotesUnapplied.length, items: creditNotesUnapplied },
    note: "Values derive from recorded documents only — supplied tax and e-invoice fields are not independently verified against government systems.",
  });
}));

export default router;
