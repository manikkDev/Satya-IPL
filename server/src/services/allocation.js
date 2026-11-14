// Payment allocation helpers shared by the payments workbench and the bank
// statement import: open targets for a payment, engine suggestions, and the
// strict automatic allocation rule.
//
// Automatic allocation happens ONLY when all of these hold:
//   * the payment's counterparty resolved to one supplier;
//   * the bank narration (or payment ref) names exactly one of that
//     supplier's open purchase invoices by its number;
//   * the payment amount equals that invoice's open amount to the paisa —
//     either gross, or net of the supplier's configured TDS section
//     (TDS on the taxable value, rounded to the rupee per s.288B);
//   * no other open invoice of the supplier satisfies the same test.
// It is recorded as a system decision (actor satya:auto-allocate) with an
// audit row; everything else is left for review with the suggestions.
import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Decision from "../models/Decision.js";
import Supplier from "../models/Supplier.js";
import { enginePost } from "./engine.js";
import { writeAudit } from "./audit.js";
import { settledPaiseFor } from "./settlement.js";
import { newId } from "../lib/ids.js";
import { toPaise, fromPaise, grandOf, taxableOf, allocatedOf } from "../lib/money.js";

export const SYSTEM_ALLOCATOR = "satya:auto-allocate";

/**
 * Open (not fully settled) invoices in the payment's entity + unapplied
 * credit notes, ranked: same counterparty first, then closest open amount.
 * limit caps the combined list (the engine's subset-sum handles ≤ 20).
 */
export const openTargetsFor = async (groupId, payment, limit = 20, { sameCounterpartyOnly = false } = {}) => {
  const direction = payment.type.endsWith("IN") ? "INVOICE_OUT" : "INVOICE_IN";
  const [invoices, credits] = await Promise.all([
    Document.find({ groupId, entityId: payment.entityId, type: direction, status: { $in: ["issued", "posted"] } },
      { id: 1, number: 1, date: 1, totals: 1, lines: 1, charges: 1, seller: 1, supplierId: 1, terms: 1 }).lean(),
    Document.find({ groupId, entityId: payment.entityId, type: { $in: ["CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"] }, status: { $in: ["issued", "posted"] } },
      { id: 1, date: 1, totals: 1 }).lean(),
  ]);
  const settled = await settledPaiseFor(groupId, invoices.map((i) => i.id));
  const applied = new Set((await DocumentLink.find({ groupId, kind: "SETTLES", fromId: { $in: credits.map((c) => c.id) } }, { fromId: 1 }).lean()).map((l) => l.fromId));
  const creditList = credits.filter((c) => !applied.has(c.id))
    .map((c) => ({ id: c.id, amount: grandOf(c), date: c.date }))
    .filter((c) => toPaise(c.amount) > 0n)
    .slice(0, 10);
  const payAmount = toPaise(payment.payment?.amount);
  const cpKeys = new Set([payment.seller?.gstin, payment.seller?.supplierId, payment.supplierId, payment.seller?.name].filter(Boolean).map((s) => String(s).toLowerCase()));
  const open = invoices.map((inv) => {
    const openPaise = toPaise(grandOf(inv)) - (settled.get(inv.id) || 0n);
    if (openPaise <= 0n) return null;
    const keys = [inv.seller?.gstin, inv.seller?.supplierId, inv.supplierId, inv.seller?.name].filter(Boolean).map((s) => String(s).toLowerCase());
    const same = keys.some((k) => cpKeys.has(k));
    if (sameCounterpartyOnly && !same) return null;
    const gap = openPaise > payAmount ? openPaise - payAmount : payAmount - openPaise;
    return {
      id: inv.id, number: inv.number, date: inv.date, openAmount: fromPaise(openPaise),
      taxable: taxableOf(inv), grand: grandOf(inv),
      seller: inv.seller?.name, supplierId: inv.supplierId || inv.seller?.supplierId || null, dueDate: inv.terms?.dueDate || null,
      _same: same ? 0 : 1, _gap: gap,
    };
  }).filter(Boolean)
    .sort((a, b) => a._same - b._same || (a._gap < b._gap ? -1 : a._gap > b._gap ? 1 : 0));
  const sliced = Number.isFinite(limit) ? open.slice(0, Math.max(0, limit - creditList.length)) : open;
  return { openInvoices: sliced.map(({ _same, _gap, ...rest }) => rest), credits: creditList };
};

