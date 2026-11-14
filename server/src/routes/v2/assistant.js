// /api/v2/assistant/* — read models and confirmed-action endpoints for the
// "Ask Satya" copilot. Owned by the copilot workstream; mount with
//   router.use("/assistant", assistantRoutes);
// in routes/v2/index.js AFTER authenticateV2/loadScope (so it is group-scoped
// and every POST lands in the audit chain like any other v2 mutation).
//
// Nothing here moves money or files anything with the government:
//   GET  /payables           open purchase-invoice ledger: outstanding, due
//                            dates, ageing, MSME (MSMED s.15) and s.43B(h)
//                            clocks, disputed amounts from open findings
//   GET  /spend              invoiced vs paid per month or per supplier
//   POST /payment-runs       save a payment-run PROPOSAL for approval
//   GET  /payment-runs       list saved proposals
//   POST /ims-decisions      record accept/reject/pending decisions for
//                            GSTR-2B / IMS rows (you still act on the portal)
//   GET  /ims-decisions      list recorded decisions
// All money is exact paise (lib/money.js); every figure is screening, not tax
// or legal advice.

import express from "express";
import mongoose from "mongoose";
import { z } from "zod";
import Document from "../../models/Document.js";
import Supplier from "../../models/Supplier.js";
import Finding from "../../models/Finding.js";
import { newId } from "../../lib/ids.js";
import { scopeAllows } from "../../auth/rbac.js";
import { settledPaiseFor } from "../../services/settlement.js";
import { acceptanceDates, msmeCategoryOf, msmeCovered, msmeDeadline } from "../../services/msme.js";
import { money, toPaise, fromPaise, grandOf, taxableOf } from "../../lib/money.js";
import { addDays, daysBetween, todayIst, fyOf, fyRange } from "../../lib/fy.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user?.v2id || String(req.user?._id || "unknown");
const LIVE = { $nin: ["draft", "cancelled", "reversed", "rejected"] };
const PAYMENT_TYPES = ["PAYMENT_OUT", "ADVANCE_OUT"];
const m = (paise) => money(fromPaise(paise));
const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// RBI bank rate used for the MSMED s.16 interest ESTIMATE (3x bank rate,
// compounded with monthly rests). Configurable; the response states it.
export const RBI_BANK_RATE = process.env.RBI_BANK_RATE || "5.50";

