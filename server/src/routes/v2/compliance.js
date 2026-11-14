import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Supplier from "../../models/Supplier.js";
import Entity from "../../models/Entity.js";
import Finding from "../../models/Finding.js";
import { newId } from "../../lib/ids.js";
import { fyOf, daysBetween, todayIst } from "../../lib/fy.js";
import { money, toPaise, fromPaise, grandOf, taxOf, taxableOf, mulRate, toDecimal, isPositive, toNumber } from "../../lib/money.js";
import { settledPaiseFor } from "../../services/settlement.js";
import { acceptanceDates, msmeCategoryOf, msmeCovered, msmeDeadline, MSME_MAX_DAYS } from "../../services/msme.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

// Statutory SCREENING checks over recorded documents. These are worklists
// that point a reviewer at what to verify — not tax or legal advice, and
// supplier-supplied tax fields are not verified against government systems.
export const SCREENING_NOTE = "Screening checks over your recorded documents — not tax or legal advice. Confirm positions with your CA.";

const router = express.Router();
const today = () => todayIst();
const days = (a, b) => daysBetween(a, b);
const actorOf = (req) => req.user.v2id || String(req.user._id);

const scopeFilter = (req, entityId) => {
  const f = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (entityId) {
    if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    f.entityId = String(entityId);
  }
  return f;
};

const loadScopedDoc = async (req, id) => {
  const doc = await Document.findOne({ id: String(id), groupId: req.scope.groupId });
  if (!doc || !req.scope.entityIds.includes(doc.entityId)) throw fail(404, "NOT_FOUND", "Document not found");
  return doc;
};

const canEdit = (req, entityId) => {
  if (!scopeAllows(req.scope, "doc.upload", entityId)) {
    throw fail(403, "FORBIDDEN", "Your role cannot update compliance records", { reason: "Requires doc.upload" });
  }
};

const normInvNo = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sellerKey = (d) => String(d?.seller?.gstin || d?.seller?.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const firstEmail = (s) => (s?.contacts || []).map((c) => c?.email).find(Boolean) || null;
const isGstr2bDoc = (d) => d.type === "GSTR2B_ENTRY" || String(d.externalRef || "").startsWith("gstr2b:");
const ewayOf = (d) => d?.gst?.ewayBillNo || d?.gst?.ewb || null;

// projected loads: compliance tabs never need snapshots/approvals/etc.
const INVOICE_FIELDS = { id: 1, type: 1, number: 1, externalRef: 1, date: 1, fy: 1, totals: 1, lines: 1, charges: 1, seller: 1, supplierId: 1, terms: 1, gst: 1, entityId: 1 };
const PAYMENT_FIELDS = { id: 1, number: 1, externalRef: 1, date: 1, fy: 1, payment: 1, seller: 1, supplierId: 1, entityId: 1 };
const SUPPLIER_FIELDS = { id: 1, legalName: 1, udyam: 1, msme: 1, paymentTermsDays: 1, contacts: 1, aatoBand: 1, einvoiceApplicable: 1, tdsSection: 1, pan: 1 };

const supplierIndex = (suppliers) => {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  return (d) => byId.get(d.supplierId) || byId.get(d.seller?.supplierId) || byName.get(d.seller?.name) || null;
};

const loadComplianceBase = async (req, { payments: wantPayments = true } = {}) => {
  const f = scopeFilter(req, req.query.entityId);
  const [invoices, suppliers, payments] = await Promise.all([
    Document.find({ ...f, type: { $in: ["INVOICE_IN", "GSTR2B_ENTRY"] }, status: { $nin: ["draft", "cancelled", "reversed"] } }, INVOICE_FIELDS).lean(),
    Supplier.find({ groupId: req.scope.groupId }, SUPPLIER_FIELDS).lean(),
    wantPayments ? Document.find({ ...f, type: { $in: ["PAYMENT_OUT", "ADVANCE_OUT"] }, status: { $nin: ["draft", "cancelled", "reversed"] } }, PAYMENT_FIELDS).lean() : [],
  ]);
  const books = invoices.filter((d) => !isGstr2bDoc(d));
  const settled = await settledPaiseFor(req.scope.groupId, books.map((d) => d.id));
  const paidFor = new Map([...settled.entries()].map(([k, v]) => [k, v]));
  return { f, invoices, books, suppliers, payments, paidFor, supplierOf: supplierIndex(suppliers) };
};
const outstandingPaise = (d, paidFor) => { const o = toPaise(grandOf(d)) - (paidFor.get(d.id) || 0n); return o > 0n ? o : 0n; };

// ---------- MSME (MSMED Act s.15–16) ----------
const msmeRows = async (req, base) => {
  const { books, paidFor, supplierOf } = base;
  const candidates = books.map((d) => ({ d, sup: supplierOf(d) }))
    .map((x) => ({ ...x, category: msmeCategoryOf(x.sup, x.d) }))
    .filter((x) => msmeCovered(x.category));
  const accepted = await acceptanceDates(req.scope.groupId, candidates.map((x) => x.d));
  return candidates.map(({ d, sup, category }) => {
    const dl = msmeDeadline(d, sup, accepted.get(d.id));
    const grand = toPaise(grandOf(d));
    const paid = paidFor.get(d.id) || 0n;
    const outstanding = grand - paid > 0n ? grand - paid : 0n;
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierId: sup?.id ?? d.seller?.supplierId ?? null,
      category: category === "unknown" ? "recorded" : category,
      supplierEmail: firstEmail(sup),
      amount: money(fromPaise(grand)), paidSoFar: money(fromPaise(paid)), outstanding: money(fromPaise(outstanding)),
      amountRecorded: grand > 0n,
      agreedDays: dl.agreedDays, legalDays: dl.legalDays, termsBasis: dl.termsBasis,
      clockStart: dl.clockStart, clockBasis: dl.clockBasis,
      dueDate: dl.dueDate, daysLeft: dl.daysLeft,
      status: dl.daysLeft < 0 ? "overdue" : dl.daysLeft <= 7 ? "due_soon" : "upcoming",
      note: dl.daysLeft < 0
        ? `Overdue by ${-dl.daysLeft} days — compound interest at 3× the RBI bank rate runs from the due date (MSMED s.16)`
        : `Pay within ${dl.legalDays} days of ${dl.clockBasis === "invoice_date" ? "the invoice date (no acceptance record found)" : "acceptance"} (${dl.termsBasis === "agreed" ? `${dl.agreedDays}-day terms agreed, capped at ${MSME_MAX_DAYS}` : "no written terms: 15 days"})`,
    };
  }).filter((r) => toPaise(r.outstanding) > 0n || !r.amountRecorded)
    .sort((a, b) => a.daysLeft - b.daysLeft);
};

