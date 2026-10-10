import crypto from "node:crypto";
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { BusinessCase, BusinessRecord, BusinessSnapshot, BusinessJob, BusinessImport, SourceDocument, ImportPreview } from "../models/Business.js";
import { engine, inputFor, queueJob, graphFor } from "../utils/businessService.js";
import { recordAudit } from "../utils/audit.js";
import AuditLog from "../models/AuditLog.js";

const router = express.Router();
const handle = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
const managers = new Set(["ap_manager", "admin"]);
const writers = new Set(["ops_analyst", "ap_manager", "admin"]);
const importsInFlight = new Set();
const fail = (status, message) => Object.assign(new Error(message), { status });
const scope = (req) => ({ companyId: req.user.companyId });
const getCase = async (req) => {
  const found = await BusinessCase.findOne({ ...scope(req), id: req.params.id }).lean();
  if (!found) throw fail(404, "Case not found");
  return found;
};
const snapshotFor = async (companyId, id) => {
  const snapshot = await BusinessSnapshot.findOne({ companyId, id }).lean();
  if (!snapshot) throw fail(404, "Snapshot not found");
  return snapshot;
};
router.use(protect);
router.get("/company", (req, res) => res.json({ id: req.user.companyId, name: req.user.companyId === "satya-demo" ? "Satya Equipment Distribution" : req.user.companyId, country: "IN", timezone: "Asia/Kolkata", demo: req.user.companyId === "satya-demo", role: req.user.role }));
router.get("/cases", handle(async (req, res) => {
  const cases = await BusinessCase.find(scope(req)).sort({ createdAt: 1 }).limit(100).lean();
  const snapshots = await BusinessSnapshot.find({ ...scope(req), id: { $in: cases.map((item) => item.latestSnapshotId).filter(Boolean) } }).lean();
  const results = new Map(snapshots.map((item) => [item.id, item.result]));
  res.json(cases.map((item) => ({ ...item, ledger: results.get(item.latestSnapshotId)?.ledger || null, findingCount: results.get(item.latestSnapshotId)?.findings.filter((finding) => finding.severity !== "info").length || 0 })));
}));
router.get("/cases/:id", handle(async (req, res) => {
  const businessCase = await getCase(req);
  const snapshot = businessCase.latestSnapshotId ? await snapshotFor(req.user.companyId, businessCase.latestSnapshotId) : null;
  const records = await BusinessRecord.find({ ...scope(req), id: { $in: businessCase.recordIds } }).lean();
  const byId = new Map(records.map((row) => [row.id, row.data]));
  res.json({ ...businessCase, records: businessCase.inputRecords?.length ? businessCase.inputRecords : businessCase.recordIds.map((id) => byId.get(id)), snapshot: snapshot?.result || null, projection: snapshot?.projection || "pending" });
}));
router.post("/cases/:id/reconcile", handle(async (req, res) => {
  if (!writers.has(req.user.role)) throw fail(403, "Reconciliation requires an operations role");
  const businessCase = await getCase(req);
  res.status(202).json(await queueJob(businessCase));
}));
router.get("/jobs/:id", handle(async (req, res) => {
  const job = await BusinessJob.findOne({ ...scope(req), id: req.params.id }).select("id status error snapshotId caseId").lean();
  if (!job) throw fail(404, "Job not found");
  res.json(job);
}));
router.get("/cases/:id/snapshots", handle(async (req, res) => {
  const businessCase = await getCase(req);
  const snapshots = await BusinessSnapshot.find({ ...scope(req), caseId: businessCase.id }).select("id createdAt projection result.observedBefore result.ledger").sort({ createdAt: -1 }).limit(50).lean();
  res.json(snapshots);
}));
router.get("/snapshots/:id", handle(async (req, res) => res.json((await snapshotFor(req.user.companyId, req.params.id)).result)));
router.post("/cases/:id/replay", handle(async (req, res) => {
  const businessCase = await getCase(req);
  if (typeof req.body.observedBefore !== "string" || !Number.isFinite(Date.parse(req.body.observedBefore))) throw fail(422, "An explicit valid knowledge cutoff is required");
  const input = await inputFor(businessCase, { observedBefore: req.body.observedBefore });
  input.invoiceLinks = {};
  input.confirmedDuplicates = {};
  input.paymentAllocations = {};
  for (const decision of businessCase.decisions || []) {
    if (Date.parse(decision.createdAt) > Date.parse(req.body.observedBefore) || !decision.review) continue;
    if (decision.review.kind === "link_invoice") input.invoiceLinks[decision.review.recordId] = decision.review.poId;
    if (decision.review.kind === "confirm_duplicate") input.confirmedDuplicates[decision.review.recordId] = decision.review.originalId;
    if (decision.review.kind === "allocate_payment") input.paymentAllocations[decision.review.recordId] = decision.review.invoiceId;
  }
  res.json({ ...(await engine("reconcile", input)), replay: true, simulation: true, replayInterpretation: 'current_rules_applied_to_observations_at_cutoff' });
}));
router.get("/graph/cases/:id", handle(async (req, res) => {
  const businessCase = await getCase(req);
  if (!businessCase.latestSnapshotId) throw fail(409, "Reconciliation is pending");
  const snapshot = await snapshotFor(req.user.companyId, businessCase.latestSnapshotId);
  try { res.json(await graphFor(req.user.companyId, snapshot.id)); }
  catch { res.json({ ...snapshot.result.graph, source: "mongodb_snapshot", degraded: true, snapshotId: snapshot.id, warning: "Neo4j projection is unavailable; showing the committed evidence snapshot." }); }
}));
router.post("/cases/:id/decisions", handle(async (req, res) => {
  const isManager = managers.has(req.user.role);
  const { action, reason, findingId, review } = req.body;
  const analystActions = new Set(["REQUEST_CLARIFICATION", "ESCALATE"]);
  if (!isManager && !(req.user.role === "ops_analyst" && analystActions.has(action))) throw fail(403, "Approvals, holds and evidence confirmation require a manager; analysts can escalate or request clarification");
  if (review && !isManager) throw fail(403, "Confirming matches, duplicates or payment allocations requires a manager");
  const businessCase = await getCase(req);
  if (req.body.expectedRevision !== businessCase.revision || req.body.snapshotId !== businessCase.latestSnapshotId) throw fail(409, "Evidence changed; refresh the case before deciding");
  if (!["APPROVE", "REQUEST_CLARIFICATION", "ESCALATE", "PLACE_ON_HOLD"].includes(action) || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 2000) throw fail(422, "A permitted action and a meaningful reason are required");
  const snapshot = await snapshotFor(req.user.companyId, businessCase.latestSnapshotId);
  if (findingId && !snapshot.result.findings.some((finding) => finding.id === findingId)) throw fail(422, "Finding does not belong to this snapshot");
  if (action === "APPROVE" && (!snapshot.result.invoices.length || snapshot.result.ledger.canonicalOutstanding === null || snapshot.result.findings.some((finding) => finding.severity !== "info"))) throw fail(409, "A reconciled commercial invoice and resolved blocking evidence are required for whole-case approval");
  const previousReviews = businessCase.reviews || {};
  const reviews = { invoiceLinks: { ...(previousReviews.invoiceLinks || {}) }, confirmedDuplicates: { ...(previousReviews.confirmedDuplicates || {}) }, paymentAllocations: { ...(previousReviews.paymentAllocations || {}) } };
  let acceptedReview = null;
  if (review) {
    if (review.kind === 'link_invoice' && typeof review.recordId === 'string' && review.poId === businessCase.poId) {
      if (!snapshot.result.matchSuggestions.some((candidate) => candidate.recordId === review.recordId)) throw fail(422, 'Select a visible invoice matching suggestion');
      reviews.invoiceLinks = { ...(reviews.invoiceLinks || {}), [review.recordId]: review.poId };
      acceptedReview = { kind: review.kind, recordId: review.recordId, poId: review.poId };
    } else if (review.kind === "confirm_duplicate" && typeof review.recordId === "string" && typeof review.originalId === "string") {
      const candidate = snapshot.result.duplicateCandidates.find((candidate) => candidate.recordId === review.recordId && candidate.candidateOriginalId === review.originalId);
      if (!candidate) throw fail(422, "Select a visible duplicate candidate");
      reviews.confirmedDuplicates[review.recordId] = review.originalId;
      acceptedReview = { kind: review.kind, recordId: review.recordId, originalId: review.originalId };
    } else if (review.kind === "allocate_payment" && typeof review.recordId === "string" && typeof review.invoiceId === "string") {
      const candidate = snapshot.result.unallocatedPayments.find((payment) => payment.paymentId === review.recordId && payment.candidateInvoiceIds.includes(review.invoiceId));
      if (!candidate) throw fail(422, "Select a visible payment candidate");
      reviews.paymentAllocations[review.recordId] = review.invoiceId;
      acceptedReview = { kind: review.kind, recordId: review.recordId, invoiceId: review.invoiceId };
    } else throw fail(422, "Unsupported or incomplete evidence review");
    const input = await inputFor(businessCase);
    await engine("reconcile", { ...input, ...reviews });
  }
  const decision = { id: crypto.randomUUID(), action, reason: reason.trim(), findingId: findingId || null, review: acceptedReview, actorId: String(req.user._id), actorName: req.user.name, actorRole: req.user.role, createdAt: new Date().toISOString(), snapshotId: snapshot.id, effect: "internal_workflow_only_no_transfer_or_message" };
  const updated = await BusinessCase.findOneAndUpdate({ ...scope(req), id: businessCase.id, revision: businessCase.revision, latestSnapshotId: snapshot.id }, { $set: { reviews }, $inc: { revision: 1 }, $push: { decisions: decision } }, { returnDocument: "after" });
  if (!updated) throw fail(409, "Another reviewer updated this case");
  const job = await queueJob(updated);
  await recordAudit({ req, action: `business.${action.toLowerCase()}`, target: businessCase.id, meta: { decisionId: decision.id, snapshotId: snapshot.id } });
  res.status(201).json({ decision, job });
}));
router.get("/records", handle(async (req, res) => {
  const records = await BusinessRecord.find(scope(req)).sort({ createdAt: 1 }).limit(500).lean();
  res.json(records.map((row) => ({ caseId: row.caseId, ...row.data })));
}));
router.get("/audit", handle(async (req, res) => {
  if (!managers.has(req.user.role) && req.user.role !== "auditor") throw fail(403, "Audit access requires a manager or auditor");
  res.json(await AuditLog.find(scope(req)).sort({ createdAt: -1 }).limit(100).lean());
}));
router.get("/evaluation", handle(async (_req, res) => res.json(await engine("evaluation"))));
router.get('/documents/:id', handle(async (req, res) => {
  const document = await SourceDocument.findOne({ ...scope(req), id: req.params.id }).select('id name source mediaType checksum content').lean();
  if (!document) throw fail(404, 'Source document not found');
  res.json(document);
}));
router.post('/imports/preview', handle(async (req, res) => {
  if (!writers.has(req.user.role)) throw fail(403, 'Import preview requires an operations role');
  const { title, poId, files } = req.body;
  const result = await engine('import-preview', { title, poId, files, ingestedAt: new Date().toISOString() });
  if (result.canCommit) {
    try { await engine('reconcile', { caseId: 'preview', companyId: req.user.companyId, poId, records: result.records }); }
    catch (error) { if (error.status !== 422) throw error; result.canCommit = false; result.issueCount += 1; result.issues.push({ file: 'bundle', row: 0, message: error.message }); }
  }
  const id = crypto.randomUUID();
  await ImportPreview.create({ ...scope(req), id, actorId: String(req.user._id), bundle: { title, poId, records: result.records }, documents: result.documents, result: { ...result, documents: undefined } });
  res.json({ id, ...result, documents: result.documents.map(({ content, ...metadata }) => metadata) });
}));
router.post("/imports", handle(async (req, res) => {
  if (!writers.has(req.user.role)) throw fail(403, "Import requires an operations role");
  let payload = req.body;
  let storedPreview = null;
  if (req.body.previewId) {
    if (typeof req.body.previewId !== 'string') throw fail(422, 'Preview ID must be a string');
    storedPreview = await ImportPreview.findOne({ ...scope(req), id: req.body.previewId }).lean();
    if (!storedPreview) throw fail(404, 'Import preview not found');
    if (!storedPreview.result.canCommit) throw fail(422, 'Correct every blocking preview issue before committing');
    payload = storedPreview.bundle;
  }
  const { title, poId, records } = payload;
  if (typeof title !== "string" || title.length < 3 || title.length > 160 || typeof poId !== "string" || !Array.isArray(records) || !records.length || records.length > 1000) throw fail(422, "A title, order ID and up to 1000 structured records are required");
  const companyId = req.user.companyId;
  if (importsInFlight.has(companyId)) throw fail(409, "A source import is already running for this company; retry shortly");
  importsInFlight.add(companyId);
  try {
    const normalized = records.map((record) => ({ ...record, fieldEvidence: storedPreview ? record.fieldEvidence || {} : {}, coverage: record.coverage || 'unknown', provenance: "USER_PROVIDED" }));
    const checksum = storedPreview?.result.sourceFingerprint || crypto.createHash("sha256").update(JSON.stringify({ poId, records: normalized })).digest("hex");
    const caseId = `import-${checksum}`;
    let businessCase = await BusinessCase.findOne({ companyId, id: caseId });
    if (businessCase?.latestSnapshotId) return res.json({ caseId, idempotent: true });
    await engine("reconcile", { caseId, companyId, poId, records: normalized });
    if (!businessCase) {
      if (await BusinessRecord.exists({ companyId, id: { $in: normalized.map((record) => record.id) } })) throw fail(409, "Source record IDs already exist; do not create a new liability by reimporting them");
      businessCase = await BusinessCase.create({ companyId, id: caseId, title, sector: "Imported", poId, supplier: normalized.find((record) => record.id === poId)?.supplier, sourceChecksum: checksum, inputRecords: normalized, recordIds: normalized.map((record) => record.id), status: "importing" });
    }
    for (const document of storedPreview?.documents || []) await SourceDocument.updateOne({ companyId, id: document.id }, { $setOnInsert: document }, { upsert: true });
    for (const record of normalized) await BusinessRecord.updateOne({ companyId, id: record.id }, { $setOnInsert: { caseId, kind: record.type, data: record, ...(record.amount ? { amount: record.amount } : {}), sourceChecksum: checksum } }, { upsert: true });
    await BusinessImport.updateOne({ companyId, id: checksum }, { $setOnInsert: { caseId, checksum, recordCount: normalized.length, actorId: String(req.user._id) } }, { upsert: true });
    await recordAudit({ req, action: "business.import", target: caseId, meta: { checksum, recordCount: normalized.length } });
    res.status(201).json({ caseId, job: await queueJob(businessCase) });
  } finally { importsInFlight.delete(companyId); }
}));
router.post("/cases/:id/scenario", handle(async (req, res) => {
  const businessCase = await getCase(req);
  const input = await inputFor(businessCase);
  if (!req.body.record || typeof req.body.record !== "object") throw fail(422, "One hypothetical source record is required");
  if (input.records.some((record) => record.id === req.body.record.id)) throw fail(409, "Hypothetical source ID already exists");
  input.records.push({ ...req.body.record, provenance: "USER_PROVIDED" });
  res.json({ ...(await engine("reconcile", input)), simulation: true, warning: "Simulation only: no source records, ledger or financial decision was changed." });
}));
export default router;
