import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Supplier from "../../models/Supplier.js";
import Entity from "../../models/Entity.js";
import Finding from "../../models/Finding.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const days = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const today = () => new Date().toISOString().slice(0, 10);
const actorOf = (req) => req.user.v2id || String(req.user._id);

const money = (v) => ({ amount: Number(v).toFixed(2), currency: "INR" });
const num = (v) => Number(v?.amount ?? v ?? 0) || 0;
const grandOf = (d) => num(d?.totals?.grand) || (d?.lines ?? []).reduce((s, l) => s + num(l.qty) * num(l.rate), 0);
const taxOf = (d) => num(d?.gst?.itcAmount) || ["cgst", "sgst", "igst"].reduce((s, k) => s + num(d?.totals?.[k]), 0);

const scopeFilter = (req, entityId) => {
  const f = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (entityId) {
    if (!req.scope.wildcard && !req.scope.entityIds.includes(entityId)) throw fail(404, "NOT_FOUND", "Entity not found");
    f.entityId = entityId;
  }
  return f;
};

const loadScopedDoc = async (req, id) => {
  const doc = await Document.findOne({ id, groupId: req.scope.groupId });
  if (!doc || (!req.scope.wildcard && !req.scope.entityIds.includes(doc.entityId))) {
    throw fail(404, "NOT_FOUND", "Document not found");
  }
  return doc;
};

const canEdit = (req, entityId) => {
  if (!scopeAllows(req.scope, "doc.upload", entityId)) {
    throw fail(403, "FORBIDDEN", "Your role cannot update compliance records", { reason: "Requires doc.upload" });
  }
};

// Paid-so-far per invoice from payment allocations.
const paidMapFor = async (f) => {
  const payments = await Document.find({ ...f, type: { $in: ["PAYMENT_OUT", "ADVANCE_OUT"] }, status: { $nin: ["draft", "cancelled"] } }).lean();
  const paidFor = new Map();
  for (const p of payments) for (const a of p.payment?.allocations || []) {
    paidFor.set(a.documentId, (paidFor.get(a.documentId) || 0) + num(a.amount));
  }
  return { payments, paidFor };
};

const normInvNo = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sellerKey = (d) => String(d?.seller?.gstin || d?.seller?.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const firstEmail = (s) => (s?.contacts || []).map((c) => c?.email).find(Boolean) || null;

const INVOICE_IN_OPEN = { type: "INVOICE_IN", status: { $nin: ["draft", "cancelled", "reversed"] } };
const isGstr2bDoc = (d) => d.type === "GSTR2B_ENTRY" || String(d.externalRef || "").startsWith("gstr2b:");

const loadComplianceBase = async (req) => {
  const f = scopeFilter(req, req.query.entityId);
  const [invoices, suppliers, { payments, paidFor }] = await Promise.all([
    Document.find({ ...f, type: { $in: ["INVOICE_IN", "GSTR2B_ENTRY"] }, status: { $nin: ["draft", "cancelled", "reversed"] } }).lean(),
    Supplier.find({ groupId: req.scope.groupId }).lean(),
    paidMapFor(f),
  ]);
  return { f, invoices, suppliers, payments, paidFor };
};

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

// GET /compliance/msme — unpaid invoices from micro/small suppliers, sorted by
// how close they are to the MSMED payment deadline (agreed terms, max 45 days).
router.get("/msme", handle(async (req, res) => {
  const { invoices, suppliers, paidFor } = await loadComplianceBase(req);
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const isMsme = (s) => !!(s && (s.udyam?.category || s.msme));

  const items = invoices.filter((d) => !isGstr2bDoc(d)).map((d) => {
    const sup = byId.get(d.supplierId) || byId.get(d.seller?.supplierId) || byName.get(d.seller?.name);
    return { d, sup };
  }).filter(({ sup, d }) => isMsme(sup) || d.seller?.udyam).map(({ d, sup }) => {
    const agreedDays = Number(sup?.paymentTermsDays || d.terms?.creditDays || 45);
    const legalDays = Math.min(agreedDays, 45); // MSMED Act caps written terms at 45 days
    const due = new Date(new Date(d.date).getTime() + legalDays * 86400000);
    const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
    const grand = grandOf(d);
    const paid = paidFor.get(d.id) || 0;
    const outstanding = Math.max(0, grand - paid);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierId: sup?.id ?? d.seller?.supplierId ?? null,
      category: sup?.udyam?.category ?? (d.seller?.udyam ? "recorded" : null),
      supplierEmail: firstEmail(sup),
      amount: money(grand), paidSoFar: money(paid), outstanding: money(outstanding),
      amountRecorded: grand > 0,
      agreedDays, dueDate: due.toISOString().slice(0, 10), daysLeft,
      status: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "due_soon" : "upcoming",
      note: daysLeft < 0
        ? `Overdue by ${-daysLeft} days — compound interest at 3× the RBI rate is already running`
        : `Pay within ${legalDays} days of acceptance (${agreedDays}-day terms agreed)`,
    };
  }).filter((r) => num(r.outstanding.amount) > 0.005 || !r.amountRecorded)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  res.json({
    items: items.slice(0, 150),
    summary: {
      open: items.length,
      overdue: items.filter((r) => r.status === "overdue").length,
      dueThisWeek: items.filter((r) => r.status === "due_soon").length,
      outstanding: money(items.reduce((s, r) => s + num(r.outstanding.amount), 0)),
      overdueAmount: money(items.filter((r) => r.status === "overdue").reduce((s, r) => s + num(r.outstanding.amount), 0)),
    },
    note: "Paid in full or allocated payments are excluded. The deadline counts from the invoice date; acceptance dates from delivery records can move it.",
  });
}));