const scopeEntities = (req) => {
  if (req.query.entityId) {
    if (!req.scope.entityIds.includes(String(req.query.entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    return [String(req.query.entityId)];
  }
  return req.scope.entityIds;
};

/* ---------------------------------------------------------------- helpers */

/** MSMED s.16 interest estimate on `outstandingPaise` overdue by `days`. */
export const msmeInterestPaise = (outstandingPaise, days, bankRate = RBI_BANK_RATE) => {
  if (!(days > 0) || outstandingPaise <= 0n) return 0n;
  const monthly = (3 * Number(bankRate)) / 100 / 12;
  const months = days / (365 / 12);
  const factor = Math.pow(1 + monthly, months) - 1;
  // factor to 1e-9 precision, applied in integer paise
  const scaled = BigInt(Math.round(factor * 1e9));
  return (outstandingPaise * scaled + 500_000_000n) / 1_000_000_000n;
};

/**
 * s.43B(h) screening for one MSME invoice: a deduction for an amount owed to
 * a MICRO or SMALL enterprise is allowed in the year of payment if it is not
 * paid within the MSMED s.15 time limit. Risk = still unpaid when the s.15
 * due date falls on or before the financial-year end.
 */
export const s43bhScreen = ({ category, dueDate, outstandingPaise, grandPaise, taxablePaise, today }) => {
  if (!["micro", "small"].includes(category) || outstandingPaise <= 0n || !dueDate) return null;
  const fy = fyOf(dueDate);
  const fyEnd = fyRange(fy).to;
  const share = grandPaise > 0n ? (taxablePaise * outstandingPaise) / grandPaise : outstandingPaise;
  return {
    fy,
    fyEnd,
    dueDate,
    daysToDue: daysBetween(today, dueDate),
    daysToFyEnd: daysBetween(today, fyEnd),
    atRisk: dueDate <= fyEnd,
    deadlinePassed: dueDate < today,
    expenseAtRisk: m(share),
    basis: "Expense value (excluding GST) of the unpaid part; deductible only in the year actually paid if the MSMED s.15 limit is missed",
  };
};

/** Priority rank for a payable (lower = pay first) + human reason codes. */
export const rankPayable = (p) => {
  const reasons = [];
  let rank = 5;
  if (p.msme && p.msme.daysLeft < 0) { rank = 1; reasons.push("msme_overdue"); }
  else if (p.msme && p.msme.daysLeft <= 7) { rank = 2; reasons.push("msme_due_soon"); }
  if (p.s43bh?.atRisk && p.s43bh.daysToFyEnd <= 45) { rank = Math.min(rank, 2); reasons.push("s43bh_fy_end"); }
  if (p.overdueDays > 0) { rank = Math.min(rank, 3); reasons.push("overdue"); }
  else if (p.daysToDue <= 7) { rank = Math.min(rank, 4); reasons.push("due_soon"); }
  if (toPaise(p.disputed) > 0n) reasons.push("disputed");
  return { rank, reasons };
};

const bucketOf = (overdueDays) =>
  overdueDays <= 0 ? "notDue" : overdueDays <= 30 ? "0-30" : overdueDays <= 60 ? "31-60" : overdueDays <= 90 ? "61-90" : "90+";

/**
 * Open purchase invoices with outstanding, due date, ageing, MSME and 43B(h)
 * clocks and disputed exposure. Exported for tests.
 */
export const computePayables = async ({ groupId, entityIds, supplierId, today = todayIst() }) => {
  const filter = { groupId, entityId: { $in: entityIds }, type: "INVOICE_IN", status: LIVE };
  if (supplierId) filter.$or = [{ supplierId }, { "seller.supplierId": supplierId }];
  const [invoices, suppliers] = await Promise.all([
    Document.find(filter, { id: 1, number: 1, externalRef: 1, date: 1, totals: 1, lines: 1, charges: 1, seller: 1, supplierId: 1, terms: 1, caseId: 1, entityId: 1, gst: 1 }).limit(5000).lean(),
    Supplier.find({ groupId }, { id: 1, legalName: 1, udyam: 1, msme: 1, paymentTermsDays: 1, contacts: 1 }).lean(),
  ]);
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const supplierOf = (d) => byId.get(d.supplierId) || byId.get(d.seller?.supplierId) || byName.get(d.seller?.name) || null;
  const settled = await settledPaiseFor(groupId, invoices.map((d) => d.id));

  const open = [];
  for (const d of invoices) {
    const grand = toPaise(grandOf(d));
    const paid = settled.get(d.id) || 0n;
    const outstanding = grand - paid;
    if (outstanding <= 0n) continue;
    open.push({ d, grand, paid, outstanding, sup: supplierOf(d) });
  }

  const openById = new Map(open.map(({ d }) => [d.id, d]));
  const DISPUTE_CODES = /^(DUP|DUPLICATE_|INVOICE_QTY_EXCEEDS|QTY_INVOICED_EXCEEDS|QTY_OVER_DELIVERY|BILLED_ABOVE|PRICE_VARIANCE|PRICE_UNAUTHORISED|PAY_OVERPAYMENT|PAY_BEFORE_RECEIPT|RECEIPT_EVIDENCE_MISSING|CURRENCY_CONFLICT|TAX_TYPE_MISMATCH|TAX_ARITHMETIC|TAX_RATE_MISMATCH|TAX_GSTIN_INVALID|TAX_IMS_REJECTED)/;
  // disputed exposure: open findings whose evidence names the invoice, or the
  // PO it bills (PO-level findings go to that PO's newest open invoice first)
  const poIdsOf = (d) => [...new Set((d.lines || []).map((l) => l.refs?.poId).filter(Boolean))];
  const docIds = [...new Set(open.flatMap(({ d }) => [d.id, ...poIdsOf(d)]))];
  const findings = docIds.length
    ? await Finding.find({ groupId, entityId: { $in: entityIds }, status: "open", "data.evidence.documentId": { $in: docIds } },
      { id: 1, code: 1, severity: 1, caseId: 1, "data.amount": 1, "data.evidence": 1 }).lean()
    : [];
  const findingsByDoc = new Map();
  for (const f of findings) {
    // Only findings that dispute the AMOUNT owed put money on hold. Deadline
    // reminders, compliance flags (e-way bill, 2B status), delivery progress
    // and screening signals don't make a bill unpayable.
    if (!DISPUTE_CODES.test(f.code || "")) continue;
    // A duplicate-posting finding names every copy; the earliest posting is the
    // genuine bill, so only the later copies are held.
    let skipId = null;
    if (/^(DUP|DUPLICATE_)/.test(f.code || "")) {
      const copies = (f.data?.evidence || []).map((e) => openById.get(e?.documentId)).filter(Boolean);
      if (copies.length > 1) {
        copies.sort((x, y) => String(x.date).localeCompare(String(y.date)) || String(x.createdAt || "").localeCompare(String(y.createdAt || "")) || String(x.id).localeCompare(String(y.id)));
        skipId = copies[0].id;
      }
    }
    for (const e of f.data?.evidence || []) {
      if (!e?.documentId || e.documentId === skipId) continue;
      if (!findingsByDoc.has(e.documentId)) findingsByDoc.set(e.documentId, []);
      if (!findingsByDoc.get(e.documentId).some((x) => x.id === f.id)) findingsByDoc.get(e.documentId).push(f);
    }
  }
  const disputedOf = new Map(open.map(({ d }) => [d.id, 0n]));
  const findingsOf = new Map(open.map(({ d }) => [d.id, []]));
  const remainingOpen = new Map(open.map(({ d, outstanding }) => [d.id, outstanding]));
  const take = (invId, f, amount) => {
    const room = remainingOpen.get(invId) || 0n;
    const used = amount < room ? amount : room;
    disputedOf.set(invId, disputedOf.get(invId) + used);
    remainingOpen.set(invId, room - used);
    if (!findingsOf.get(invId).some((x) => x.id === f.id)) {
      findingsOf.get(invId).push({ id: f.id, code: f.code, severity: f.severity, caseId: f.caseId || null, amount: f.data?.amount ?? null });
    }
    return used;
  };
  // invoice-level findings: largest exposure per invoice (findings overlap)
  for (const { d } of open) {
    const list = findingsByDoc.get(d.id) || [];
    const largest = list.reduce((best, f) => (toPaise(f.data?.amount) > toPaise(best?.data?.amount) ? f : best), null);
    for (const f of list) if (f !== largest) take(d.id, f, 0n);
    if (largest) take(d.id, largest, toPaise(largest.data?.amount));
  }
  // PO-level findings: spread over that PO's open invoices, newest first
  const invoicesByPo = new Map();
  for (const x of open) for (const po of poIdsOf(x.d)) {
    if (!invoicesByPo.has(po)) invoicesByPo.set(po, []);
    invoicesByPo.get(po).push(x.d);
  }
  // (largest finding per PO only — several findings usually describe the
  // same excess, so summing them would double-count the same rupees)
  for (const [po, invs] of invoicesByPo) {
    const sorted = [...invs].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const list = findingsByDoc.get(po) || [];
    const largest = list.reduce((best, f) => (toPaise(f.data?.amount) > toPaise(best?.data?.amount) ? f : best), null);
    // Invoice-level disputes on this PO's invoices (e.g. a duplicate copy)
    // usually describe the same excess, so only the remainder spills over.
    const already = invs.reduce((sum, inv) => sum + (disputedOf.get(inv.id) || 0n), 0n);
    for (const f of list) {
      let left = f === largest ? toPaise(f.data?.amount) - already : 0n;
      for (const inv of sorted) {
        if (left <= 0n) { take(inv.id, f, 0n); continue; }
        left -= take(inv.id, f, left);
      }
    }
  }

  const accepted = await acceptanceDates(groupId, open.map((x) => x.d));
  const items = open.map(({ d, grand, paid, outstanding, sup }) => {
    const creditDays = Number(d.terms?.creditDays ?? sup?.paymentTermsDays ?? 30);
    const dueDate = d.terms?.dueDate || addDays(d.date, Number.isFinite(creditDays) ? creditDays : 30);
    const overdueDays = daysBetween(dueDate, today);
    const category = msmeCategoryOf(sup, d);
    let msme = null;
    if (msmeCovered(category)) {
      const dl = msmeDeadline(d, sup, accepted.get(d.id));
      msme = {
        category: category === "unknown" ? "unverified" : category,
        dueDate: dl.dueDate, daysLeft: dl.daysLeft, clockStart: dl.clockStart, clockBasis: dl.clockBasis,
        legalDays: dl.legalDays,
        interestEstimate: dl.daysLeft < 0 ? m(msmeInterestPaise(outstanding, -dl.daysLeft)) : null,
      };
    }
    const disputed = disputedOf.get(d.id) || 0n;
    const row = {
      documentId: d.id,
      invoice: d.number ?? d.externalRef ?? d.id,
      date: d.date,
      entityId: d.entityId,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier",
      supplierId: sup?.id ?? d.seller?.supplierId ?? null,
      supplierGstin: d.seller?.gstin ?? null,
      caseId: d.caseId ?? null,
      total: m(grand),
      settled: m(paid),
      outstanding: m(outstanding),
      disputed: m(disputed),
      payable: m(outstanding - disputed > 0n ? outstanding - disputed : 0n),
      dueDate,
      creditDays: Number.isFinite(creditDays) ? creditDays : 30,
      overdueDays: Math.max(0, overdueDays),
      daysToDue: Math.max(0, -overdueDays),
      bucket: bucketOf(overdueDays),
      msme,
      s43bh: msme ? s43bhScreen({ category, dueDate: msme.dueDate, outstandingPaise: outstanding, grandPaise: grand, taxablePaise: toPaise(taxableOf(d)), today }) : null,
      findings: findingsOf.get(d.id) || [],
    };
    const { rank, reasons } = rankPayable(row);
    return { ...row, priority: rank, reasons };
  });
  return { items, today };
};

const sumOf = (rows, key) => rows.reduce((s, r) => s + toPaise(r[key]?.amount ?? r[key]), 0n);

/* ---------------------------------------------------------------- routes */

// GET /assistant/payables?entityId&supplierId&documentId&status&dueWithinDays&sort&limit&cursor
// status: open (default) | overdue | due_soon | msme | msme_overdue | s43bh | disputed
router.get("/payables", handle(async (req, res) => {
  const entityIds = scopeEntities(req);
  const supplierId = req.query.supplierId ? String(req.query.supplierId) : null;
  const { items: all, today } = await computePayables({ groupId: req.scope.groupId, entityIds, supplierId });
  const within = Math.min(Math.max(Number(req.query.dueWithinDays ?? 7) || 7, 0), 365);
  const status = String(req.query.status || "open");
  const filters = {
    open: () => true,
    overdue: (r) => r.overdueDays > 0,
    due_soon: (r) => r.overdueDays === 0 && r.daysToDue <= within,
    due_by: (r) => r.overdueDays > 0 || r.daysToDue <= within,
    msme: (r) => Boolean(r.msme),
    msme_overdue: (r) => Boolean(r.msme && r.msme.daysLeft < 0),
    s43bh: (r) => Boolean(r.s43bh?.atRisk),
    disputed: (r) => toPaise(r.disputed.amount) > 0n,
  };
  if (!filters[status]) throw fail(422, "VALIDATION_FAILED", `status must be one of ${Object.keys(filters).join(", ")}`);
  const documentId = req.query.documentId ? String(req.query.documentId) : null;
  const rows = all.filter(filters[status]).filter((r) => !documentId || r.documentId === documentId);
  const sorts = {
    priority: (a, b) => a.priority - b.priority || b.overdueDays - a.overdueDays || (toPaise(b.outstanding.amount) > toPaise(a.outstanding.amount) ? 1 : -1),
    due: (a, b) => String(a.dueDate).localeCompare(String(b.dueDate)),
    amount: (a, b) => { const d = toPaise(b.outstanding.amount) - toPaise(a.outstanding.amount); return d > 0n ? 1 : d < 0n ? -1 : 0; },
    overdue: (a, b) => b.overdueDays - a.overdueDays,
    msme: (a, b) => (a.msme?.daysLeft ?? 9999) - (b.msme?.daysLeft ?? 9999),
  };
  const sort = sorts[String(req.query.sort || "priority")] || sorts.priority;
  rows.sort(sort);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 50) || 50), 200);
  const cursor = Math.max(0, Number(req.query.cursor ?? 0) || 0);
  const ageing = { notDue: 0n, "0-30": 0n, "31-60": 0n, "61-90": 0n, "90+": 0n };
  for (const r of rows) ageing[r.bucket] += toPaise(r.outstanding.amount);
  const bySup = new Map();
  for (const r of rows) {
    const k = r.supplierId || r.supplier;
    const cur = bySup.get(k) || { supplierId: r.supplierId, supplier: r.supplier, invoices: 0, outstanding: 0n, disputed: 0n, overdue: 0n, msme: Boolean(r.msme) };
    cur.invoices += 1;
    cur.outstanding += toPaise(r.outstanding.amount);
    cur.disputed += toPaise(r.disputed.amount);
    if (r.overdueDays > 0) cur.overdue += toPaise(r.outstanding.amount);
    bySup.set(k, cur);
  }
  const bySupplier = [...bySup.values()]
    .sort((a, b) => (b.outstanding > a.outstanding ? 1 : b.outstanding < a.outstanding ? -1 : 0))
    .map((s) => ({ ...s, outstanding: m(s.outstanding), disputed: m(s.disputed), overdue: m(s.overdue) }));
  const overdueRows = rows.filter((r) => r.overdueDays > 0);
  const weekRows = rows.filter((r) => r.overdueDays === 0 && r.daysToDue <= 7);
  const msmeOverdue = rows.filter((r) => r.msme && r.msme.daysLeft < 0);
  res.json({
    asOf: today,
    status,
    items: rows.slice(cursor, cursor + limit),
    total: rows.length,
    nextCursor: cursor + limit < rows.length ? String(cursor + limit) : null,
    totals: {
      count: rows.length,
      outstanding: m(sumOf(rows, "outstanding")),
      disputed: m(sumOf(rows, "disputed")),
      payable: m(sumOf(rows, "payable")),
      overdue: m(sumOf(overdueRows, "outstanding")),
      overdueCount: overdueRows.length,
      dueThisWeek: m(sumOf(weekRows, "outstanding")),
      dueThisWeekCount: weekRows.length,
      msmeOverdue: m(sumOf(msmeOverdue, "outstanding")),
      msmeOverdueCount: msmeOverdue.length,
      msmeInterestEstimate: m(msmeOverdue.reduce((s, r) => s + toPaise(r.msme.interestEstimate?.amount), 0n)),
      s43bhExpenseAtRisk: m(rows.reduce((s, r) => s + (r.s43bh?.atRisk ? toPaise(r.s43bh.expenseAtRisk.amount) : 0n), 0n)),
    },
    ageing: Object.fromEntries(Object.entries(ageing).map(([k, v]) => [k, m(v)])),
    bySupplier: bySupplier.slice(0, 25),
    basis: {
      dueDate: "Invoice due date from recorded terms (terms.dueDate, else invoice date + credit days, else 30 days)",
      disputed: "Exposure of open findings on the invoice or the PO it bills, capped at what is still outstanding",
      msme: "MSMED s.15: micro/small suppliers, clock from acceptance (GRN/QC) else invoice date, max 45 days",
      msmeInterest: `Estimate at 3x the RBI bank rate (${RBI_BANK_RATE}% assumed), compounded monthly (MSMED s.16)`,
      s43bh: "Income-tax s.43B(h): MSE dues not paid within the s.15 limit are deductible only in the year paid",
    },
    note: "Screening over your recorded documents — not tax or legal advice. Confirm positions with your CA.",
  });
}));

