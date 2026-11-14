import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Decision from "../../models/Decision.js";
import { enginePost } from "../../services/engine.js";
import { writeAudit } from "../../services/audit.js";
import { settledPaiseFor, PAYMENT_TYPES } from "../../services/settlement.js";
import { enqueue } from "../../jobs/runner.js";
import { newId } from "../../lib/ids.js";
import { toPaise, toPaiseOrNull, fromPaise, grandOf, allocatedOf } from "../../lib/money.js";
import { sodDeny } from "../../auth/sod.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const rolesOn = (scope, entityId) => [...new Set([...(scope.rolesByEntity["*"] || []), ...(scope.rolesByEntity[entityId] || [])])];

// allocation status from the payment doc's recorded splits (exact paise).
const allocStatus = (doc) => {
  const amount = toPaise(doc.payment?.amount);
  const allocated = toPaise(allocatedOf(doc));
  if (amount > 0n && allocated === amount) return "allocated";
  if (allocated > 0n) return "partial";
  return doc.payment?.utr ? "unallocated" : "needs_evidence"; // no UTR = can't match to a bank transfer at all
};

const LIST_FIELDS = { id: 1, type: 1, number: 1, date: 1, payment: 1, seller: 1, buyer: 1, provenance: 1, status: 1, externalRef: 1, entityId: 1 };

// GET /payments — worklist of PAYMENT/ADVANCE docs in the entities the user
// can see, with derived allocation state. Page-based pagination + search +
// sort; status is derived, so a bounded projected slice is computed then paged.
router.get("/", handle(async (req, res) => {
  const { status, q, entityId } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
  const filter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds }, type: { $in: PAYMENT_TYPES } };
  if (entityId) {
    if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    filter.entityId = String(entityId);
  }
  if (q && String(q).trim()) {
    const rx = { $regex: String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ "payment.utr": rx }, { "seller.name": rx }, { number: rx }, { "seller.gstin": rx }, { externalRef: rx }];
  }
  const sorts = { date_asc: { date: 1, id: -1 }, amount_desc: { "payment.amount": -1 }, amount_asc: { "payment.amount": 1 } };
  const sort = sorts[req.query.sort] || { date: -1, id: -1 };
  const docs = await Document.find(filter, LIST_FIELDS).sort(sort).limit(500).lean();
  const all = docs.map((d) => ({
    id: d.id, type: d.type, number: d.number || null, date: d.date,
    amount: d.payment?.amount ?? null, utr: d.payment?.utr || null,
    mode: d.payment?.mode || null, valueDate: d.payment?.valueDate || null,
    bankAccountMasked: d.payment?.bankAccountMasked || null,
    counterparty: d.seller?.name || d.buyer?.name || null,
    counterpartyGstin: d.seller?.gstin || null,
    supplierId: d.seller?.supplierId || null,
    status: allocStatus(d),
    allocatedTotal: allocatedOf(d),
    allocations: (d.payment?.allocations || []).map((a) => ({ documentId: a.documentId, amount: a.amount, basis: a.basis })),
    provenance: d.provenance, statusDoc: d.status,
  }));
  const filtered = status ? all.filter((i) => i.status === status) : all;
  const start = (page - 1) * pageSize;
  res.json({ items: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) });
}));

const loadPayment = async (req, id) => {
  const doc = await Document.findOne({ groupId: req.scope.groupId, id });
  if (!doc || !req.scope.entityIds.includes(doc.entityId)) throw fail(404, "NOT_FOUND", "Payment not found");
  if (!PAYMENT_TYPES.includes(doc.type)) throw fail(422, "VALIDATION_FAILED", `${id} is a ${doc.type}, not a payment`);
  return doc;
};