// GET /compliance/gstr2b?period= — match books against imported GSTR-2B entries.
// Without an import, falls back to open findings as *suspected* missing items.
router.get("/gstr2b", handle(async (req, res) => {
  const { f, invoices, suppliers } = await loadComplianceBase(req);
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const books = invoices.filter((d) => !isGstr2bDoc(d));
  const twoB = invoices.filter((d) => isGstr2bDoc(d));

  const rowOf = (d, extra = {}) => {
    const sup = byIdOf(suppliers, d) || byName.get(d.seller?.name);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier",
      supplierEmail: firstEmail(sup),
      amount: money(grandOf(d)), tax: money(taxOf(d)),
      period: d.gst?.gstr2bPeriod ?? null,
      ...extra,
    };
  };
  const byIdOf = (list, d) => list.find((s) => s.id === (d.supplierId || d.seller?.supplierId));

  if (!twoB.length) {
    // Estimated mode: open findings stand in for "suspected missing" until a
    // real GSTR-2B file is imported via POST /import/gstr2b.
    const findings = await Finding.find({ ...f, status: "open" }).lean();
    const flagged = new Set(findings.flatMap((x) => (x.data?.evidence ?? []).map((e) => e.documentId)));
    const flaggedInv = books.filter((d) => flagged.has(d.id));
    return res.json({
      estimated: true,
      period: req.query.period || today().slice(0, 7),
      periods: [],
      matched: books.length - flaggedInv.length,
      missingIn2B: flaggedInv.slice(0, 50).map((d) => rowOf(d)),
      missingInBooks: [],
      mismatched: [],
      itcAtRisk: money(flaggedInv.reduce((s, d) => s + taxOf(d), 0)),
      note: "No GSTR-2B file imported yet — rows shown are suspected mismatches from open issues, not a portal match.",
    });
  }

  const periods = [...new Set(twoB.map((d) => d.gst?.gstr2bPeriod).filter(Boolean))].sort();
  const period = req.query.period && periods.includes(req.query.period)
    ? req.query.period
    : (periods[periods.length - 1] || today().slice(0, 7));
  // Supplier can report a late invoice in a later 2B — match books up to the
  // selected period against every 2B period up to it.
  const twoBUpto = twoB.filter((d) => !d.gst?.gstr2bPeriod || d.gst.gstr2bPeriod <= period);
  const twoBInPeriod = twoB.filter((d) => !d.gst?.gstr2bPeriod || d.gst.gstr2bPeriod === period);
  const twoBKeys = new Map(twoBUpto.map((d) => [`${sellerKey(d)}|${normInvNo(d.number)}`, d]));
  const bookKeys = new Map(books.map((d) => [`${sellerKey(d)}|${normInvNo(d.number)}`, d]));
  const booksUpto = books.filter((d) => String(d.date || "").slice(0, 7) <= period);

  const missingIn2B = [], mismatched = [], matched = [];
  for (const d of booksUpto) {
    const twin = twoBKeys.get(`${sellerKey(d)}|${normInvNo(d.number)}`);
    if (!twin) { missingIn2B.push(rowOf(d)); continue; }
    const taxDiff = Math.abs(taxOf(twin) - taxOf(d));
    const valDiff = Math.abs(grandOf(twin) - grandOf(d));
    if (taxDiff > 1 || valDiff > 1) {
      mismatched.push(rowOf(d, { reportedValue: money(grandOf(twin)), reportedTax: money(taxOf(twin)), difference: money(Math.max(taxDiff, valDiff)) }));
    } else {
      matched.push(d);
    }
  }
  const missingInBooks = twoBInPeriod
    .filter((d) => !bookKeys.has(`${sellerKey(d)}|${normInvNo(d.number)}`))
    .map((d) => rowOf(d));

  res.json({
    estimated: false,
    period, periods,
    matched: matched.length,
    missingIn2B: missingIn2B.slice(0, 100),
    missingInBooks: missingInBooks.slice(0, 100),
    mismatched: mismatched.slice(0, 100),
    itcAtRisk: money(missingIn2B.reduce((s, r) => s + num(r.tax.amount), 0) + mismatched.reduce((s, r) => s + num(r.difference.amount), 0)),
    note: "Matched on supplier GSTIN + invoice number from your imported GSTR-2B.",
  });
}));