// GET /assistant/spend?groupBy=month|supplier&from&to&entityId&supplierId
router.get("/spend", handle(async (req, res) => {
  const entityIds = scopeEntities(req);
  const groupBy = req.query.groupBy === "supplier" ? "supplier" : "month";
  const today = todayIst();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : fyRange(fyOf(today)).from;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : today;
  const base = { groupId: req.scope.groupId, entityId: { $in: entityIds }, status: LIVE, date: { $gte: from, $lte: to } };
  const supplierId = req.query.supplierId ? String(req.query.supplierId) : null;
  const sup = supplierId ? await Supplier.findOne({ groupId: req.scope.groupId, id: supplierId }, { id: 1, legalName: 1 }).lean() : null;
  if (supplierId && !sup) throw fail(404, "NOT_FOUND", "Supplier not found");
  const supFilter = sup ? { $or: [{ supplierId: sup.id }, { "seller.supplierId": sup.id }, { "seller.name": new RegExp(`^${escapeRx(sup.legalName)}$`) }] } : {};
  const [invoices, payments] = await Promise.all([
    Document.find({ ...base, type: "INVOICE_IN", ...supFilter }, { id: 1, date: 1, totals: 1, lines: 1, charges: 1, seller: 1, supplierId: 1 }).limit(10000).lean(),
    Document.find({ ...base, type: { $in: PAYMENT_TYPES }, ...supFilter }, { id: 1, date: 1, payment: 1, seller: 1, supplierId: 1 }).limit(10000).lean(),
  ]);
  const keyOf = (d) => (groupBy === "month" ? String(d.date).slice(0, 7) : d.supplierId || d.seller?.supplierId || d.seller?.name || "unknown");
  const labelOf = (d) => (groupBy === "month" ? String(d.date).slice(0, 7) : d.seller?.name || "Unknown supplier");
  const rows = new Map();
  const slot = (d) => {
    const k = keyOf(d);
    if (!rows.has(k)) rows.set(k, { key: k, label: labelOf(d), invoiced: 0n, invoiceCount: 0, paid: 0n, paymentCount: 0 });
    return rows.get(k);
  };
  for (const d of invoices) { const r = slot(d); r.invoiced += toPaise(grandOf(d)); r.invoiceCount += 1; }
  for (const p of payments) { const r = slot(p); r.paid += toPaise(p.payment?.amount); r.paymentCount += 1; }
  const list = [...rows.values()].sort(groupBy === "month"
    ? (a, b) => a.key.localeCompare(b.key)
    : (a, b) => (b.invoiced > a.invoiced ? 1 : b.invoiced < a.invoiced ? -1 : 0));
  res.json({
    groupBy, from, to,
    supplier: sup ? { id: sup.id, name: sup.legalName } : null,
    rows: list.map((r) => ({ ...r, invoiced: m(r.invoiced), paid: m(r.paid) })),
    totals: {
      invoiced: m(list.reduce((s, r) => s + r.invoiced, 0n)),
      paid: m(list.reduce((s, r) => s + r.paid, 0n)),
      invoiceCount: list.reduce((s, r) => s + r.invoiceCount, 0),
      paymentCount: list.reduce((s, r) => s + r.paymentCount, 0),
    },
    note: "Invoiced = purchase-invoice grand totals (GST incl.) by invoice date; paid = outward payments and advances by payment date.",
  });
}));

