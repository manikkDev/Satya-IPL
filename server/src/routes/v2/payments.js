import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Decision from "../../models/Decision.js";
import { engineFetch } from "../../services/engine.js";
import { writeAudit } from "../../services/audit.js";
import { enqueue } from "../../jobs/runner.js";
import { newId } from "../../lib/ids.js";
import { sodDeny } from "../../auth/sod.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const dec = (a, b) => (Number(a) - Number(b)).toFixed(2);

// allocation status from the payment doc's recorded splits.
const allocStatus = (doc) => {
  const amount = Number(doc.payment?.amount || 0);
  const allocated = (doc.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0);
  if (allocated >= amount - 0.005 && allocated <= amount + 0.005) return "allocated";
  if (allocated > 0) return "partial";
  return doc.payment?.utr ? "unallocated" : "needs_evidence"; // no UTR = can't match to a bank transfer at all
};

// GET /payments — worklist: every PAYMENT_OUT/IN with computed allocation
// state, latest-first, cursor paginated.
router.get("/", handle(async (req, res) => {
  const entityId = req.query.entityId || req.scope.activeEntityId;
  const { cursor, limit = "50", status } = req.query;
  const filter = { groupId: req.scope.groupId, type: { $in: ["PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT", "ADVANCE_IN"] } };
  if (entityId && scopeAllows(req.scope, "reports.view", entityId)) filter.entityId = entityId;
  if (cursor) filter.id = { $lt: cursor };
  const docs = await Document.find(filter).sort({ date: -1, id: -1 }).limit(Number(limit) + 1).lean();
  const items = docs.slice(0, Number(limit)).map((d) => ({
    id: d.id, type: d.type, number: d.number || null, date: d.date,
    amount: d.payment?.amount || null, utr: d.payment?.utr || null,
    mode: d.payment?.mode || null, valueDate: d.payment?.valueDate || null,
    bankAccountMasked: d.payment?.bankAccountMasked || null,
    counterparty: d.seller?.name || d.buyer?.name || null,
    counterpartyGstin: d.seller?.gstin || null,
    supplierId: d.seller?.supplierId || null,
    status: allocStatus(d),
    allocatedTotal: (d.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0).toFixed(2),
    allocations: (d.payment?.allocations || []).map((a) => ({ documentId: a.documentId, amount: a.amount, basis: a.basis })),
    provenance: d.provenance, statusDoc: d.status,
  })).filter((i) => !status || i.status === status);
  res.json({ items, nextCursor: docs.length > Number(limit) ? items[items.length - 1]?.id : undefined });
}));

const loadPayment = async (req, id) => {
  const doc = await Document.findOne({ groupId: req.scope.groupId, id });
  if (!doc) throw fail(404, "NOT_FOUND", "Payment not found");
  if (!String(doc.type).startsWith("PAYMENT") && !String(doc.type).startsWith("ADVANCE"))
    throw fail(422, "VALIDATION_FAILED", `${id} is a ${doc.type}, not a payment`);
  return doc;
};

// open (not fully settled) INVOICE_IN/OUT in the same entity + unapplied credit notes.
const openTargets = async (req, payment) => {
  const direction = payment.type.endsWith("IN") ? "INVOICE_OUT" : "INVOICE_IN";
  const invoices = await Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: direction, status: { $in: ["issued", "posted"] } }).lean();
  const settles = await DocumentLink.find({ groupId: req.scope.groupId, kind: "SETTLES" }).lean();
  const settledAmt = {};
  for (const l of settles) settledAmt[l.toId] = (settledAmt[l.toId] || 0) + Number(l.amount?.amount || l.amount || 0);
  const open = invoices.map((inv) => {
    const grand = Number(inv.totals?.grand || 0);
    const open = Math.max(0, grand - (settledAmt[inv.id] || 0));
    return open > 0.005 ? { id: inv.id, number: inv.number, date: inv.date, openAmount: open.toFixed(2), seller: inv.seller?.name, dueDate: inv.terms?.dueDate || null } : null;
  }).filter(Boolean);
  const credits = await Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: { $in: ["CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"] }, status: { $in: ["issued", "posted"] } }).lean();
  const applied = new Set(settles.map((l) => l.fromId));
  return {
    openInvoices: open,
    credits: credits.filter((c) => !applied.has(c.id)).map((c) => ({ id: c.id, amount: c.totals?.grand || "0", date: c.date })),
  };
};