// GET /compliance/rule37 — invoices unpaid long enough that claimed ITC must
// be reversed (180 days) or is about to be (150+ days).
router.get("/rule37", handle(async (req, res) => {
  const { invoices, suppliers, paidFor } = await loadComplianceBase(req);
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const now = today();

  const items = invoices.filter((d) => !isGstr2bDoc(d)).map((d) => {
    const itc = taxOf(d);
    const grand = grandOf(d);
    const paid = paidFor.get(d.id) || 0;
    const outstanding = Math.max(0, grand - paid);
    const waiting = days(d.date, now);
    if (itc <= 0 || outstanding <= 0.005 || waiting <= 150) return null;
    const reversed = !!d.gst?.itcReversed;
    const daysPast = waiting - 180;
    const sup = suppliers.find((s) => s.id === (d.supplierId || d.seller?.supplierId)) || byName.get(d.seller?.name);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierEmail: firstEmail(sup),
      daysWaiting: waiting, daysToBreach: Math.max(0, 180 - waiting),
      state: reversed ? "reversed" : waiting > 180 ? "breached" : "approaching",
      itc: money(itc), paidSoFar: money(paid), outstanding: money(outstanding),
      interestEstimate: !reversed && daysPast > 0 ? money(itc * 0.18 * daysPast / 365) : null,
      reversedAt: d.gst?.itcReversed?.at ?? null, reversedBy: d.gst?.itcReversed?.by ?? null,
      reversalNote: d.gst?.itcReversed?.note ?? null,
    };
  }).filter(Boolean).sort((a, b) => b.daysWaiting - a.daysWaiting);

  res.json({
    items,
    summary: {
      breached: items.filter((r) => r.state === "breached").length,
      approaching: items.filter((r) => r.state === "approaching").length,
      reversed: items.filter((r) => r.state === "reversed").length,
      itcAtRisk: money(items.filter((r) => r.state !== "reversed").reduce((s, r) => s + num(r.itc.amount), 0)),
      interestAccruing: money(items.reduce((s, r) => s + num(r.interestEstimate?.amount), 0)),
    },
    note: "Rule 37: ITC claimed on an invoice unpaid after 180 days is added back to your output tax with 18% interest. Mark a reversal after you post it in GSTR-3B.",
  });
}));