/* ------------------------------------------------ payment-run proposals */

const amountText = z.union([z.string(), z.number()]).transform((v) => String(v).trim()).refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v), "amount with at most 2 decimals");
const runSchema = z.object({
  title: z.string().trim().max(120).optional(),
  budget: amountText.optional(),
  note: z.string().trim().max(1000).optional(),
  entityId: z.string().max(64).optional(),
  items: z.array(z.object({
    documentId: z.string().min(1).max(80),
    amount: amountText,
    reason: z.string().trim().max(300).optional(),
  }).strict()).min(1).max(200),
  source: z.enum(["copilot", "manual"]).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
}).strict();

const parse = (schema, body) => {
  assertPlainInput(body);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  return parsed.data;
};
const col = (name) => {
  if (mongoose.connection.readyState !== 1) throw fail(503, "UPSTREAM_UNAVAILABLE", "Database is connecting — retry shortly");
  return mongoose.connection.collection(name);
};
const clean = (doc) => { if (!doc) return doc; const { _id, ...rest } = doc; return rest; };

router.post("/payment-runs", handle(async (req, res) => {
  const body = parse(runSchema, req.body);
  const entityIds = body.entityId ? (req.scope.entityIds.includes(body.entityId) ? [body.entityId] : null) : req.scope.entityIds;
  if (!entityIds) throw fail(404, "NOT_FOUND", "Entity not found");
  if (!entityIds.some((e) => scopeAllows(req.scope, "payment.release.maker", e))) {
    throw fail(403, "FORBIDDEN", "Your role cannot propose payment runs", { reason: "Requires payment.release.maker" });
  }
  const runs = col("assistant_payment_runs");
  if (body.idempotencyKey) {
    const existing = await runs.findOne({ groupId: req.scope.groupId, idempotencyKey: body.idempotencyKey });
    if (existing) return res.json(clean(existing));
  }
  const { items: open } = await computePayables({ groupId: req.scope.groupId, entityIds });
  const byId = new Map(open.map((r) => [r.documentId, r]));
  const perDoc = new Map();
  for (const it of body.items) perDoc.set(it.documentId, (perDoc.get(it.documentId) || 0n) + toPaise(it.amount));
  const lines = [];
  for (const [documentId, paise] of perDoc) {
    const row = byId.get(documentId);
    if (!row) throw fail(404, "NOT_FOUND", `${documentId} is not an open purchase invoice you can see`);
    if (paise <= 0n) throw fail(422, "VALIDATION_FAILED", `Amount for ${row.invoice} must be positive`);
    if (paise > toPaise(row.outstanding.amount)) throw fail(422, "VALIDATION_FAILED", `₹${fromPaise(paise)} exceeds what is outstanding on ${row.invoice} (₹${row.outstanding.amount})`);
    lines.push({
      documentId, invoice: row.invoice, supplier: row.supplier, supplierId: row.supplierId,
      amount: fromPaise(paise), outstanding: row.outstanding.amount, disputed: row.disputed.amount,
      dueDate: row.dueDate, msmeDueDate: row.msme?.dueDate ?? null,
      reason: body.items.find((i) => i.documentId === documentId)?.reason || row.reasons.join(", "),
      warnings: toPaise(row.disputed.amount) > 0n && paise > toPaise(row.payable.amount) ? ["includes a disputed amount"] : [],
    });
  }
  const total = lines.reduce((s, l) => s + toPaise(l.amount), 0n);
  if (body.budget && total > toPaise(body.budget)) {
    throw fail(422, "VALIDATION_FAILED", `Run total ₹${fromPaise(total)} exceeds the budget ₹${fromPaise(toPaise(body.budget))}`);
  }
  const run = {
    id: newId("prun"),
    groupId: req.scope.groupId,
    entityIds,
    title: body.title || `Payment run proposal ${todayIst()}`,
    status: "proposed",
    budget: body.budget ? fromPaise(toPaise(body.budget)) : null,
    total: fromPaise(total),
    currency: "INR",
    lines,
    note: body.note || null,
    source: body.source || "manual",
    idempotencyKey: body.idempotencyKey || null,
    createdBy: actor(req),
    createdAt: new Date().toISOString(),
    disclaimer: "Proposal only — no payment has been made. Release it through your bank or ERP after approval.",
  };
  await runs.insertOne({ ...run });
  res.status(201).json(run);
}));