// TDS on payment to residents (screening defaults; supplier.tdsSection opts in)
const TDS_RATES = { "194Q": "0.1", "194C": null, "194J": "10", "194JA": "2", "194JB": "10", "194H": "2", "194I": "10", "194IA": "1", "194IB": "2", "194O": "0.1" };
export const tdsRateFor = (supplier) => {
  const section = String(supplier?.tdsSection || "").toUpperCase();
  if (!section) return null;
  if (section === "194C") {
    const holder = String(supplier?.pan || supplier?.gstins?.[0]?.gstin?.slice(2, 12) || "")[3];
    return { section, rate: holder === "P" || holder === "H" ? "1" : "2" };
  }
  return TDS_RATES[section] ? { section, rate: TDS_RATES[section] } : null;
};
/** TDS on a taxable value, rounded to the nearest rupee (s.288B). */
export const tdsOn = (taxable, rate) => {
  const paise = toPaise(taxable) * BigInt(Math.round(Number(rate) * 1000)) / 100000n;
  return ((paise + 50n) / 100n) * 100n;
};

/**
 * The strict auto-allocation test. Returns {invoice, amount, tds?, rule} for a
 * unique exact match, or {reason} explaining why it goes to review.
 */
export const exactMatch = ({ payment, supplier, openInvoices, narration }) => {
  if (!supplier) return { reason: "counterparty not resolved to a supplier" };
  const hay = String(narration || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!hay) return { reason: "no narration to read an invoice reference from" };
  const mine = openInvoices.filter((i) => i.supplierId === supplier.id);
  const referenced = mine.filter((i) => {
    const key = String(i.number || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return key.length >= 4 && hay.includes(key);
  });
  if (!referenced.length) return { reason: "narration names none of the supplier's open invoices" };
  const amount = toPaise(payment.payment?.amount);
  const tds = tdsRateFor(supplier);
  const hits = [];
  for (const inv of referenced) {
    const open = toPaise(inv.openAmount);
    if (open === amount) hits.push({ invoice: inv, amount: fromPaise(amount), rule: "exact_gross" });
    else if (tds) {
      const t = tdsOn(inv.taxable, tds.rate);
      if (t > 0n && open - t === amount) hits.push({ invoice: inv, amount: fromPaise(amount), tds: { section: tds.section, rate: tds.rate, amount: fromPaise(t) }, rule: "exact_net_of_tds" });
    }
  }
  if (hits.length !== 1) return { reason: hits.length ? `${hits.length} referenced invoices match the amount — ambiguous` : "amount differs from the referenced invoice's open amount" };
  return hits[0];
};

/** Engine subset-sum suggestion (advisory; never throws). */
export const engineSuggestion = async (payment, targets, supplier) => {
  const remaining = fromPaise(toPaise(payment.payment?.amount) - toPaise(allocatedOf(payment)));
  if (!(targets.openInvoices.length || targets.credits.length) || toPaise(remaining) <= 0n) return { suggestion: null };
  const tds = tdsRateFor(supplier);
  try {
    const suggestion = await enginePost("/v2/allocate/payment", {
      payment: { id: payment.id, amount: { amount: remaining, currency: payment.currency || "INR" }, date: payment.date, utr: payment.payment?.utr },
      openInvoices: targets.openInvoices.slice(0, 20 - Math.min(targets.credits.length, 10)).map(({ id, number, date, openAmount, dueDate }) => ({ id, number, date, openAmount: { amount: openAmount, currency: "INR" }, dueDate })),
      credits: targets.credits.map((c) => ({ id: c.id, amount: { amount: c.amount, currency: "INR" }, date: c.date })),
      ...(tds ? { tdsPolicy: { deductOnPayment: true, rate: tds.rate } } : {}),
    });
    return { suggestion };
  } catch (error) {
    return { suggestion: null, error: { code: error.code || "UPSTREAM_UNAVAILABLE", message: error.message } };
  }
};

/** Write a system allocation: allocations + SETTLES link + decision + audit. */
export const applySystemAllocation = async ({ payment, match, caseId, narration }) => {
  const row = { documentId: match.invoice.id, amount: match.amount, basis: "reference" };
  const payUpdate = { "payment.allocations": [...(payment.payment?.allocations || []), row] };
  if (match.tds) { payUpdate["payment.tds"] = { ...match.tds, basis: "auto_detected" }; payUpdate["payment.tdsAmount"] = match.tds.amount; }
  const updated = await Document.findOneAndUpdate(
    { groupId: payment.groupId, id: payment.id, revision: payment.revision ?? 0 },
    { $set: payUpdate, $inc: { revision: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) return null;
  await DocumentLink.updateOne(
    { groupId: payment.groupId, fromId: payment.id, toId: row.documentId, kind: "SETTLES" },
    { $setOnInsert: { id: newId("lnk"), groupId: payment.groupId, fromId: payment.id, toId: row.documentId, kind: "SETTLES", certainty: "CONFIRMED", basis: "rule", amount: { amount: row.amount, currency: "INR" }, createdBy: SYSTEM_ALLOCATOR } },
    { upsert: true },
  );
  const reason = `Automatic: bank narration names invoice ${match.invoice.number} and the amount ₹${match.amount} equals its open amount${match.tds ? ` net of TDS ₹${match.tds.amount} (${match.tds.section} @ ${match.tds.rate}%) — record the TDS entry` : ""}. Unique match.`;
  await Decision.create({
    id: newId("dec"), groupId: payment.groupId, caseId: caseId || `case_${payment.id}`,
    action: "APPROVE", scope: `allocated ₹${match.amount} to ${match.invoice.number}`, reason,
    actor: SYSTEM_ALLOCATOR, actorRole: "system",
    review: { kind: "allocate_payment", auto: true, rule: match.rule, allocations: [row], ...(match.tds ? { tds: match.tds } : {}), narration: String(narration || "").slice(0, 200) },
  });
  await writeAudit({
    groupId: payment.groupId, entityId: payment.entityId, actor: SYSTEM_ALLOCATOR, actorRole: "system",
    action: `payments.auto_allocate:${payment.id}`,
    target: { type: "document", id: payment.id, allocations: [row], rule: match.rule, reason },
    statusCode: 200,
  });
  return updated;
};

/**
 * For each new payment: resolve supplier, fetch engine suggestions, apply the
 * strict rule, record the outcome on payment.source.review. Bounded work per
 * call (batch of payments, ≤ 20 candidates each).
 */
export const processNewPayments = async ({ groupId, paymentIds, autoAllocate = true, caseFor = async () => null }) => {
  const out = { autoAllocated: 0, suggested: 0, review: 0, engineUnavailable: 0, details: [] };
  for (const id of paymentIds) {
    const payment = await Document.findOne({ groupId, id, type: "PAYMENT_OUT" }).lean();
    if (!payment || toPaise(allocatedOf(payment)) > 0n) continue;
    const supplier = payment.supplierId ? await Supplier.findOne({ groupId, id: payment.supplierId }, { id: 1, legalName: 1, tdsSection: 1, pan: 1, gstins: 1 }).lean() : null;
    const targets = await openTargetsFor(groupId, payment, 20);
    const narration = [payment.source?.narration, payment.number, payment.payment?.utr].filter(Boolean).join(" ");
    const all = supplier ? await openTargetsFor(groupId, payment, Infinity, { sameCounterpartyOnly: true }) : { openInvoices: [] };
    const match = autoAllocate ? exactMatch({ payment, supplier, openInvoices: all.openInvoices, narration }) : { reason: "automatic allocation is switched off" };
    const { suggestion, error } = await engineSuggestion(payment, targets, supplier);
    if (error) out.engineUnavailable++;
    const solutions = suggestion?.solutions?.length || 0;
    if (match.invoice) {
      const caseId = await caseFor(match.invoice.id);
      const applied = await applySystemAllocation({ payment, match, caseId, narration });
      if (applied) {
        out.autoAllocated++;
        await Document.updateOne({ groupId, id }, { $set: { "source.review": { status: "auto_allocated", rule: match.rule, invoiceId: match.invoice.id, at: new Date().toISOString() } } });
        out.details.push({ paymentId: id, status: "auto_allocated", invoice: match.invoice.number, amount: match.amount, rule: match.rule });
        continue;
      }
    }
    if (solutions) out.suggested++;
    out.review++;
    const review = {
      status: "needs_review", reason: match.reason || "not allocated",
      suggestions: (suggestion?.solutions || []).slice(0, 3).map((s) => ({ allocations: (s.allocations || []).map((a) => ({ documentId: a.documentId, amount: a.amount?.amount ?? a.amount })), residual: s.residual?.amount ?? null })),
      certainty: suggestion?.certainty || null, engineError: error?.message || null, at: new Date().toISOString(),
    };
    await Document.updateOne({ groupId, id }, { $set: { "source.review": review } });
    out.details.push({ paymentId: id, status: "needs_review", reason: review.reason, suggestions: review.suggestions.length });
  }
  return out;
};