// GET /compliance/tds — payments where a TDS decision is missing, recorded or
// waived. Thresholds are screening hints, not determinations.
router.get("/tds", handle(async (req, res) => {
  const { f, payments, suppliers } = await loadComplianceBase(req);
  const tdsDocs = await Document.find({ ...f, type: "TDS_ENTRY", status: { $nin: ["draft", "cancelled"] } }).lean();
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const currentFy = fyOf(new Date());

  const fyPaidBySupplier = new Map();
  for (const p of payments) {
    const fy = p.fy || fyOf(p.date);
    if (fy !== currentFy) continue;
    const name = p.seller?.name || "Counterparty";
    fyPaidBySupplier.set(name, (fyPaidBySupplier.get(name) || 0) + num(p.payment?.amount));
  }

  const rows = [];
  for (const p of payments) {
    const amount = num(p.payment?.amount);
    const tds = p.payment?.tds || {};
    const supplier = byName.get(p.seller?.name)?.legalName ?? p.seller?.name ?? "Counterparty";
    const fyTotal = fyPaidBySupplier.get(p.seller?.name) || 0;
    const base = {
      documentId: p.id, payment: p.number ?? p.externalRef ?? p.id, date: p.date, utr: p.payment?.utr ?? null,
      supplier, amount: money(amount),
    };
    if (num(tds.amount) > 0) {
      rows.push({ ...base, status: "recorded", section: tds.section || null, tdsAmount: money(tds.amount), note: `TDS recorded under section ${tds.section || "—"}` });
    } else if (tds.notApplicable) {
      rows.push({ ...base, status: "waived", note: tds.note ? `Marked N/A — ${tds.note}` : "Marked as not applicable" });
    } else if (fyTotal > 5000000) {
      rows.push({ ...base, status: "check", section: "194Q", fyPaidToSupplier: money(fyTotal), note: `₹${Math.round(fyTotal / 100000)}L+ paid to this supplier this FY — section 194Q may apply` });
    } else if (amount >= 250000) {
      rows.push({ ...base, status: "check", fyPaidToSupplier: money(fyTotal), note: "Payment over ₹2.5 lakh — confirm whether a TDS section applies" });
    }
  }
  rows.sort((a, b) => (a.status === "check" ? 0 : 1) - (b.status === "check" ? 0 : 1) || num(b.amount.amount) - num(a.amount.amount));

  const recorded = tdsDocs.map((d) => ({
    documentId: d.id, section: d.payment?.tds?.section || "—", amount: money(d.payment?.tds?.amount),
    rate: d.payment?.tds?.rate ?? null, date: d.date,
    paymentId: d.payment?.allocations?.[0]?.documentId ?? null,
    note: d.payment?.tds?.note ?? null,
  }));

  res.json({
    items: rows.slice(0, 150),
    recorded,
    summary: {
      paymentsScanned: payments.length,
      needsDecision: rows.filter((r) => r.status === "check").length,
      recorded: rows.filter((r) => r.status === "recorded").length,
      waived: rows.filter((r) => r.status === "waived").length,
      tdsDeducted: money(tdsDocs.reduce((s, d) => s + num(d.payment?.tds?.amount), 0)),
    },
    note: "Satya flags payments that commonly need a TDS check (194C works, 194J professional, 194Q goods over ₹50L/year per supplier). Your obligation depends on your turnover and the payee — this is a worklist, not a filing.",
  });
}));

