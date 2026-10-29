import express from "express";
import Case from "../../models/Case.js";
import Snapshot from "../../models/Snapshot.js";
import Finding from "../../models/Finding.js";
import Decision from "../../models/Decision.js";
import Document from "../../models/Document.js";
import { newId } from "../../lib/ids.js";
import { scopeAllows } from "../../auth/rbac.js";
import { enqueue } from "../../jobs/runner.js";
import { caseGraph } from "../../services/graphProjection.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const loadCase = async (req) => {
  const kase = await Case.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!kase || (!req.scope.wildcard && !req.scope.entityIds.includes(kase.entityId))) throw fail(404, "NOT_FOUND", "Case not found");
  return kase;
};

router.get("/", handle(async (req, res) => {
  const filter = { groupId: req.scope.groupId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.entityId) filter.entityId = req.query.entityId;
  const items = await Case.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ items, nextCursor: null });
}));

router.get("/:id", handle(async (req, res) => {
  const kase = await loadCase(req);
  const snapFilter = { caseId: kase.id, groupId: kase.groupId };
  if (req.query.snapshot) snapFilter.id = req.query.snapshot;
  const snapshot = req.query.snapshot
    ? await Snapshot.findOne(snapFilter).lean()
    : await Snapshot.findOne({ caseId: kase.id, scenario: false }).sort({ createdAt: -1 }).lean();
  const findings = await Finding.find({ caseId: kase.id }).lean();
  const decisions = await Decision.find({ caseId: kase.id }).sort({ createdAt: -1 }).lean();
  const documents = await Document.find({ groupId: kase.groupId, id: { $in: kase.subjectIds } }).lean();
  res.json({ ...kase.toObject(), snapshot: snapshot?.result || null, snapshotId: snapshot?.id || null, findings, decisions, documents });
}));

// GET /cases/:id/graph — Neo4j first, snapshot.graph fallback (never blocks).
router.get("/:id/graph", handle(async (req, res) => {
  const kase = await loadCase(req);
  const snapshot = await Snapshot.findOne({ caseId: kase.id, scenario: false }).sort({ createdAt: -1 }).lean();
  try {
    const g = await caseGraph(kase.groupId, snapshot?.id);
    return res.json({ ...g, snapshotId: snapshot?.id || null });
  } catch {
    if (snapshot?.result?.graph) return res.json({ ...snapshot.result.graph, source: "snapshot", snapshotId: snapshot.id });
    throw fail(503, "UPSTREAM_UNAVAILABLE", "Graph store unavailable", { service: "neo4j", retryAfterMs: 15000 });
  }
}));

router.post("/:id/reconcile", handle(async (req, res) => {
  const kase = await loadCase(req);
  const job = await enqueue("reconcile", { caseId: kase.id, knowledgeTime: req.body?.knowledgeTime, reviews: req.body?.reviews }, req.scope.groupId);
  res.status(202).json({ job: { id: job.id, status: job.status } });
}));

// What-if preview: engine runs with scenario changes; snapshot kept but
// never promoted to latest (02 §5.5).
router.post("/:id/scenarios", handle(async (req, res) => {
  assertPlainInput(req.body);
  const kase = await loadCase(req);
  if (!Array.isArray(req.body?.changes)) throw fail(422, "VALIDATION_FAILED", "changes[] required");
  const job = await enqueue("reconcile", { caseId: kase.id, scenario: { changes: req.body.changes } }, req.scope.groupId);
  res.status(202).json({ job: { id: job.id, status: job.status } });
}));

// GET /cases/:id/evidence-pack — single JSON bundle: snapshot, findings,
// decisions, subject docs, links, audit slice (04 P3-B9).
router.get("/:id/evidence-pack", handle(async (req, res) => {
  const kase = await loadCase(req);
  const { default: Audit } = await import("../../models/Audit.js");
  const { default: DocumentLink } = await import("../../models/DocumentLink.js");
  const snapshot = await Snapshot.findOne({ caseId: kase.id, scenario: false }).sort({ createdAt: -1 }).lean();
  const [findings, decisions, documents, audit] = await Promise.all([
    Finding.find({ caseId: kase.id }).lean(),
    Decision.find({ caseId: kase.id }).sort({ createdAt: -1 }).lean(),
    Document.find({ groupId: kase.groupId, id: { $in: kase.subjectIds } }).lean(),
    Audit.find({ groupId: kase.groupId, action: { $regex: kase.id } }).sort({ createdAt: 1 }).limit(100).lean(),
  ]);
  const docIds = documents.map((d) => d.id);
  const links = await DocumentLink.find({ groupId: kase.groupId, $or: [{ fromId: { $in: docIds } }, { toId: { $in: docIds } }] }).lean();
  res.json({
    packVersion: "1", generatedAt: new Date().toISOString(), case: kase,
    snapshot: snapshot?.result || null, findings, decisions, documents, links, auditTrail: audit,
    note: "Supplied tax and e-invoice fields are not independently verified against government systems.",
  });
}));

router.post("/:id/decisions", handle(async (req, res) => {
  const kase = await loadCase(req);
  if (!scopeAllows(req.scope, "finding.decide", kase.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot decide findings", { reason: "Requires finding.decide" });
  if (req.body?.expectedRevision !== undefined && req.body.expectedRevision !== kase.revision) {
    throw fail(409, "STALE_REVISION", "This case changed since you loaded it", { currentRevision: kase.revision });
  }
  if (req.body?.snapshotId && kase.latestSnapshotId && req.body.snapshotId !== kase.latestSnapshotId) {
    throw fail(409, "STALE_REVISION", "A newer snapshot exists — review it before deciding", { latestSnapshotId: kase.latestSnapshotId });
  }
  const { action, findingId, scope, reason, review } = req.body || {};
  if (!action) throw fail(422, "VALIDATION_FAILED", "action is required");
  // SoD: cannot decide a finding on a document you created
  if (findingId) {
    const finding = await Finding.findOne({ id: findingId, caseId: kase.id }).lean();
    const docIds = finding?.data?.documentIds || [];
    if (docIds.length) {
      const mine = await Document.exists({ id: { $in: docIds }, createdBy: actor(req) });
      if (mine) return res.status(403).json({ error: { code: "SOD_VIOLATION", message: "You cannot decide a finding on a document you created", requestId: req.id } });
    }
  }
  const decision = await Decision.create({
    id: newId("dec"), groupId: kase.groupId, caseId: kase.id,
    snapshotId: kase.latestSnapshotId, findingId, action, scope, reason, review,
    actor: actor(req), actorRole: [...(req.scope.rolesByEntity["*"] || []), ...(req.scope.rolesByEntity[kase.entityId] || [])][0],
    expectedRevision: req.body?.expectedRevision,
  });
  if (findingId) await Finding.updateOne({ id: findingId }, { $set: { status: action === "APPROVE" ? "resolved" : action === "PLACE_ON_HOLD" ? "accepted_risk" : "open" } });
  const job = await enqueue("reconcile", { caseId: kase.id, reviews: review ? { [review.kind || "manual"]: review } : {} }, req.scope.groupId);
  res.status(201).json({ decision, job: { id: job.id, status: job.status } });
}));

export default router;