router.get("/payment-runs", handle(async (req, res) => {
  const items = await col("assistant_payment_runs")
    .find({ groupId: req.scope.groupId, entityIds: { $in: req.scope.entityIds } })
    .sort({ createdAt: -1 }).limit(50).toArray();
  res.json({ items: items.map(clean) });
}));

/* ------------------------------------------------ IMS / GSTR-2B decisions */

const imsSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  entityId: z.string().max(64).optional(),
  decisions: z.array(z.object({
    documentId: z.string().max(80).optional(),
    invoice: z.string().trim().min(1).max(80),
    supplier: z.string().trim().max(160).optional(),
    supplierGstin: z.string().regex(/^[0-9A-Z]{15}$/).optional(),
    action: z.enum(["accept", "reject", "pending"]),
    reason: z.string().trim().min(3).max(500),
  }).strict()).min(1).max(200),
  source: z.enum(["copilot", "manual"]).optional(),
}).strict();

router.post("/ims-decisions", handle(async (req, res) => {
  const body = parse(imsSchema, req.body);
  const entityId = body.entityId || req.scope.entityIds[0];
  if (!req.scope.entityIds.includes(entityId)) throw fail(404, "NOT_FOUND", "Entity not found");
  if (!scopeAllows(req.scope, "finding.decide", entityId)) {
    throw fail(403, "FORBIDDEN", "Your role cannot record IMS decisions", { reason: "Requires finding.decide" });
  }
  const now = new Date().toISOString();
  const rows = body.decisions.map((d) => ({
    id: newId("ims"), groupId: req.scope.groupId, entityId, period: body.period,
    documentId: d.documentId || null, invoice: d.invoice, supplier: d.supplier || null, supplierGstin: d.supplierGstin || null,
    action: d.action, reason: d.reason, source: body.source || "manual",
    decidedBy: actor(req), decidedAt: now,
    note: "Recorded in Satya. Take the same action on the GST portal IMS (or through your GSP) before the GSTR-3B due date.",
  }));
  await col("assistant_ims_decisions").insertMany(rows.map((r) => ({ ...r })));
  res.status(201).json({ period: body.period, recorded: rows.length, items: rows });
}));

router.get("/ims-decisions", handle(async (req, res) => {
  const filter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (/^\d{4}-\d{2}$/.test(String(req.query.period || ""))) filter.period = String(req.query.period);
  const items = await col("assistant_ims_decisions").find(filter).sort({ decidedAt: -1 }).limit(200).toArray();
  res.json({ items: items.map(clean) });
}));

export default router;