// GET /compliance/eway — e-invoice IRN and e-way bill coverage on purchases.
router.get("/eway", handle(async (req, res) => {
  const { invoices, suppliers } = await loadComplianceBase(req);
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const books = invoices.filter((d) => !isGstr2bDoc(d));
  const goodsDoc = (d) => !(d.lines?.length && d.lines.every((l) => String(l.hsn || "").startsWith("99")));

  const rowOf = (d) => {
    const sup = suppliers.find((s) => s.id === (d.supplierId || d.seller?.supplierId)) || byName.get(d.seller?.name);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierEmail: firstEmail(sup),
      amount: money(grandOf(d)), irn: d.gst?.irn ?? null, ewb: d.gst?.ewb ?? null,
    };
  };

  const withIrn = books.filter((d) => d.gst?.irn);
  const irnChecks = books
    .filter((d) => !d.gst?.irn && d.gst?.irnStatus !== "not_applicable" && grandOf(d) >= 500000)
    .map((d) => ({ ...rowOf(d), reason: "High-value invoice with no IRN — if the supplier crosses the e-invoice turnover band, the invoice needs an IRN for your credit to be safe." }))
    .sort((a, b) => num(b.amount.amount) - num(a.amount.amount));
  const irnWaived = books.filter((d) => d.gst?.irnStatus === "not_applicable").length;

  const withEwb = books.filter((d) => d.gst?.ewb);
  const ewbChecks = books
    .filter((d) => !d.gst?.ewb && d.gst?.ewbStatus !== "not_required" && goodsDoc(d) && grandOf(d) >= 50000)
    .map((d) => ({ ...rowOf(d), reason: "Goods over ₹50,000 need an e-way bill for the movement — confirm the supplier or transporter generated one." }))
    .sort((a, b) => num(b.amount.amount) - num(a.amount.amount));
  const ewbWaived = books.filter((d) => d.gst?.ewbStatus === "not_required").length;

  res.json({
    einvoice: {
      withIrn: withIrn.length, waived: irnWaived, checks: irnChecks.slice(0, 100),
      pct: books.length ? Number(((withIrn.length / books.length) * 100).toFixed(1)) : 0,
    },
    eway: {
      withEwb: withEwb.length, waived: ewbWaived, checks: ewbChecks.slice(0, 100),
      goodsInvoices: books.filter(goodsDoc).length,
    },
    note: "IRN/e-way details recorded here are supplier-supplied values — Satya does not verify them against the GST portal.",
  });
}));

// GET /compliance/lut — Letter of Undertaking coverage per entity + outbound
// supplies billed without IGST that rely on a valid LUT.
router.get("/lut", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const [entities, outward] = await Promise.all([
    Entity.find({ id: f.entityId, groupId: req.scope.groupId }).lean(),
    Document.find({ ...f, type: "INVOICE_OUT", status: { $nin: ["draft", "cancelled", "reversed"] } }).lean(),
  ]);
  const now = today();

  const rows = entities.map((e) => {
    const luts = (e.lut || []).map((l) => {
      const left = days(now, l.validTo);
      return {
        arn: l.arn, fy: l.fy, validFrom: l.validFrom, validTo: l.validTo,
        daysLeft: left,
        status: left < 0 ? "expired" : left <= 30 ? "expiring" : "active",
      };
    }).sort((a, b) => String(b.validTo || "").localeCompare(String(a.validTo || "")));
    const active = luts.find((l) => l.status === "active" || l.status === "expiring");
    return {
      entityId: e.id, code: e.code, legalName: e.legalName,
      status: active ? active.status : "none",
      currentArn: active?.arn ?? null, validTo: active?.validTo ?? null,
      luts,
    };
  });

  const exportInvoices = outward
    .filter((d) => num(d.totals?.igst) === 0)
    .map((d) => ({
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      buyer: d.buyer?.name ?? "Buyer", amount: money(grandOf(d)),
      covered: rows.some((r) => r.entityId === d.entityId && (r.status === "active" || r.status === "expiring")),
    }));

  res.json({
    entities: rows,
    exportInvoices,
    summary: {
      entities: rows.length,
      covered: rows.filter((r) => r.status === "active" || r.status === "expiring").length,
      uncoveredExports: exportInvoices.filter((d) => !d.covered).length,
    },
    note: "A LUT is filed per entity per financial year (GST RFD-11). Export/SEZ supplies without IGST are only valid while a LUT covers the invoice date.",
  });
}));

// ---------- write actions ----------

// POST /compliance/itc-reversal {documentId, reversed, note?}
// Marks/unmarks an invoice's ITC as reversed under Rule 37.
router.post("/itc-reversal", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { documentId, reversed, note } = req.body || {};
  if (!documentId || typeof reversed !== "boolean") throw fail(422, "VALIDATION_FAILED", "documentId and reversed (true/false) are required");
  const doc = await loadScopedDoc(req, documentId);
  canEdit(req, doc.entityId);
  // Mixed schema type: mutate a local copy, then assign the whole object —
  // nested writes on doc.gst never reach the document.
  const gst = { ...(doc.gst || {}) };
  if (reversed) {
    gst.itcReversed = { at: new Date().toISOString(), by: actorOf(req), amount: taxOf(doc).toFixed(2), note: note ? String(note).slice(0, 300) : undefined };
  } else {
    delete gst.itcReversed;
  }
  doc.gst = gst;
  doc.revision += 1;
  await doc.save();
  res.json({ documentId: doc.id, itcReversed: doc.gst.itcReversed ?? null, revision: doc.revision });
}));

