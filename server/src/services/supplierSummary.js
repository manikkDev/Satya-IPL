import Document from "../models/Document.js";
import Finding from "../models/Finding.js";
import { settledPaiseFor, PAYMENT_TYPES } from "./settlement.js";
import { acceptanceDates, msmeCategoryOf, msmeCovered, msmeDeadline } from "./msme.js";
import { money, toPaise, fromPaise, grandOf, mulRate, rawAmount } from "../lib/money.js";
import { daysBetween, todayIst, addDays } from "../lib/fy.js";

const LIVE = { $nin: ["draft", "cancelled", "reversed", "rejected"] };
const FIELDS = { id: 1, type: 1, number: 1, externalRef: 1, date: 1, status: 1, totals: 1, lines: 1, charges: 1, payment: 1, seller: 1, supplierId: 1, terms: 1, entityId: 1, caseId: 1 };
const m = (paise) => money(fromPaise(paise));

/**
 * Supplier 360 (exact paise, entity-scoped).
 *   ordered      PO grand totals (live, issued+)
 *   received     GRN qty × the PO line rate (value of goods received, ex-GST)
 *   invoiced     purchase invoice grand totals (GST incl.)
 *   credited     credit notes against those invoices
 *   paid         outward payments + advances to the supplier
 *   settled      payments/credits applied to invoices
 *   outstanding  invoiced − settled (per invoice, never negative)
 *   unallocated  paid − payments applied to invoices
 *   disputed     ₹ exposure of open findings on the supplier's documents
 */