// GET /payments/:id/allocate — engine subset-sum suggestions over open
// invoices+credits for the same entity (04 P2-B6 workbench).
router.get("/:id/allocate", handle(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const targets = await openTargets(req, payment);
  const suggestion = await engineFetch("/v2/allocate/payment", {
    method: "POST",
    body: JSON.stringify({
      payment: { id: payment.id, amount: payment.payment?.amount || "0", date: payment.date, utr: payment.payment?.utr, tdsAmount: payment.payment?.tdsAmount },
      openInvoices: targets.openInvoices.map(({ id, number, date, openAmount, dueDate }) => ({ id, number, date, openAmount, dueDate })),
      credits: targets.credits,
    }),
  });
  const remaining = dec(payment.payment?.amount || 0, (payment.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0));
  res.json({
    payment: { id: payment.id, amount: payment.payment?.amount, utr: payment.payment?.utr, remaining },
    openInvoices: targets.openInvoices, credits: targets.credits,
    suggestion: suggestion.body || null,
  });
}));

// POST /payments/:id/allocate — reviewer confirms splits: {allocations:[{documentId,amount}],
// reason?, expectedRevision}. Writes allocations + SETTLES links + decision +
// re-reconcile. SoD: creator can't allocate their own payment.
router.post("/:id/allocate", handle(async (req, res) => {
  assertPlainInput(req.body);
  const { allocations = [], reason, expectedRevision } = req.body;
  if (!Array.isArray(allocations) || !allocations.length) throw fail(422, "VALIDATION_FAILED", "allocations[] required");
  if (!reason || String(reason).trim().length < 5) throw fail(422, "VALIDATION_FAILED", "Give a reason for the allocation");
  const payment = await loadPayment(req, req.params.id);
  if (expectedRevision !== undefined && payment.revision !== expectedRevision)
    throw fail(409, "CONFLICT", `Stale document — revision is ${payment.revision}`, { expectedRevision: payment.revision });
  if (payment.createdBy === actor(req)) return sodDeny(res, "You recorded this payment — a colleague must allocate it", req.id);

  const targets = await openTargets(req, payment);
  const valid = new Map([...targets.openInvoices.map((i) => [i.id, i]), ...targets.credits.map((c) => [c.id, c])]);
  const total = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  const remaining = dec(payment.payment.amount, (payment.payment.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0));
  if (total - Number(remaining) > 0.005) throw fail(422, "VALIDATION_FAILED", `Allocations exceed the unallocated ₹${remaining}`);

  for (const a of allocations) {
    const amt = Number(a.amount);
    if (!(amt > 0)) throw fail(422, "VALIDATION_FAILED", `Allocation amount for ${a.documentId} must be positive`);
    const target = valid.get(a.documentId);
    if (!target) throw fail(404, "NOT_FOUND", `${a.documentId} is not an open invoice/credit in this entity`);
    const cap = Number(target.openAmount ?? target.amount);
    if (amt - cap > 0.005) throw fail(422, "VALIDATION_FAILED", `₹${amt} exceeds the open amount of ${a.documentId} (₹${cap})`);
    payment.payment.allocations.push({ documentId: a.documentId, amount: amt.toFixed(2), basis: "reviewer" });
    await DocumentLink.updateOne(
      { groupId: req.scope.groupId, fromId: payment.id, toId: a.documentId, kind: "SETTLES" },
      { $setOnInsert: { id: newId("lnk"), groupId: req.scope.groupId, fromId: payment.id, toId: a.documentId, kind: "SETTLES", certainty: "CONFIRMED", basis: "reviewer", amount: { amount: amt.toFixed(2) }, createdBy: actor(req) } },
      { upsert: true },
    );
  }
  payment.revision += 1;
  await payment.save();

  await Decision.create({
    id: newId("dec"), groupId: req.scope.groupId, caseId: payment.caseId || `case_${payment.id}`,
    action: "APPROVE", scope: `allocated ₹${total.toFixed(2)} across ${allocations.length} document(s)`, reason, actor: actor(req), actorRole: req.scope.role, expectedRevision,
    review: { kind: "allocate_payment", allocations: allocations.map((a) => ({ documentId: a.documentId, amount: Number(a.amount).toFixed(2), basis: "reviewer" })) },
  });
  await writeAudit({ groupId: req.scope.groupId, actorId: actor(req), action: `payments.allocate:${payment.id}`, objectType: "document", objectId: payment.id, payload: { allocations, reason } });

  if (payment.caseId) await enqueue("reconcile", { caseId: payment.caseId }, req.scope.groupId).catch(() => {});
  res.json({ paymentId: payment.id, allocatedTotal: (payment.payment.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0).toFixed(2), status: allocStatus(payment), revision: payment.revision });
}));

export default router;