// open (not fully settled) INVOICE_IN/OUT in the same entity + unapplied
// credit notes, ranked so the engine's subset-sum cap (20 items, invoices +
// credits together) gets the likeliest matches: same counterparty first, then
// closest open amount. limit=Infinity returns every open target (validation).
const openTargets = async (req, payment, limit = 20) => {
  const direction = payment.type.endsWith("IN") ? "INVOICE_OUT" : "INVOICE_IN";
  const [invoices, credits] = await Promise.all([
    Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: direction, status: { $in: ["issued", "posted"] } },
      { id: 1, number: 1, date: 1, totals: 1, lines: 1, charges: 1, seller: 1, terms: 1 }).lean(),
    Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: { $in: ["CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"] }, status: { $in: ["issued", "posted"] } },
      { id: 1, date: 1, totals: 1 }).lean(),
  ]);
  const settled = await settledPaiseFor(req.scope.groupId, invoices.map((i) => i.id));
  const applied = new Set((await DocumentLink.find({ groupId: req.scope.groupId, kind: "SETTLES", fromId: { $in: credits.map((c) => c.id) } }, { fromId: 1 }).lean()).map((l) => l.fromId));
  const creditList = credits.filter((c) => !applied.has(c.id))
    .map((c) => ({ id: c.id, amount: grandOf(c), date: c.date }))
    .filter((c) => toPaise(c.amount) > 0n)
    .slice(0, 10);
  const payAmount = toPaise(payment.payment?.amount);
  const cp = (payment.seller?.gstin || payment.seller?.supplierId || payment.seller?.name || "").toLowerCase();
  const open = invoices.map((inv) => {
    const openPaise = toPaise(grandOf(inv)) - (settled.get(inv.id) || 0n);
    if (openPaise <= 0n) return null;
    const sellerKey = (inv.seller?.gstin || inv.seller?.supplierId || inv.seller?.name || "").toLowerCase();
    const gap = openPaise > payAmount ? openPaise - payAmount : payAmount - openPaise;
    return {
      id: inv.id, number: inv.number, date: inv.date, openAmount: fromPaise(openPaise),
      seller: inv.seller?.name, dueDate: inv.terms?.dueDate || null,
      _same: cp && sellerKey === cp ? 0 : 1, _gap: gap,
    };
  }).filter(Boolean)
    .sort((a, b) => a._same - b._same || (a._gap < b._gap ? -1 : a._gap > b._gap ? 1 : 0))
    .slice(0, Number.isFinite(limit) ? Math.max(0, limit - creditList.length) : undefined)
    .map(({ _same, _gap, ...rest }) => rest);
  return { openInvoices: open, credits: creditList };
};

// GET /payments/:id/allocate — engine subset-sum suggestions over open
// invoices+credits for the same entity (04 P2-B6 workbench). Suggestions are
// advisory: an engine outage returns suggestion:null + suggestionError.
router.get("/:id/allocate", handle(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const targets = await openTargets(req, payment);
  const remaining = fromPaise(toPaise(payment.payment?.amount) - toPaise(allocatedOf(payment)));
  let suggestion = null;
  let suggestionError;
  if ((targets.openInvoices.length || targets.credits.length) && toPaise(remaining) > 0n) {
    try {
      suggestion = await enginePost("/v2/allocate/payment", {
        payment: { id: payment.id, amount: { amount: remaining, currency: payment.currency || "INR" }, date: payment.date, utr: payment.payment?.utr },
        openInvoices: targets.openInvoices.map(({ id, number, date, openAmount, dueDate }) => ({ id, number, date, openAmount: { amount: openAmount, currency: "INR" }, dueDate })),
        credits: targets.credits.map((c) => ({ id: c.id, amount: { amount: c.amount, currency: "INR" }, date: c.date })),
      });
    } catch (error) {
      suggestionError = { code: error.code || "UPSTREAM_UNAVAILABLE", message: error.message };
    }
  }
  res.json({
    payment: { id: payment.id, amount: payment.payment?.amount, utr: payment.payment?.utr, remaining, revision: payment.revision },
    openInvoices: targets.openInvoices, credits: targets.credits,
    suggestion,
    ...(suggestionError ? { suggestionError } : {}),
  });
}));

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;
const ALLOCATE_PERMS = ["finding.decide", "payment.release.maker", "payment.release.checker", "import.data"];