// ---------- TDS screening (194Q goods / 194C contracts) ----------
// 194Q: buyer with > ₹10 cr turnover deducts 0.1% on purchase VALUE
// (excluding GST) from one seller above ₹50 lakh in a FY, on the excess.
// 194C: payments to contractors — single payment > ₹30,000 or FY aggregate
// > ₹1,00,000 (1% individual/HUF, 2% others). Never on GST-inclusive values.
const L50 = toPaise("5000000");
const C30K = toPaise("30000");
const C1L = toPaise("100000");
const isServiceInvoice = (d) => (d.lines || []).length > 0 && (d.lines || []).every((l) => String(l.hsn || "").startsWith("99"));

const tdsScreen = (base, entity, fy) => {
  const { books, payments, supplierOf } = base;
  const bySupplier = new Map(); // key -> {sup, name, goodsTaxable, serviceTaxable, payments:[]}
  const keyOf = (d) => supplierOf(d)?.id || d.seller?.gstin || d.seller?.name || "unknown";
  const slot = (d) => {
    const k = keyOf(d);
    if (!bySupplier.has(k)) bySupplier.set(k, { sup: supplierOf(d), name: supplierOf(d)?.legalName || d.seller?.name || "Counterparty", goods: 0n, services: 0n, pays: [] });
    return bySupplier.get(k);
  };
  for (const d of books) {
    if ((d.fy || fyOf(d.date)) !== fy) continue;
    const s = slot(d);
    if (isServiceInvoice(d)) s.services += toPaise(taxableOf(d));
    else s.goods += toPaise(taxableOf(d));
  }
  for (const p of payments) if ((p.fy || fyOf(p.date)) === fy) slot(p).pays.push(p);
  const buyerBand = entity?.aatoBand || null;
  const buyer194Q = buyerBand === ">=10cr" ? "applies" : buyerBand ? "not_applicable" : "unknown";
  const out = new Map(); // supplier key -> screening
  for (const [k, s] of bySupplier) {
    const declared = s.sup?.tdsSection || null;
    const screen = { supplierKey: k, supplier: s.name, goodsPurchasesFy: fromPaise(s.goods), servicePurchasesFy: fromPaise(s.services), buyer194Q };
    if (declared) screen.section = declared;
    if ((declared === "194Q" || (!declared && s.goods > 0n)) && s.goods > L50) {
      const excess = s.goods - L50;
      screen.section = "194Q";
      screen.tdsEstimate = buyer194Q === "not_applicable" ? "0.00" : mulRate(fromPaise(excess), "0.001");
      screen.estimate = { section: "194Q", rate: "0.1", base: fromPaise(excess), amount: screen.tdsEstimate };
      screen.basis = `0.1% of purchases excluding GST above ₹50 lakh this FY (₹${fromPaise(excess)} above the threshold)`;
    } else if (declared === "194C" || (!declared && s.services > 0n)) {
      const payTotal = s.pays.reduce((a, p) => a + toPaise(p.payment?.amount), 0n);
      const single = s.pays.some((p) => toPaise(p.payment?.amount) > C30K);
      if (single || payTotal > C1L || s.services > C1L) {
        screen.section = "194C";
        // 2% (non-individual payee) on the contract value excluding GST
        screen.estimate = { section: "194C", rate: "2", base: fromPaise(s.services), amount: mulRate(fromPaise(s.services), "0.02") };
        screen.basis = "Contract payments: single payment over ₹30,000 or FY aggregate over ₹1 lakh — 1% (individual/HUF) or 2% (others) on the value excluding GST";
      }
    }
    out.set(k, screen);
  }
  return { screens: out, keyOf, buyer194Q };
};