// POST /compliance/gst-meta {documentId, irn?, ewb?, irnStatus?, ewbStatus?, note?}
// Records supplier-supplied e-invoice IRN / e-way bill values on a document.
router.post("/gst-meta", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { documentId, irn, ewb, irnStatus, ewbStatus, note } = req.body || {};
  if (!documentId) throw fail(422, "VALIDATION_FAILED", "documentId is required");
  const doc = await loadScopedDoc(req, documentId);
  canEdit(req, doc.entityId);
  const gst = { ...(doc.gst || {}) };

  if (irn !== undefined) {
    const v = String(irn).trim();
    if (v && !/^[0-9a-f]{64}$/i.test(v)) throw fail(422, "VALIDATION_FAILED", "IRN is a 64-character code — check the value", { fields: ["irn"] });
    if (v) gst.irn = v; else delete gst.irn;
    if (v) delete gst.irnStatus;
  }
  if (ewb !== undefined) {
    const v = String(ewb).trim().replace(/\s/g, "");
    if (v && !/^\d{12}$/.test(v)) throw fail(422, "VALIDATION_FAILED", "E-way bill number is 12 digits", { fields: ["ewb"] });
    if (v) gst.ewb = v; else delete gst.ewb;
    if (v) delete gst.ewbStatus;
  }
  if (irnStatus !== undefined) {
    if (!["not_applicable", null].includes(irnStatus)) throw fail(422, "VALIDATION_FAILED", "irnStatus must be 'not_applicable' or null");
    if (irnStatus) gst.irnStatus = irnStatus; else delete gst.irnStatus;
  }
  if (ewbStatus !== undefined) {
    if (!["not_required", null].includes(ewbStatus)) throw fail(422, "VALIDATION_FAILED", "ewbStatus must be 'not_required' or null");
    if (ewbStatus) gst.ewbStatus = ewbStatus; else delete gst.ewbStatus;
  }
  if (note) gst.metaNote = String(note).slice(0, 300);
  gst.metaRecordedBy = actorOf(req);
  gst.metaRecordedAt = new Date().toISOString();
  doc.gst = gst;
  doc.revision += 1;
  await doc.save();
  res.json({ documentId: doc.id, gst: doc.gst, revision: doc.revision });
}));

// POST /compliance/lut {entityId, arn, fy, validFrom, validTo, remove?}
// Adds or refreshes a LUT entry on an entity (compliance-scope write — entity
// admins can also do this through PATCH /entities/:id).
router.post("/lut", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { entityId, arn, fy, validFrom, validTo, remove } = req.body || {};
  if (!entityId || !arn) throw fail(422, "VALIDATION_FAILED", "entityId and arn are required");
  const entity = await Entity.findOne({ id: entityId, groupId: req.scope.groupId });
  if (!entity || (!req.scope.wildcard && !req.scope.entityIds.includes(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
  canEdit(req, entityId);

  const arnNorm = String(arn).trim().toUpperCase();
  const luts = (entity.lut || []).map((l) => ({ arn: l.arn, fy: l.fy, validFrom: l.validFrom, validTo: l.validTo }));
  const idx = luts.findIndex((l) => l.arn === arnNorm);
  if (remove) {
    if (idx >= 0) luts.splice(idx, 1);
  } else {
    if (!/^[A-Z0-9]{10,40}$/.test(arnNorm)) throw fail(422, "VALIDATION_FAILED", "ARN looks wrong — expected the reference from the GST RFD-11 acknowledgement", { fields: ["arn"] });
    if (!/^\d{4}-\d{2}$/.test(String(fy))) throw fail(422, "VALIDATION_FAILED", "Financial year must look like 2026-27", { fields: ["fy"] });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(validFrom)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(validTo))) {
      throw fail(422, "VALIDATION_FAILED", "validFrom and validTo must be YYYY-MM-DD", { fields: ["validFrom", "validTo"] });
    }
    if (validTo < validFrom) throw fail(422, "VALIDATION_FAILED", "validTo must be after validFrom", { fields: ["validTo"] });
    const entry = { arn: arnNorm, fy: String(fy), validFrom: String(validFrom), validTo: String(validTo) };
    if (idx >= 0) luts[idx] = entry; else luts.push(entry);
  }
  entity.lut = luts;
  await entity.save();
  res.json({ entityId: entity.id, lut: entity.lut });
}));