// POST /payments/:id/allocate — {allocations:[{documentId,amount}], reason,
// expectedRevision?}. Exact-paise guards: each amount > 0 with ≤ 2 decimals;
// per-target total ≤ that target's open amount; request total ≤ payment's
// unallocated amount. Writes allocations atomically (revision-guarded),
// cumulative SETTLES links, a decision, an audit row, and re-reconciles.
router.post("/:id/allocate", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { allocations = [], reason, expectedRevision } = req.body || {};
  if (!Array.isArray(allocations) || !allocations.length || allocations.length > 50) throw fail(422, "VALIDATION_FAILED", "allocations[] (1–50 rows) required");
  if (!reason || String(reason).trim().length < 5) throw fail(422, "VALIDATION_FAILED", "Give a reason for the allocation");
  const payment = await loadPayment(req, req.params.id);
  if (!ALLOCATE_PERMS.some((p) => scopeAllows(req.scope, p, payment.entityId))) {
    throw fail(403, "FORBIDDEN", "Your role cannot allocate payments", { reason: `Requires one of ${ALLOCATE_PERMS.join(", ")}` });
  }
  if (expectedRevision !== undefined && payment.revision !== expectedRevision)
    throw fail(409, "CONFLICT", `Stale document — revision is ${payment.revision}`, { expectedRevision: payment.revision });
  // Maker–checker applies to payments a person recorded in the app — not to
  // bank-imported lines or demo constructions (no human "maker" act exists).
  const humanRecorded = payment.source?.channel === "created_in_satya" || payment.provenance === "USER_PROVIDED";
  if (humanRecorded && payment.createdBy === actor(req))
    return sodDeny(res, "You recorded this payment — a colleague must allocate it", req.id);

  const perTarget = new Map();
  for (const a of allocations) {
    const documentId = typeof a?.documentId === "string" ? a.documentId : null;
    const text = typeof a?.amount === "number" ? String(a.amount) : typeof a?.amount === "string" ? a.amount.trim() : "";
    if (!documentId) throw fail(422, "VALIDATION_FAILED", "Every allocation needs a documentId");
    if (!AMOUNT_RE.test(text)) throw fail(422, "VALIDATION_FAILED", `Allocation amount for ${documentId} must be a positive amount with at most 2 decimals`);
    const paise = toPaiseOrNull(text);
    if (!paise || paise <= 0n) throw fail(422, "VALIDATION_FAILED", `Allocation amount for ${documentId} must be positive`);
    perTarget.set(documentId, (perTarget.get(documentId) || 0n) + paise);
  }
  const totalPaise = [...perTarget.values()].reduce((s, v) => s + v, 0n);
  const remainingPaise = toPaise(payment.payment?.amount) - toPaise(allocatedOf(payment));
  if (totalPaise > remainingPaise) {
    throw fail(422, "VALIDATION_FAILED", `Allocations total ₹${fromPaise(totalPaise)} exceeds the unallocated ₹${fromPaise(remainingPaise < 0n ? 0n : remainingPaise)}`);
  }
  const targets = await openTargets(req, payment, Infinity);
  const valid = new Map([...targets.openInvoices.map((i) => [i.id, i.openAmount]), ...targets.credits.map((c) => [c.id, c.amount])]);
  for (const [documentId, paise] of perTarget) {
    if (!valid.has(documentId)) throw fail(404, "NOT_FOUND", `${documentId} is not an open invoice/credit in this entity`);
    const cap = toPaise(valid.get(documentId));
    if (paise > cap) throw fail(422, "VALIDATION_FAILED", `₹${fromPaise(paise)} exceeds the open amount of ${documentId} (₹${fromPaise(cap)})`);
  }

  const newRows = [...perTarget].map(([documentId, paise]) => ({ documentId, amount: fromPaise(paise), basis: "reviewer" }));
  // `payment` is a Mixed path: pushing into the hydrated doc was never marked
  // modified (allocations silently didn't persist). Write atomically with an
  // optimistic revision guard instead.
  const updated = await Document.findOneAndUpdate(
    { _id: payment._id, revision: payment.revision },
    { $set: { "payment.allocations": [...(payment.payment?.allocations || []), ...newRows] }, $inc: { revision: 1 } },
    { new: true },
  ).lean();
  if (!updated) throw fail(409, "CONFLICT", "This payment changed while you were allocating — reload and try again");

  // SETTLES link per (payment, target) carries the cumulative amount
  for (const row of newRows) {
    const existing = await DocumentLink.findOne({ groupId: req.scope.groupId, fromId: payment.id, toId: row.documentId, kind: "SETTLES" }).lean();
    if (existing) {
      await DocumentLink.updateOne({ _id: existing._id }, { $set: { amount: { amount: fromPaise(toPaise(existing.amount) + toPaise(row.amount)), currency: "INR" }, basis: "reviewer" } });
    } else {
      await DocumentLink.create({ id: newId("lnk"), groupId: req.scope.groupId, fromId: payment.id, toId: row.documentId, kind: "SETTLES", certainty: "CONFIRMED", basis: "reviewer", amount: { amount: row.amount, currency: "INR" }, createdBy: actor(req) });
    }
  }

  const role = rolesOn(req.scope, payment.entityId)[0];
  await Decision.create({
    id: newId("dec"), groupId: req.scope.groupId, caseId: payment.caseId || `case_${payment.id}`,
    action: "APPROVE", scope: `allocated ₹${fromPaise(totalPaise)} across ${newRows.length} document(s)`, reason, actor: actor(req), actorRole: role, expectedRevision,
    review: { kind: "allocate_payment", allocations: newRows },
  });
  await writeAudit({
    groupId: req.scope.groupId, entityId: payment.entityId, actor: actor(req), actorRole: role,
    action: `payments.allocate:${payment.id}`,
    target: { type: "document", id: payment.id, allocations: newRows, reason: String(reason).slice(0, 300) },
    statusCode: 200, ip: req.ip,
  });
  if (payment.caseId) await enqueue("reconcile", { caseId: payment.caseId }, req.scope.groupId).catch(() => {});
  res.json({ paymentId: payment.id, allocatedTotal: allocatedOf(updated), status: allocStatus(updated), revision: updated.revision });
}));

export default router;
