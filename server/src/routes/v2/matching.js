import express from "express";
import Document from "../../models/Document.js";
import LinkSuggestion from "../../models/LinkSuggestion.js";
import Decision from "../../models/Decision.js";
import { autoLink, decideSuggestion, casesTouching, supplierDuplicates } from "../../services/matching.js";
import { writeAudit } from "../../services/audit.js";
import { enqueue } from "../../jobs/runner.js";
import { scopeAllows } from "../../auth/rbac.js";
import { newId } from "../../lib/ids.js";
import { fail, handle, assertPlainInput } from "./util.js";

// Mounted at /api/v2/matching (session + group scope required).
//   GET  /suggestions?status=pending|auto_linked|accepted|rejected&kind=&limit=&cursor=
//   POST /suggestions/:id/accept {reason?}   -> CONFIRMED reviewer link, label 1
//   POST /suggestions/:id/reject {reason?}   -> removes a model link, label 0
//   POST /run {documentIds?}                 -> run autoLink on demand
//   GET  /supplier-duplicates                -> Fellegi–Sunter clusters with reasons
//   GET  /labels                             -> reviewer verdicts (training labels)
const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const DECIDE = ["finding.decide", "import.data", "doc.upload"];
const STATUSES = ["pending", "auto_linked", "accepted", "rejected", "superseded"];
const KINDS = ["BILLS", "RECEIVES", "SETTLES"];

const summary = (d) => d && {
  id: d.id, type: d.type, number: d.number || null, date: d.date, status: d.status,
  party: d.seller?.name || null, gstin: d.seller?.gstin || null,
  amount: d.type?.startsWith("PAYMENT") ? d.payment?.amount ?? null : d.totals?.grand ?? null,
  lines: (d.lines || []).length,
};

const view = (s, docs) => ({
  id: s.id, fromId: s.fromId, toId: s.toId, kind: s.kind, score: Number(s.score), zone: s.zone, status: s.status,
  reasons: s.reasons, explanation: s.explanation, lineRefs: s.lineRefs, amount: s.amount ?? null,
  modelVersion: s.modelVersion, label: s.label, decidedBy: s.decidedBy || null, decidedAt: s.decidedAt || null,
  createdAt: s.createdAt, from: summary(docs.get(s.fromId)) || null, to: summary(docs.get(s.toId)) || null,
});

const visible = (req, s, docs) => {
  const from = docs.get(s.fromId);
  return !from || req.scope.entityIds.includes(from.entityId);
};

router.get("/suggestions", handle(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : "pending";
  if (!STATUSES.includes(status)) throw fail(422, "VALIDATION_FAILED", `status must be one of ${STATUSES.join(", ")}`);
  const filter = { groupId: req.scope.groupId, status };
  if (req.query.kind) {
    if (!KINDS.includes(String(req.query.kind))) throw fail(422, "VALIDATION_FAILED", `kind must be one of ${KINDS.join(", ")}`);
    filter.kind = String(req.query.kind);
  }
  if (req.query.documentId) filter.$or = [{ fromId: String(req.query.documentId) }, { toId: String(req.query.documentId) }];
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const items = await LinkSuggestion.find(filter).sort({ score: -1, createdAt: -1 }).limit(limit).lean();
  const ids = [...new Set(items.flatMap((s) => [s.fromId, s.toId]))];
  const docs = new Map((await Document.find({ groupId: req.scope.groupId, id: { $in: ids } },
    { id: 1, type: 1, number: 1, date: 1, status: 1, seller: 1, totals: 1, payment: 1, lines: 1, entityId: 1 }).lean()).map((d) => [d.id, d]));
  const counts = Object.fromEntries((await LinkSuggestion.aggregate([
    { $match: { groupId: req.scope.groupId } }, { $group: { _id: "$status", n: { $sum: 1 } } },
  ])).map((c) => [c._id, c.n]));
  res.json({ items: items.filter((s) => visible(req, s, docs)).map((s) => view(s, docs)), counts });
}));