// POST /compliance/tds-decision {paymentId, action: "record"|"waive", section?, rate?, amount?, note?}
// "record" creates a TDS_ENTRY document linked to the payment; "waive" marks
// the payment as reviewed with no TDS due.
router.post("/tds-decision", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { paymentId, action, section, rate, amount, note } = req.body || {};
  if (!paymentId || !["record", "waive"].includes(action)) {
    throw fail(422, "VALIDATION_FAILED", "paymentId and action ('record' or 'waive') are required");
  }
  const payment = await loadScopedDoc(req, paymentId);
  if (!["PAYMENT_OUT", "ADVANCE_OUT"].includes(payment.type)) throw fail(422, "VALIDATION_FAILED", "TDS decisions apply to outward payments only");
  canEdit(req, payment.entityId);
  const actor = actorOf(req);
  // Mixed schema type: build the new payment object, then assign it whole.
  const paymentData = { ...(payment.payment || {}) };

  if (action === "waive") {
    paymentData.tds = { notApplicable: true, note: note ? String(note).slice(0, 300) : undefined, by: actor, at: new Date().toISOString() };
    payment.payment = paymentData;
    payment.revision += 1;
    await payment.save();
    return res.json({ paymentId: payment.id, tds: paymentData.tds });
  }

  const amountNum = num(amount);
  if (!section || !(amountNum > 0)) throw fail(422, "VALIDATION_FAILED", "section and a positive amount are required to record TDS");
  const externalRef = `tds:${payment.id}:${section}`;
  let entry = await Document.findOne({ groupId: req.scope.groupId, externalRef });
  if (!entry) {
    entry = await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId: payment.entityId,
      type: "TDS_ENTRY", number: `TDS/${fyOf(payment.date)}/${payment.number || payment.id.slice(-6)}`,
      externalRef, date: today(), fy: fyOf(today()), status: "posted", revision: 0,
      seller: payment.seller, buyer: payment.buyer, supplierId: payment.supplierId,
      currency: payment.currency || "INR", lines: [],
      payment: { tds: { section: String(section), rate: rate ? String(rate) : undefined, amount: amountNum.toFixed(2), note: note ? String(note).slice(0, 300) : undefined }, allocations: [{ documentId: payment.id, amount: amountNum.toFixed(2), basis: "reviewer" }] },
      source: { channel: "compliance" }, provenance: "USER_PROVIDED",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    await DocumentLink.create({
      id: newId("lnk"), groupId: req.scope.groupId,
      fromId: entry.id, toId: payment.id, kind: "ADJUSTS",
      certainty: "CONFIRMED", basis: "reviewer", createdBy: actor,
    });
  } else {
    entry.payment = { ...entry.payment, tds: { ...(entry.payment?.tds || {}), section: String(section), rate: rate ? String(rate) : undefined, amount: amountNum.toFixed(2), note: note ? String(note).slice(0, 300) : undefined } };
    entry.revision += 1;
    await entry.save();
  }
  paymentData.tds = { section: String(section), rate: rate ? String(rate) : undefined, amount: amountNum.toFixed(2), entryId: entry.id, note: note ? String(note).slice(0, 300) : undefined, by: actor, at: new Date().toISOString() };
  payment.payment = paymentData;
  payment.revision += 1;
  await payment.save();
  res.status(201).json({ paymentId: payment.id, tds: paymentData.tds, tdsEntryId: entry.id });
}));

export default router;