// GET /compliance/summary?entityId — statutory watch items (04 P3-B8).
router.get("/summary", handle(async (req, res) => {
  const base = await loadComplianceBase(req);
  const { f, books, paidFor } = base;
  const [tdsDocs, creditNotes] = await Promise.all([
    Document.find({ ...f, type: "TDS_ENTRY", status: { $nin: ["draft", "cancelled"] } }, { payment: 1 }).lean(),
    Document.find({ ...f, type: { $in: ["CREDIT_NOTE_IN", "DEBIT_NOTE_IN"] }, status: { $nin: ["draft", "cancelled"] } }, { id: 1, number: 1, date: 1, totals: 1, lines: 1, charges: 1 }).lean(),
  ]);
  const now = today();
  const msme45 = (await msmeRows(req, base)).filter((r) => r.daysLeft < 0)
    .map((r) => ({ documentId: r.documentId, number: r.invoice, date: r.date, supplier: r.supplier, dueDate: r.dueDate, overdueDays: -r.daysLeft, total: r.amount.amount, amount: r.outstanding }));

  const rule37 = books.filter((d) => isPositive(taxOf(d)) && outstandingPaise(d, paidFor) > 0n && days(d.date, now) > 180 && !d.gst?.itcReversed)
    .map((d) => ({ documentId: d.id, number: d.number, date: d.date, daysSinceInvoice: days(d.date, now), itcAtRisk: taxOf(d) }));

  const tdsSummary = {};
  for (const d of tdsDocs) {
    const section = d.payment?.tds?.section || "unknown";
    tdsSummary[section] = fromPaise(toPaise(tdsSummary[section]) + toPaise(d.payment?.tds?.amount));
  }
  const settledCredits = new Set((await DocumentLink.find({ groupId: req.scope.groupId, fromId: { $in: creditNotes.map((c) => c.id) }, kind: { $in: ["SETTLES", "ADJUSTS"] } }, { fromId: 1 }).lean()).map((l) => l.fromId));
  const creditNotesUnapplied = creditNotes.filter((d) => !settledCredits.has(d.id))
    .map((d) => ({ documentId: d.id, number: d.number, date: d.date, total: grandOf(d) }));
  const einvoiceDocs = books.filter((d) => d.gst?.irn);
  const itcTotal = books.reduce((s, d) => s + toPaise(taxOf(d)), 0n);
  const itcBlocked = rule37.reduce((s, d) => s + toPaise(d.itcAtRisk), 0n);

  res.json({
    msme45: { count: msme45.length, items: msme45 },
    rule37: { count: rule37.length, items: rule37, itcAtRisk: fromPaise(itcBlocked) },
    tdsSummary,
    itcSummary: { total: fromPaise(itcTotal), blockedOrAtRisk: fromPaise(itcBlocked) },
    einvoiceCoverage: { withIrn: einvoiceDocs.length, invoices: books.length, pct: books.length ? Number(((einvoiceDocs.length / books.length) * 100).toFixed(1)) : 0 },
    creditNotesUnapplied: { count: creditNotesUnapplied.length, items: creditNotesUnapplied },
    note: `Values derive from recorded documents only — supplied tax and e-invoice fields are not independently verified against government systems. ${SCREENING_NOTE}`,
  });
}));

