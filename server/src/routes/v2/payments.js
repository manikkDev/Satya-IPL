import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Decision from "../../models/Decision.js";
import { enginePost } from "../../services/engine.js";
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
// state. Page-based pagination + free-text search + sort for the workbench UI.
// Status is derived, so we fetch the sorted slice (bounded), compute, filter,
// then page — fine at demo scale.
router.get("/", handle(async (req, res) => {
  const entityId = req.query.entityId || req.scope.activeEntityId;
  const { status, q } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
  const filter = { groupId: req.scope.groupId, type: { $in: ["PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT", "ADVANCE_IN"] } };
  if (entityId && scopeAllows(req.scope, "reports.view", entityId)) filter.entityId = entityId;
  if (q && String(q).trim()) {
    const rx = { $regex: String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ "payment.utr": rx }, { "seller.name": rx }, { number: rx }, { "seller.gstin": rx }, { externalRef: rx }];
  }
  const sorts = { date_asc: { date: 1, id: -1 }, amount_desc: { "payment.amount": -1 }, amount_asc: { "payment.amount": 1 } };
  const sort = sorts[req.query.sort] || { date: -1, id: -1 };
  // bounded fetch for in-memory status filter + paging (allocation status is derived).
  const docs = await Document.find(filter).sort(sort).limit(500).lean();
  const all = docs.map((d) => ({
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
  }));
  const filtered = status ? all.filter((i) => i.status === status) : all;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  res.json({ items, total: filtered.length, page, pageSize, pages: Math.max(1, Math.ceil(filtered.length / pageSize)) });
}));

const loadPayment = async (req, id) => {
  const doc = await Document.findOne({ groupId: req.scope.groupId, id });
  if (!doc) throw fail(404, "NOT_FOUND", "Payment not found");
  if (!String(doc.type).startsWith("PAYMENT") && !String(doc.type).startsWith("ADVANCE"))
    throw fail(422, "VALIDATION_FAILED", `${id} is a ${doc.type}, not a payment`);
  return doc;
};

// open (not fully settled) INVOICE_IN/OUT in the same entity + unapplied credit
// notes, ranked so the engine's 20-candidate subset-sum cap gets the likeliest
// matches: same counterparty first, then closest open amount to the payment.
const openTargets = async (req, payment, limit = 20) => {
  const direction = payment.type.endsWith("IN") ? "INVOICE_OUT" : "INVOICE_IN";
  const invoices = await Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: direction, status: { $in: ["issued", "posted"] } }).lean();
  const settles = await DocumentLink.find({ groupId: req.scope.groupId, kind: "SETTLES" }).lean();
  const settledAmt = {};
  for (const l of settles) settledAmt[l.toId] = (settledAmt[l.toId] || 0) + Number(l.amount?.amount || l.amount || 0);
  const payAmount = Number(payment.payment?.amount || 0);
  const cp = (payment.seller?.gstin || payment.seller?.supplierId || payment.seller?.name || "").toLowerCase();
  const open = invoices.map((inv) => {
    const grand = Number(inv.totals?.grand || 0);
    const open = Math.max(0, grand - (settledAmt[inv.id] || 0));
    if (open <= 0.005) return null;
    const sellerKey = (inv.seller?.gstin || inv.seller?.supplierId || inv.seller?.name || "").toLowerCase();
    const sameCounterparty = cp && sellerKey === cp;
    return {
      id: inv.id, number: inv.number, date: inv.date, openAmount: open.toFixed(2),
      seller: inv.seller?.name, dueDate: inv.terms?.dueDate || null,
      _score: (sameCounterparty ? 0 : 1) * 1e12 + Math.abs(open - payAmount),
    };
  }).filter(Boolean).sort((a, b) => a._score - b._score).slice(0, limit)
    .map(({ _score, ...rest }) => rest);
  const credits = await Document.find({ groupId: req.scope.groupId, entityId: payment.entityId, type: { $in: ["CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"] }, status: { $in: ["issued", "posted"] } }).lean();
  const applied = new Set(settles.map((l) => l.fromId));
  return {
    openInvoices: open,
    credits: credits.filter((c) => !applied.has(c.id)).map((c) => ({ id: c.id, amount: c.totals?.grand || "0", date: c.date })).slice(0, 10),
  };
};

// GET /payments/:id/allocate — engine subset-sum suggestions over open
// invoices+credits for the same entity (04 P2-B6 workbench).
router.get("/:id/allocate", handle(async (req, res) => {
  const payment = await loadPayment(req, req.params.id);
  const targets = await openTargets(req, payment);
  const suggestion = await enginePost("/v2/allocate/payment", {
    payment: { id: payment.id, amount: { amount: payment.payment?.amount || "0", currency: payment.currency || "INR" }, date: payment.date, utr: payment.payment?.utr },
    openInvoices: targets.openInvoices.map(({ id, number, date, openAmount, dueDate }) => ({ id, number, date, openAmount: { amount: openAmount, currency: "INR" }, dueDate })),
    credits: targets.credits.map((c) => ({ id: c.id, amount: { amount: c.amount, currency: "INR" }, date: c.date })),
  });
  const remaining = dec(payment.payment?.amount || 0, (payment.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0));
  res.json({
    payment: { id: payment.id, amount: payment.payment?.amount, utr: payment.payment?.utr, remaining },
    openInvoices: targets.openInvoices, credits: targets.credits,
    suggestion: suggestion || null,
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
  // Maker–checker applies to payments a person recorded in the app — not to
  // bank-imported lines or demo constructions (no human "maker" act exists).
  const humanRecorded = payment.source?.channel === "created_in_satya" || payment.provenance === "USER_PROVIDED";
  if (humanRecorded && payment.createdBy === actor(req))
    return sodDeny(res, "You recorded this payment — a colleague must allocate it", req.id);

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