const decide = (verdict) => handle(async (req, res) => {
  assertPlainInput(req.body || {});
  const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : undefined;
  const suggestion = await LinkSuggestion.findOne({ groupId: req.scope.groupId, id: req.params.id });
  if (!suggestion) throw fail(404, "NOT_FOUND", "Suggestion not found");
  const from = await Document.findOne({ groupId: req.scope.groupId, id: suggestion.fromId }, { entityId: 1, caseId: 1 }).lean();
  if (from && !req.scope.entityIds.includes(from.entityId)) throw fail(404, "NOT_FOUND", "Suggestion not found");
  if (!DECIDE.some((p) => scopeAllows(req.scope, p, from?.entityId))) {
    throw fail(403, "FORBIDDEN", "Your role cannot rule on link suggestions", { reason: `Requires one of ${DECIDE.join(", ")}` });
  }
  if (!["pending", "auto_linked"].includes(suggestion.status)) {
    throw fail(409, "CONFLICT", `Suggestion is already ${suggestion.status}`);
  }
  const [caseId] = await casesTouching(req.scope.groupId, [suggestion.fromId, suggestion.toId]);
  const decisionId = newId("dec");
  await Decision.create({
    id: decisionId, groupId: req.scope.groupId, caseId: caseId || `case_${suggestion.toId}`,
    action: verdict === "accept" ? "APPROVE" : "REQUEST_CLARIFICATION",
    scope: `${verdict} ${suggestion.kind} link ${suggestion.fromId} → ${suggestion.toId}`,
    reason: reason || (verdict === "accept" ? "Reviewer confirmed the suggested link" : "Reviewer rejected the suggested link"),
    actor: actor(req), review: { kind: "link_documents", suggestionId: suggestion.id, verdict, modelVersion: suggestion.modelVersion, score: suggestion.score },
  });
  const result = await decideSuggestion({ groupId: req.scope.groupId, suggestion, verdict, actor: actor(req), reason, decisionId });
  await writeAudit({
    groupId: req.scope.groupId, entityId: from?.entityId, actor: actor(req),
    action: `matching.${verdict}:${suggestion.id}`,
    target: { type: "link_suggestion", id: suggestion.id, fromId: suggestion.fromId, toId: suggestion.toId, kind: suggestion.kind },
    statusCode: 200, ip: req.ip,
  });
  const cases = await casesTouching(req.scope.groupId, [suggestion.fromId, suggestion.toId]);
  await Promise.all(cases.map((id) => enqueue("reconcile", { caseId: id }, req.scope.groupId).catch(() => null)));
  res.json({ id: suggestion.id, ...result, decisionId, reconcileQueued: cases });
});

router.post("/suggestions/:id/accept", decide("accept"));
router.post("/suggestions/:id/reject", decide("reject"));

router.post("/run", handle(async (req, res) => {
  assertPlainInput(req.body || {});
  if (!DECIDE.some((p) => scopeAllows(req.scope, p))) throw fail(403, "FORBIDDEN", "Your role cannot run linking");
  const documentIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds.map(String).slice(0, 2000) : [];
  if (documentIds.length) {
    const own = await Document.find({ groupId: req.scope.groupId, id: { $in: documentIds }, entityId: { $in: req.scope.entityIds } }, { id: 1 }).lean();
    if (own.length !== new Set(documentIds).size) throw fail(404, "NOT_FOUND", "Some documents were not found");
  }
  res.json(await autoLink({ groupId: req.scope.groupId, documentIds }));
}));

router.get("/supplier-duplicates", handle(async (req, res) => {
  res.json(await supplierDuplicates({ groupId: req.scope.groupId }));
}));

router.get("/labels", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "audit.read") && !scopeAllows(req.scope, "finding.decide")) throw fail(403, "FORBIDDEN", "Not allowed");
  const items = await LinkSuggestion.find({ groupId: req.scope.groupId, label: { $in: [0, 1] } },
    { _id: 0, fromId: 1, toId: 1, kind: 1, label: 1, score: 1, modelVersion: 1, decidedAt: 1 }).sort({ decidedAt: -1 }).limit(5000).lean();
  res.json({ items, note: "Reviewer verdicts on model link suggestions — training labels for re-calibration on this tenant" });
}));

export default router;