// GET /compliance/msme — unpaid invoices from MICRO/SMALL suppliers, sorted by
// how close they are to the MSMED deadline (acceptance + agreed terms, max 45).
router.get("/msme", handle(async (req, res) => {
  const base = await loadComplianceBase(req);
  const items = await msmeRows(req, base);
  res.json({
    items: items.slice(0, 150),
    summary: {
      open: items.length,
      overdue: items.filter((r) => r.status === "overdue").length,
      dueThisWeek: items.filter((r) => r.status === "due_soon").length,
      outstanding: money(fromPaise(items.reduce((s, r) => s + toPaise(r.outstanding), 0n))),
      overdueAmount: money(fromPaise(items.filter((r) => r.status === "overdue").reduce((s, r) => s + toPaise(r.outstanding), 0n))),
    },
    note: `Micro and small suppliers only (medium enterprises are outside MSMED s.15). The clock starts at acceptance of the goods (GRN/QC) where recorded, else the invoice date; agreed terms apply up to 45 days. Paid or fully allocated invoices are excluded. ${SCREENING_NOTE}`,
  });
}));

// GET /compliance/gstr2b?period= — match books against imported GSTR-2B entries.
// Without an import, falls back to open findings as *suspected* missing items.
router.get("/gstr2b", handle(async (req, res) => {
  const { f, invoices, books, supplierOf } = await loadComplianceBase(req, { payments: false });
  const twoB = invoices.filter((d) => isGstr2bDoc(d));
  const rowOf = (d, extra = {}) => {
    const sup = supplierOf(d);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier",
      supplierEmail: firstEmail(sup),
      amount: money(grandOf(d)), tax: money(taxOf(d)),
      period: d.gst?.gstr2bPeriod ?? null,
      ...extra,
    };
  };

  if (!twoB.length) {
    const findings = await Finding.find({ ...f, status: "open" }, { "data.evidence": 1 }).lean();
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
      itcAtRisk: money(fromPaise(flaggedInv.reduce((s, d) => s + toPaise(taxOf(d)), 0n))),
      note: "No GSTR-2B file imported yet — rows shown are suspected mismatches from open issues, not a portal match.",
    });
  }

  const periods = [...new Set(twoB.map((d) => d.gst?.gstr2bPeriod).filter(Boolean))].sort();
  const period = req.query.period && periods.includes(String(req.query.period))
    ? String(req.query.period)
    : (periods[periods.length - 1] || today().slice(0, 7));
  const twoBUpto = twoB.filter((d) => !d.gst?.gstr2bPeriod || d.gst.gstr2bPeriod <= period);
  const twoBInPeriod = twoB.filter((d) => !d.gst?.gstr2bPeriod || d.gst.gstr2bPeriod === period);
  const twoBKeys = new Map(twoBUpto.map((d) => [`${sellerKey(d)}|${normInvNo(d.number)}`, d]));
  const bookKeys = new Map(books.map((d) => [`${sellerKey(d)}|${normInvNo(d.number)}`, d]));
  const booksUpto = books.filter((d) => String(d.date || "").slice(0, 7) <= period);

  const missingIn2B = [], mismatched = [], matched = [];
  const ONE_RUPEE = 100n;
  const absP = (v) => (v < 0n ? -v : v);
  for (const d of booksUpto) {
    const twin = twoBKeys.get(`${sellerKey(d)}|${normInvNo(d.number)}`);
    if (!twin) { missingIn2B.push(rowOf(d)); continue; }
    const taxDiff = absP(toPaise(taxOf(twin)) - toPaise(taxOf(d)));
    const valDiff = absP(toPaise(grandOf(twin)) - toPaise(grandOf(d)));
    if (taxDiff > ONE_RUPEE || valDiff > ONE_RUPEE) {
      mismatched.push(rowOf(d, { reportedValue: money(grandOf(twin)), reportedTax: money(taxOf(twin)), difference: money(fromPaise(taxDiff > valDiff ? taxDiff : valDiff)), taxDifference: money(fromPaise(taxDiff)) }));
    } else {
      matched.push(d);
    }
  }
  const missingInBooks = twoBInPeriod.filter((d) => !bookKeys.has(`${sellerKey(d)}|${normInvNo(d.number)}`)).map((d) => rowOf(d));

  res.json({
    estimated: false,
    period, periods,
    matched: matched.length,
    missingIn2B: missingIn2B.slice(0, 100),
    missingInBooks: missingInBooks.slice(0, 100),
    mismatched: mismatched.slice(0, 100),
    // ITC at risk = tax on invoices missing from 2B + the TAX difference on
    // mismatched ones (value differences are not ITC)
    itcAtRisk: money(fromPaise(missingIn2B.reduce((s, r) => s + toPaise(r.tax), 0n) + mismatched.reduce((s, r) => s + toPaise(r.taxDifference), 0n))),
    note: "Matched on supplier GSTIN + invoice number from your imported GSTR-2B.",
  });
}));