export const supplierSummary = async (groupId, entityIds, supplier, supplierView = {}) => {
  const gstins = (supplier.gstins || []).map((g) => g.gstin).filter(Boolean);
  const match = { $or: [{ supplierId: supplier.id }, { "seller.supplierId": supplier.id }, ...(gstins.length ? [{ "seller.gstin": { $in: gstins } }] : []), { "seller.name": supplier.legalName }] };
  const docs = await Document.find({ groupId, entityId: { $in: entityIds }, status: LIVE, type: { $in: ["PO", "GRN", "QC", "INVOICE_IN", "CREDIT_NOTE_IN", ...PAYMENT_TYPES] }, ...match }, FIELDS).limit(5000).lean();
  const byType = (t) => docs.filter((d) => (Array.isArray(t) ? t.includes(d.type) : d.type === t));
  const pos = byType("PO").filter((d) => d.status !== "pending_approval" && d.status !== "approved");
  const grns = byType("GRN");
  const invoices = byType("INVOICE_IN");
  const credits = byType("CREDIT_NOTE_IN");
  const payments = byType(["PAYMENT_OUT", "ADVANCE_OUT"]);

  const ordered = pos.reduce((s, d) => s + toPaise(grandOf(d)), 0n);
  const openPo = pos.filter((d) => !["fulfilled", "short_closed"].includes(d.status)).reduce((s, d) => s + toPaise(grandOf(d)), 0n);
  const poRate = new Map();
  for (const p of pos) for (const l of p.lines || []) poRate.set(`${p.id}:${l.lineNo}`, l.rate);
  let received = 0n;
  let receivedQty = 0;
  for (const g of grns) for (const l of g.lines || []) {
    const qty = String(rawAmount(l.qty) ?? "0");
    receivedQty += Number(qty) || 0;
    const rate = poRate.get(`${l.refs?.poId}:${l.refs?.poLineNo ?? l.lineNo}`) ?? l.rate;
    received += toPaise(mulRate(rate, qty));
  }
  const invoiced = invoices.reduce((s, d) => s + toPaise(grandOf(d)), 0n);
  const creditedTotal = credits.reduce((s, d) => s + toPaise(grandOf(d)), 0n);
  const paid = payments.reduce((s, d) => s + toPaise(d.payment?.amount), 0n);
  const settled = await settledPaiseFor(groupId, invoices.map((d) => d.id));

  const today = todayIst();
  const accepted = await acceptanceDates(groupId, invoices);
  const category = msmeCategoryOf(supplier, invoices[0]);
  const aging = { notDue: 0n, "0-30": 0n, "31-60": 0n, "61-90": 0n, "90+": 0n };
  let outstanding = 0n;
  let settledOnInvoices = 0n;
  let creditedOnInvoices = 0n;
  let msmeOverdue = 0n;
  const openInvoices = [];
  for (const inv of invoices) {
    const grand = toPaise(grandOf(inv));
    const s = settled.get(inv.id) || 0n;
    const c = settled.credited.get(inv.id) || 0n;
    settledOnInvoices += s - c;
    creditedOnInvoices += c;
    const open = grand - s > 0n ? grand - s : 0n;
    if (open <= 0n) continue;
    outstanding += open;
    const credit = Number(inv.terms?.creditDays ?? supplier.paymentTermsDays ?? 30);
    const due = addDays(inv.date, Number.isFinite(credit) ? credit : 30);
    const overdueDays = daysBetween(due, today);
    const bucket = overdueDays <= 0 ? "notDue" : overdueDays <= 30 ? "0-30" : overdueDays <= 60 ? "31-60" : overdueDays <= 90 ? "61-90" : "90+";
    aging[bucket] += open;
    let msme = null;
    if (msmeCovered(category)) {
      const dl = msmeDeadline(inv, supplier, accepted.get(inv.id));
      msme = { dueDate: dl.dueDate, daysLeft: dl.daysLeft, clockBasis: dl.clockBasis };
      if (dl.daysLeft < 0) msmeOverdue += open;
    }
    openInvoices.push({ id: inv.id, number: inv.number ?? inv.externalRef ?? inv.id, date: inv.date, dueDate: due, overdueDays: Math.max(0, overdueDays), total: m(grand), settled: m(s), outstanding: m(open), caseId: inv.caseId ?? null, ...(msme ? { msme } : {}), _open: open });
  }
  openInvoices.sort((a, b) => (a._open > b._open ? -1 : a._open < b._open ? 1 : 0));

  // allocated = payment money applied to this supplier's invoices
  const appliedFromPayments = payments.reduce((s, p) => s + (p.payment?.allocations || []).filter((a) => invoices.some((i) => i.id === a.documentId)).reduce((x, a) => x + toPaise(a.amount), 0n), 0n);
  const unallocated = paid - appliedFromPayments > 0n ? paid - appliedFromPayments : 0n;

  const docIds = docs.map((d) => d.id);
  const findings = docIds.length
    ? await Finding.find({ groupId, entityId: { $in: entityIds }, status: "open", "data.evidence.documentId": { $in: docIds } }, { id: 1, code: 1, severity: 1, caseId: 1, "data.amount": 1, "data.message": 1, "data.evidence": 1 }).lean()
    : [];
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  // disputed: per open invoice, the largest open-finding exposure on it,
  // capped at what is still outstanding (findings overlap, so summing every
  // finding amount double-counts the same rupees)
  const exposureByDoc = new Map();
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    const amt = toPaise(f.data?.amount);
    for (const e of f.data?.evidence || []) {
      if (e?.documentId && amt > (exposureByDoc.get(e.documentId) || 0n)) exposureByDoc.set(e.documentId, amt);
    }
  }
  let disputed = 0n;
  for (const inv of openInvoices) {
    const exp = exposureByDoc.get(inv.id) || 0n;
    disputed += exp < inv._open ? exp : inv._open;
  }

  const recentPayments = [...payments].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 5)
    .map((p) => ({ id: p.id, number: p.number ?? p.externalRef ?? p.id, date: p.date, amount: m(toPaise(p.payment?.amount)), utr: p.payment?.utr ?? null, allocations: (p.payment?.allocations || []).map((a) => ({ documentId: a.documentId, amount: a.amount })) }));
  const docNames = new Map(docs.map((d) => [d.id, d.number ?? d.externalRef ?? d.id]));

  return {
    id: supplier.id, supplierId: supplier.id, name: supplier.legalName, legalName: supplier.legalName,
    gstin: supplierView.gstin ?? gstins[0] ?? null, pan: supplier.pan ?? null,
    address: supplierView.address ?? null, contacts: supplier.contacts || [],
    msme: { category, covered: msmeCovered(category), udyamNumber: supplier.udyam?.number ?? null, overdue: m(msmeOverdue) },
    paymentTermsDays: supplier.paymentTermsDays ?? null,
    entityIds,
    ordered: m(ordered), openPoAmount: m(openPo),
    received: m(received), receivedQty: String(receivedQty),
    invoiced: m(invoiced), credited: m(creditedTotal), creditedOnInvoices: m(creditedOnInvoices),
    paid: m(paid), settledOnInvoices: m(settledOnInvoices), unallocatedPayments: m(unallocated),
    outstanding: m(outstanding), disputed: m(disputed),
    undisputedOutstanding: m(outstanding - disputed > 0n ? outstanding - disputed : 0n),
    agedPayables: Object.fromEntries(Object.entries(aging).map(([k, v]) => [k, m(v)])),
    openFindings: { count: findings.length, bySeverity, items: findings.slice(0, 10).map((f) => ({ id: f.id, code: f.code, severity: f.severity, caseId: f.caseId, amount: f.data?.amount ?? null, documentIds: (f.data?.evidence || []).map((e) => e.documentId).filter(Boolean) })) },
    counts: { purchaseOrders: pos.length, receipts: grns.length, invoices: invoices.length, creditNotes: credits.length, payments: payments.length, openInvoices: openInvoices.length },
    openInvoices: openInvoices.slice(0, 10).map(({ _open, ...r }) => r),
    recentPayments,
    documents: [...openInvoices.slice(0, 6).map((i) => ({ id: i.id, number: i.number, type: "INVOICE_IN", role: "open_invoice" })),
      ...recentPayments.slice(0, 3).map((p) => ({ id: p.id, number: p.number, type: "PAYMENT_OUT", role: "payment" }))].map((d) => ({ ...d, number: d.number ?? docNames.get(d.id) })),
    asOf: today,
    note: "Outstanding = invoices less payments and credit notes applied to them. Disputed = exposure of open findings on this supplier's documents.",
  };
};
