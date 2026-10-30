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

// GET /cases — investigation worklist with per-case stats so the UI can show
// finding counts, top severity and open value before you ever open a case.
// page/pageSize/q/status/kind params give numbered pagination + search.
router.get("/", handle(async (req, res) => {
  const { status, kind } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
  const filter = { groupId: req.scope.groupId };
  if (status) filter.status = status;
  if (kind) filter.kind = kind;
  if (req.query.entityId) filter.entityId = req.query.entityId;
  if (req.query.q && String(req.query.q).trim()) {
    const rx = { $regex: String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ id: rx }, { title: rx }, { subjectIds: rx }];
  }
  const cases = await Case.find(filter).sort({ updatedAt: -1 }).limit(500).lean();
  if (!cases.length) return res.json({ items: [], total: 0, page, pageSize, pages: 0 });

  const ids = cases.map((c) => c.id);
  // findings per case (severity counts) + latest live snapshot per case
  const [findingAgg, snapshots] = await Promise.all([
    Finding.aggregate([
      { $match: { groupId: req.scope.groupId, caseId: { $in: ids } } },
      { $group: {
        _id: "$caseId",
        findings: { $sum: 1 },
        critical: { $sum: { $cond: [{ $eq: ["$severity", "critical"] }, 1, 0] } },
        high: { $sum: { $cond: [{ $eq: ["$severity", "high"] }, 1, 0] } },
        medium: { $sum: { $cond: [{ $eq: ["$severity", "medium"] }, 1, 0] } },
        low: { $sum: { $cond: [{ $eq: ["$severity", "low"] }, 1, 0] } },
      } },
    ]),
    Snapshot.find({ caseId: { $in: ids }, scenario: false }).sort({ createdAt: -1 }).lean(),
  ]);
  const stats = new Map(findingAgg.map((f) => [f._id, f]));
  const latestSnap = new Map();
  for (const s of snapshots) if (!latestSnap.has(s.caseId)) latestSnap.set(s.caseId, s);

  const sevRank = (f) => (f?.critical ? 4 : f?.high ? 3 : f?.medium ? 2 : f?.low ? 1 : 0);
  const items = cases.map((c) => {
    const f = stats.get(c.id);
    const snap = latestSnap.get(c.id);
    const balances = snap?.result?.balances || snap?.result?.ledger?.balances;
    return {
      id: c.id, title: c.title, kind: c.kind, status: c.status, entityId: c.entityId,
      subjectIds: c.subjectIds, revision: c.revision, createdAt: c.createdAt, updatedAt: c.updatedAt,
      reconciled: !!snap, lastReconciledAt: snap?.createdAt || null, snapshotId: snap?.id || null,
      findings: f?.findings || 0,
      severity: { critical: f?.critical || 0, high: f?.high || 0, medium: f?.medium || 0, low: f?.low || 0 },
      topSeverity: sevRank(f) >= 4 ? "critical" : sevRank(f) === 3 ? "high" : sevRank(f) === 2 ? "medium" : sevRank(f) === 1 ? "low" : null,
      openValue: balances?.recordedPayable || balances?.canonicalOutstanding || null,
      disputedValue: balances?.disputedExposure || null,
      recommendation: snap?.result?.recommendation?.action || null,
    };
  });
  const start = (page - 1) * pageSize;
  res.json({ items: items.slice(start, start + pageSize), total: items.length, page, pageSize, pages: Math.max(1, Math.ceil(items.length / pageSize)) });
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