// GET /compliance/rule37 — invoices unpaid long enough that claimed ITC must
// be reversed (180 days) or is about to be (150+ days).
router.get("/rule37", handle(async (req, res) => {
  const { books, paidFor, supplierOf } = await loadComplianceBase(req, { payments: false });
  const now = today();
  const items = books.map((d) => {
    const itc = toPaise(taxOf(d));
    const grand = toPaise(grandOf(d));
    const paid = paidFor.get(d.id) || 0n;
    const outstanding = grand - paid;
    const waiting = days(d.date, now);
    if (itc <= 0n || outstanding <= 0n || waiting <= 150) return null;
    const reversed = !!d.gst?.itcReversed;
    const daysPast = waiting - 180;
    const sup = supplierOf(d);
    // Rule 37 reverses ITC proportionate to the unpaid part of the invoice
    const itcOnUnpaid = grand > 0n ? (itc * outstanding) / grand : itc;
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierEmail: firstEmail(sup),
      daysWaiting: waiting, daysToBreach: Math.max(0, 180 - waiting),
      state: reversed ? "reversed" : waiting > 180 ? "breached" : "approaching",
      itc: money(fromPaise(itc)), itcOnUnpaid: money(fromPaise(itcOnUnpaid)),
      paidSoFar: money(fromPaise(paid)), outstanding: money(fromPaise(outstanding)),
      interestEstimate: !reversed && daysPast > 0 ? money(mulRate(fromPaise(itcOnUnpaid), (0.18 * daysPast / 365).toFixed(8))) : null,
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
      itcAtRisk: money(fromPaise(items.filter((r) => r.state !== "reversed").reduce((s, r) => s + toPaise(r.itcOnUnpaid), 0n))),
      interestAccruing: money(fromPaise(items.reduce((s, r) => s + toPaise(r.interestEstimate), 0n))),
    },
    note: `Rule 37: ITC on the unpaid part of an invoice still unpaid 180 days after the invoice date is added back to output tax, with interest. Mark a reversal after you post it in GSTR-3B. ${SCREENING_NOTE}`,
  });
}));

// GET /compliance/tds — payments needing a TDS decision (194Q goods above
// ₹50 lakh/FY per supplier; 194C contracts above ₹30k single / ₹1L FY),
// plus recorded and waived decisions. Estimates exclude GST.
router.get("/tds", handle(async (req, res) => {
  const base = await loadComplianceBase(req);
  const { f, payments } = base;
  const fy = req.query.fy && /^\d{4}-\d{2}$/.test(String(req.query.fy)) ? String(req.query.fy) : fyOf(new Date());
  const [tdsDocs, entity] = await Promise.all([
    Document.find({ ...f, type: "TDS_ENTRY", status: { $nin: ["draft", "cancelled"] } }, { id: 1, date: 1, payment: 1 }).lean(),
    req.query.entityId ? Entity.findOne({ id: String(req.query.entityId), groupId: req.scope.groupId }, { aatoBand: 1 }).lean() : null,
  ]);
  const { screens, keyOf, buyer194Q } = tdsScreen(base, entity, fy);

  const rows = [];
  for (const p of payments) {
    const amount = toPaise(p.payment?.amount);
    const tds = p.payment?.tds || {};
    const screen = screens.get(keyOf(p)) || null;
    const rowBase = {
      documentId: p.id, payment: p.number ?? p.externalRef ?? p.id, date: p.date, utr: p.payment?.utr ?? null,
      supplier: screen?.supplier ?? p.seller?.name ?? "Counterparty", amount: money(fromPaise(amount)),
    };
    if (isPositive(tds.amount)) {
      rows.push({ ...rowBase, status: "recorded", section: tds.section || null, tdsAmount: money(tds.amount), note: `TDS recorded under section ${tds.section || "—"}` });
    } else if (tds.notApplicable) {
      rows.push({ ...rowBase, status: "waived", note: tds.note ? `Marked N/A — ${tds.note}` : "Marked as not applicable" });
    } else if ((p.fy || fyOf(p.date)) === fy && screen?.section === "194Q") {
      rows.push({ ...rowBase, status: "check", section: "194Q", fyPaidToSupplier: money(screen.goodsPurchasesFy), fyPurchasesExGst: money(screen.goodsPurchasesFy), tdsEstimate: money(screen.tdsEstimate), estimate: screen.estimate, buyer194Q,
        note: buyer194Q === "not_applicable" ? "Purchases from this supplier exceed ₹50 lakh this FY, but your entity's turnover band is under ₹10 crore — 194Q does not apply to you" : `${screen.basis}${buyer194Q === "unknown" ? " — applies only if your turnover exceeded ₹10 crore last FY (set the entity's turnover band)" : ""}` });
    } else if ((p.fy || fyOf(p.date)) === fy && screen?.section === "194C") {
      rows.push({ ...rowBase, status: "check", section: "194C", fyPaidToSupplier: money(screen.servicePurchasesFy), estimate: screen.estimate, note: screen.basis });
    }
  }
  rows.sort((a, b) => (a.status === "check" ? 0 : 1) - (b.status === "check" ? 0 : 1) || toNumber(b.amount) - toNumber(a.amount));

  const recorded = tdsDocs.map((d) => ({
    documentId: d.id, section: d.payment?.tds?.section || "—", amount: money(d.payment?.tds?.amount),
    rate: d.payment?.tds?.rate ?? null, date: d.date,
    paymentId: d.payment?.allocations?.[0]?.documentId ?? null,
    note: d.payment?.tds?.note ?? null,
  }));

  res.json({
    items: rows.slice(0, 150),
    recorded,
    fy,
    suppliers: [...screens.values()].filter((s) => s.section).slice(0, 100),
    summary: {
      paymentsScanned: payments.length,
      needsDecision: rows.filter((r) => r.status === "check").length,
      recorded: rows.filter((r) => r.status === "recorded").length,
      waived: rows.filter((r) => r.status === "waived").length,
      tdsDeducted: money(fromPaise(tdsDocs.reduce((s, d) => s + toPaise(d.payment?.tds?.amount), 0n))),
    },
    note: `194Q: 0.1% on purchase value excluding GST above ₹50 lakh per supplier per FY, only for buyers with turnover above ₹10 crore. 194C: contract payments above ₹30,000 single or ₹1 lakh in the FY. TDS is never computed on GST. ${SCREENING_NOTE}`,
  });
}));

// GET /compliance/eway — e-invoice IRN and e-way bill coverage on purchases.
// E-invoicing depends on the SUPPLIER's aggregate turnover (≥ ₹5 crore), not
// on the invoice value: suppliers with a recorded band below ₹5 cr are
// exempt, unknown bands are reported as "unknown" — never flagged as missing.
router.get("/eway", handle(async (req, res) => {
  const { books, supplierOf } = await loadComplianceBase(req, { payments: false });
  const goodsDoc = (d) => !(d.lines?.length && d.lines.every((l) => String(l.hsn || "").startsWith("99")));
  const einvoiceStatusOf = (sup) => {
    if (sup?.einvoiceApplicable === true) return "applicable";
    if (sup?.einvoiceApplicable === false) return "exempt";
    if (sup?.aatoBand === "<5cr") return "exempt";
    if (sup?.aatoBand === "5-10cr" || sup?.aatoBand === ">=10cr") return "applicable";
    return "unknown";
  };
  const rowOf = (d) => {
    const sup = supplierOf(d);
    return {
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", supplierEmail: firstEmail(sup),
      amount: money(grandOf(d)), irn: d.gst?.irn ?? null, ewb: ewayOf(d), ewayBillNo: ewayOf(d),
      supplierEinvoice: einvoiceStatusOf(sup),
    };
  };

  const withIrn = books.filter((d) => d.gst?.irn);
  const noIrn = books.filter((d) => !d.gst?.irn && d.gst?.irnStatus !== "not_applicable");
  const irnChecks = noIrn.filter((d) => einvoiceStatusOf(supplierOf(d)) === "applicable")
    .map((d) => ({ ...rowOf(d), reason: "Supplier's turnover is in the e-invoicing band (₹5 crore+) but this invoice has no IRN — without it the invoice is not valid for your input tax credit." }))
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount));
  const irnUnknown = noIrn.filter((d) => einvoiceStatusOf(supplierOf(d)) === "unknown");
  const irnWaived = books.filter((d) => d.gst?.irnStatus === "not_applicable").length;

  const withEwb = books.filter((d) => ewayOf(d));
  const ewbChecks = books
    .filter((d) => !ewayOf(d) && d.gst?.ewbStatus !== "not_required" && goodsDoc(d) && toPaise(grandOf(d)) > toPaise("50000"))
    .map((d) => ({ ...rowOf(d), reason: "Goods consignment over ₹50,000 needs an e-way bill for the movement — confirm the supplier or transporter generated one." }))
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount));
  const ewbWaived = books.filter((d) => d.gst?.ewbStatus === "not_required").length;

  res.json({
    einvoice: {
      withIrn: withIrn.length, waived: irnWaived, checks: irnChecks.slice(0, 100),
      unknown: irnUnknown.length,
      unknownItems: irnUnknown.slice(0, 50).map((d) => ({ ...rowOf(d), reason: "Supplier turnover band not recorded — e-invoice applicability unknown. Record the supplier's turnover band to check." })),
      pct: books.length ? Number(((withIrn.length / books.length) * 100).toFixed(1)) : 0,
    },
    eway: {
      withEwb: withEwb.length, waived: ewbWaived, checks: ewbChecks.slice(0, 100),
      goodsInvoices: books.filter(goodsDoc).length,
    },
    note: `E-invoicing applies to suppliers whose aggregate turnover is ₹5 crore or more, whatever the invoice value. IRN/e-way details recorded here are supplier-supplied values — Satya does not verify them against the GST portal. ${SCREENING_NOTE}`,
  });
}));

// GET /compliance/lut — Letter of Undertaking coverage per entity + outbound
// supplies billed without IGST that rely on a valid LUT.
router.get("/lut", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const [entities, outward] = await Promise.all([
    Entity.find({ id: f.entityId, groupId: req.scope.groupId }).lean(),
    Document.find({ ...f, type: "INVOICE_OUT", status: { $nin: ["draft", "cancelled", "reversed"] } }, { id: 1, number: 1, externalRef: 1, date: 1, totals: 1, lines: 1, charges: 1, buyer: 1, entityId: 1 }).lean(),
  ]);
  const now = today();
  const rows = entities.map((e) => {
    const luts = (e.lut || []).map((l) => {
      const left = days(now, l.validTo);
      return { arn: l.arn, fy: l.fy, validFrom: l.validFrom, validTo: l.validTo, daysLeft: left, status: left < 0 ? "expired" : left <= 30 ? "expiring" : "active" };
    }).sort((a, b) => String(b.validTo || "").localeCompare(String(a.validTo || "")));
    const active = luts.find((l) => l.status === "active" || l.status === "expiring");
    return { entityId: e.id, code: e.code, legalName: e.legalName, status: active ? active.status : "none", currentArn: active?.arn ?? null, validTo: active?.validTo ?? null, luts };
  });
  const exportInvoices = outward
    .filter((d) => !isPositive(d.totals?.igst))
    .map((d) => ({
      documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, date: d.date,
      buyer: d.buyer?.name ?? "Buyer", amount: money(grandOf(d)),
      covered: entities.some((e) => e.id === d.entityId && (e.lut || []).some((l) => l.validFrom <= d.date && d.date <= l.validTo)),
    }));
  res.json({
    entities: rows,
    exportInvoices,
    summary: { entities: rows.length, covered: rows.filter((r) => r.status === "active" || r.status === "expiring").length, uncoveredExports: exportInvoices.filter((d) => !d.covered).length },
    note: "A LUT is filed per entity per financial year (GST RFD-11). Export/SEZ supplies without IGST are only valid while a LUT covers the invoice date.",
  });
}));

// ---------- write actions ----------

// POST /compliance/itc-reversal {documentId, reversed, note?}
router.post("/itc-reversal", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { documentId, reversed, note } = req.body || {};
  if (!documentId || typeof reversed !== "boolean") throw fail(422, "VALIDATION_FAILED", "documentId and reversed (true/false) are required");
  const doc = await loadScopedDoc(req, documentId);
  canEdit(req, doc.entityId);
  // Mixed schema type: build a new object and assign it whole.
  const gst = { ...(doc.gst || {}) };
  if (reversed) gst.itcReversed = { at: new Date().toISOString(), by: actorOf(req), amount: taxOf(doc), note: note ? String(note).slice(0, 300) : undefined };
  else delete gst.itcReversed;
  doc.gst = gst;
  doc.revision += 1;
  await doc.save();
  res.json({ documentId: doc.id, itcReversed: doc.gst.itcReversed ?? null, revision: doc.revision });
}));

// POST /compliance/gst-meta {documentId, irn?, ewb?|ewayBillNo?, irnStatus?, ewbStatus?, note?}
// The e-way bill number is stored as gst.ewayBillNo (the engine contract
// field); "ewb" is accepted as an input alias and echoed for older clients.
router.post("/gst-meta", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { documentId, irn, irnStatus, ewbStatus, note } = req.body || {};
  const ewbInput = req.body?.ewayBillNo !== undefined ? req.body.ewayBillNo : req.body?.ewb;
  if (!documentId) throw fail(422, "VALIDATION_FAILED", "documentId is required");
  const doc = await loadScopedDoc(req, documentId);
  canEdit(req, doc.entityId);
  const gst = { ...(doc.gst || {}) };
  if (irn !== undefined) {
    const v = String(irn ?? "").trim();
    if (v && !/^[0-9a-f]{64}$/i.test(v)) throw fail(422, "VALIDATION_FAILED", "IRN is a 64-character code — check the value", { fields: ["irn"] });
    if (v) { gst.irn = v.toLowerCase(); delete gst.irnStatus; } else delete gst.irn;
  }
  if (ewbInput !== undefined) {
    const v = String(ewbInput ?? "").trim().replace(/\s/g, "");
    if (v && !/^\d{12}$/.test(v)) throw fail(422, "VALIDATION_FAILED", "E-way bill number is 12 digits", { fields: ["ewb"] });
    delete gst.ewb;
    if (v) { gst.ewayBillNo = v; delete gst.ewbStatus; } else delete gst.ewayBillNo;
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
  res.json({ documentId: doc.id, gst: { ...doc.gst, ...(doc.gst.ewayBillNo ? { ewb: doc.gst.ewayBillNo } : {}) }, revision: doc.revision });
}));

// POST /compliance/lut {entityId, arn, fy, validFrom, validTo, remove?}
router.post("/lut", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { entityId, arn, fy, validFrom, validTo, remove } = req.body || {};
  if (!entityId || !arn) throw fail(422, "VALIDATION_FAILED", "entityId and arn are required");
  const entity = await Entity.findOne({ id: String(entityId), groupId: req.scope.groupId });
  if (!entity || !req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
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
  const paymentData = { ...(payment.payment || {}) };

  if (action === "waive") {
    paymentData.tds = { notApplicable: true, note: note ? String(note).slice(0, 300) : undefined, by: actor, at: new Date().toISOString() };
    payment.payment = paymentData;
    payment.revision += 1;
    await payment.save();
    return res.json({ paymentId: payment.id, tds: paymentData.tds });
  }

  const amountText = String(amount ?? "").trim();
  if (!section || !/^\d{1,13}(\.\d{1,2})?$/.test(amountText) || !isPositive(amountText)) throw fail(422, "VALIDATION_FAILED", "section and a positive amount (max 2 decimals) are required to record TDS");
  if (toPaise(amountText) > toPaise(paymentData.amount)) throw fail(422, "VALIDATION_FAILED", "TDS cannot exceed the payment amount");
  const amountStr = toDecimal(amountText);
  const externalRef = `tds:${payment.id}:${section}`;
  let entry = await Document.findOne({ groupId: req.scope.groupId, externalRef });
  if (!entry) {
    entry = await Document.create({
      id: newId("doc"), groupId: req.scope.groupId, entityId: payment.entityId,
      type: "TDS_ENTRY", number: `TDS/${fyOf(payment.date)}/${payment.number || payment.id.slice(-6)}`,
      externalRef, date: today(), fy: fyOf(today()), status: "posted", revision: 0,
      seller: payment.seller, buyer: payment.buyer, supplierId: payment.supplierId,
      currency: payment.currency || "INR", lines: [],
      payment: { amount: amountStr, tdsAmount: amountStr, tds: { section: String(section), rate: rate ? String(rate) : undefined, amount: amountStr, note: note ? String(note).slice(0, 300) : undefined }, allocations: [{ documentId: payment.id, amount: amountStr, basis: "reviewer" }] },
      source: { channel: "api", sourceSystem: "compliance" }, provenance: "USER_PROVIDED",
      observedAt: new Date().toISOString(), createdBy: actor,
    });
    await DocumentLink.create({
      id: newId("lnk"), groupId: req.scope.groupId,
      fromId: entry.id, toId: payment.id, kind: "ADJUSTS",
      certainty: "CONFIRMED", basis: "reviewer", createdBy: actor,
    });
  } else {
    entry.payment = { ...entry.payment, amount: amountStr, tdsAmount: amountStr, tds: { ...(entry.payment?.tds || {}), section: String(section), rate: rate ? String(rate) : undefined, amount: amountStr, note: note ? String(note).slice(0, 300) : undefined } };
    entry.revision += 1;
    await entry.save();
  }
  paymentData.tds = { section: String(section), rate: rate ? String(rate) : undefined, amount: amountStr, entryId: entry.id, note: note ? String(note).slice(0, 300) : undefined, by: actor, at: new Date().toISOString() };
  payment.payment = paymentData;
  payment.revision += 1;
  await payment.save();
  res.status(201).json({ paymentId: payment.id, tds: paymentData.tds, tdsEntryId: entry.id });
}));

export default router;
