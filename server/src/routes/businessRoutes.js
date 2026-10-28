import crypto from "node:crypto";
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { BusinessCase, BusinessRecord, BusinessSnapshot, BusinessJob, BusinessImport, SourceDocument, ImportPreview, BusinessAlert, BusinessReminder } from "../models/Business.js";
import User from "../models/User.js";
import { engine, inputFor, queueJob, graphFor } from "../utils/businessService.js";
import {
  validateTransition,
  checkSegregationOfDuties,
  detectAnomalies,
  evaluateEvidenceCompleteness,
  syncCaseAlerts,
  EXCEPTION_TRANSITIONS,
  DOCUMENT_TRANSITIONS
} from "../utils/lifecycleAndAnomalyService.js";
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
  const fullRecords = businessCase.inputRecords?.length ? businessCase.inputRecords : businessCase.recordIds.map((id) => byId.get(id));

  // Compute anomalies & evidence completeness
  const anomalies = detectAnomalies({ businessCase, snapshot: snapshot?.result, records: fullRecords });
  const documents = await SourceDocument.find({ ...scope(req), $or: [{ caseId: businessCase.id }, { id: { $in: businessCase.recordIds } }] }).lean();
  const completeness = evaluateEvidenceCompleteness({ records: fullRecords, documents });

  // Sync alerts for this case idempotently
  if (snapshot?.result) {
    await syncCaseAlerts({ companyId: req.user.companyId, businessCase, snapshot: snapshot.result }).catch(() => {});
  }

  res.json({
    ...businessCase,
    records: fullRecords,
    snapshot: snapshot?.result || null,
    projection: snapshot?.projection || "pending",
    pendingReconciliation: !!(await BusinessJob.exists({ ...scope(req), caseId: businessCase.id, baseRevision: businessCase.revision, status: { $in: ['queued', 'running'] } })),
    anomalies,
    evidenceCompleteness: completeness
  });
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
  // ── Transition validation ──────────────────────────────────────────
  const transition = validateTransition(businessCase.status, action);
  if (!transition.valid) throw fail(409, transition.reason);
  // ── Self-approval segregation of duties ────────────────────────────
  if (action === 'APPROVE') {
    const sod = await checkSegregationOfDuties({
      companyId: req.user.companyId,
      caseId: businessCase.id,
      userId: req.user._id
    });
    if (!sod.allowed) {
      throw fail(403, sod.reason);
    }
  }
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
  const decision = { id: crypto.randomUUID(), action, reason: reason.trim(), findingId: findingId || null, review: acceptedReview, actorId: String(req.user._id), actorName: req.user.name, actorRole: req.user.role, createdAt: new Date().toISOString(), snapshotId: snapshot.id, effect: "internal_workflow_only_no_transfer_or_message", previousStatus: businessCase.status, newStatus: transition.targetStatus };
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
      businessCase = await BusinessCase.create({ companyId, id: caseId, title, sector: "Imported", poId, supplier: normalized.find((record) => record.id === poId)?.supplier, sourceChecksum: checksum, inputRecords: normalized, recordIds: normalized.map((record) => record.id), status: "importing", createdBy: String(req.user._id) });
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

// ── Feature 1 & 10: Obligation Tracking / Financial Insights Dashboard ──
// Aggregates obligation data across all company cases from authoritative snapshots.
router.get("/dashboard/summary", handle(async (req, res) => {
  const cases = await BusinessCase.find(scope(req)).sort({ createdAt: 1 }).limit(200).lean();
  const snapshotIds = cases.map((c) => c.latestSnapshotId).filter(Boolean);
  const snapshots = await BusinessSnapshot.find({ ...scope(req), id: { $in: snapshotIds } }).select("id result.ledger result.findings result.duplicateCandidates result.unallocatedPayments result.invoices").lean();
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));

  let totalRecordedOutstanding = 0, totalSupportedOutstanding = 0, totalCanonicalOutstanding = 0;
  let totalDisputedExposure = 0, totalSettled = 0;
  let needsReviewCount = 0, reconciledCount = 0, escalatedCount = 0, onHoldCount = 0, awaitingEvidenceCount = 0, importingCount = 0;
  let totalFindingsBlocking = 0, totalFindingsInfo = 0, totalDuplicateCandidates = 0, totalUnallocatedPayments = 0;
  const supplierBalances = {};
  const currenciesSeen = new Set();
  const attentionItems = [];

  for (const c of cases) {
    // Status counts
    if (c.status === "needs_review") needsReviewCount++;
    else if (c.status === "reconciled") reconciledCount++;
    else if (c.status === "escalated") escalatedCount++;
    else if (c.status === "on_hold") onHoldCount++;
    else if (c.status === "awaiting_evidence") awaitingEvidenceCount++;
    else if (c.status === "importing") importingCount++;

    const snapshot = snapshotMap.get(c.latestSnapshotId);
    if (!snapshot?.result?.ledger) continue;

    const ledger = snapshot.result.ledger;
    currenciesSeen.add(ledger.currency);
    const recorded = parseFloat(ledger.recordedOutstanding) || 0;
    const supported = parseFloat(ledger.supportedOutstanding) || 0;
    const canonical = ledger.canonicalOutstanding !== null ? parseFloat(ledger.canonicalOutstanding) || 0 : null;
    const disputed = parseFloat(ledger.disputedExposure) || 0;
    const settled = parseFloat(ledger.settled) || 0;

    totalRecordedOutstanding += recorded;
    totalSupportedOutstanding += supported;
    if (canonical !== null) totalCanonicalOutstanding += canonical;
    totalDisputedExposure += disputed;
    totalSettled += settled;

    // Supplier aggregation
    const supplier = c.supplier || "Unknown";
    if (!supplierBalances[supplier]) supplierBalances[supplier] = { recorded: 0, supported: 0, disputed: 0, settled: 0, caseCount: 0, currency: ledger.currency };
    supplierBalances[supplier].recorded += recorded;
    supplierBalances[supplier].supported += supported;
    supplierBalances[supplier].disputed += disputed;
    supplierBalances[supplier].settled += settled;
    supplierBalances[supplier].caseCount++;

    // Findings counts
    const findings = snapshot.result.findings || [];
    const blocking = findings.filter((f) => f.severity !== "info");
    totalFindingsBlocking += blocking.length;
    totalFindingsInfo += findings.length - blocking.length;

    // Duplicates and unallocated payments
    const duplicates = snapshot.result.duplicateCandidates?.length || 0;
    const unallocated = snapshot.result.unallocatedPayments?.length || 0;
    totalDuplicateCandidates += duplicates;
    totalUnallocatedPayments += unallocated;

    // Attention items — cases that need action
    if (c.status !== "reconciled" && c.status !== "importing") {
      const reasons = [];
      if (blocking.length > 0) reasons.push(`${blocking.length} blocking issue${blocking.length > 1 ? "s" : ""}`);
      if (duplicates > 0) reasons.push(`${duplicates} possible duplicate${duplicates > 1 ? "s" : ""}`);
      if (unallocated > 0) reasons.push(`${unallocated} unlinked payment${unallocated > 1 ? "s" : ""}`);
      if (disputed > 0) reasons.push(`${ledger.currency} ${disputed.toFixed(2)} disputed exposure`);
      if (c.status === "escalated") reasons.push("escalated — awaiting manager review");
      if (c.status === "awaiting_evidence") reasons.push("waiting for additional evidence");
      if (reasons.length > 0) {
        attentionItems.push({ caseId: c.id, poId: c.poId, supplier: c.supplier, status: c.status, reasons, recordedOutstanding: ledger.recordedOutstanding, currency: ledger.currency });
      }
    }
  }

  // Determine mixed-currency warning
  const currency = currenciesSeen.size === 1 ? [...currenciesSeen][0] : currenciesSeen.size > 0 ? "MIXED" : "INR";

  res.json({
    currency,
    mixedCurrencyWarning: currenciesSeen.size > 1 ? "Totals combine multiple currencies. Individual case balances are authoritative." : null,
    totals: {
      recordedOutstanding: totalRecordedOutstanding.toFixed(2),
      supportedOutstanding: totalSupportedOutstanding.toFixed(2),
      canonicalOutstanding: totalCanonicalOutstanding.toFixed(2),
      disputedExposure: totalDisputedExposure.toFixed(2),
      settled: totalSettled.toFixed(2),
    },
    statusCounts: { needs_review: needsReviewCount, reconciled: reconciledCount, escalated: escalatedCount, on_hold: onHoldCount, awaiting_evidence: awaitingEvidenceCount, importing: importingCount, total: cases.length },
    findings: { blocking: totalFindingsBlocking, informational: totalFindingsInfo },
    duplicateCandidates: totalDuplicateCandidates,
    unallocatedPayments: totalUnallocatedPayments,
    supplierBalances: Object.entries(supplierBalances).map(([name, data]) => ({ supplier: name, ...data, recorded: data.recorded.toFixed(2), supported: data.supported.toFixed(2), disputed: data.disputed.toFixed(2), settled: data.settled.toFixed(2) })).sort((a, b) => parseFloat(b.recorded) - parseFloat(a.recorded)),
    attentionItems: attentionItems.sort((a, b) => b.reasons.length - a.reasons.length).slice(0, 25),
  });
}));

// ── Feature 6: Risk and Attention Dashboard ──────────────────────────
// Prioritized list of cases needing attention, with transparent scoring rules.
router.get("/dashboard/attention", handle(async (req, res) => {
  const cases = await BusinessCase.find({ ...scope(req), status: { $nin: ["reconciled", "importing"] } }).sort({ createdAt: 1 }).limit(100).lean();
  const snapshotIds = cases.map((c) => c.latestSnapshotId).filter(Boolean);
  const snapshots = await BusinessSnapshot.find({ ...scope(req), id: { $in: snapshotIds } }).select("id result.ledger result.findings result.duplicateCandidates result.unallocatedPayments").lean();
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));
  const imports = await BusinessImport.find({ ...scope(req), caseId: { $in: cases.map((c) => c.id) } }).lean();
  const importMap = new Map(imports.map((i) => [i.caseId, i]));

  const items = cases.map((c) => {
    const snapshot = snapshotMap.get(c.latestSnapshotId);
    const ledger = snapshot?.result?.ledger;
    const findings = snapshot?.result?.findings || [];
    const blocking = findings.filter((f) => f.severity !== "info");
    const duplicates = snapshot?.result?.duplicateCandidates?.length || 0;
    const unallocated = snapshot?.result?.unallocatedPayments?.length || 0;
    const disputed = parseFloat(ledger?.disputedExposure || "0");
    const importRecord = importMap.get(c.id);

    // Transparent priority scoring — each rule adds a deterministic score
    let priority = 0;
    const rules = [];
    if (c.status === "escalated") { priority += 30; rules.push("Escalated — requires manager decision"); }
    if (c.status === "awaiting_evidence") { priority += 15; rules.push("Waiting for additional evidence"); }
    if (c.status === "on_hold") { priority += 10; rules.push("On hold — needs review to proceed"); }
    if (blocking.length > 0) { priority += blocking.length * 5; rules.push(`${blocking.length} blocking finding${blocking.length > 1 ? "s" : ""} require review`); }
    if (duplicates > 0) { priority += duplicates * 8; rules.push(`${duplicates} possible duplicate${duplicates > 1 ? "s" : ""} need confirmation`); }
    if (unallocated > 0) { priority += unallocated * 6; rules.push(`${unallocated} unlinked payment${unallocated > 1 ? "s" : ""}`); }
    if (disputed > 1000) { priority += 20; rules.push("Disputed exposure exceeds 1,000"); }
    else if (disputed > 0) { priority += 5; rules.push("Non-zero disputed exposure"); }

    // Time-based aging: older unresolved cases score higher
    const ageHours = (Date.now() - new Date(c.createdAt).getTime()) / 3600000;
    if (ageHours > 168) { priority += 15; rules.push("Unresolved for more than 7 days"); }
    else if (ageHours > 48) { priority += 5; rules.push("Unresolved for more than 48 hours"); }

    // No decisions yet
    if (!c.decisions?.length) { priority += 5; rules.push("No decisions recorded yet"); }

    return {
      caseId: c.id, poId: c.poId, supplier: c.supplier, status: c.status,
      priority, rules,
      ledger: ledger ? { currency: ledger.currency, recordedOutstanding: ledger.recordedOutstanding, supportedOutstanding: ledger.supportedOutstanding, disputedExposure: ledger.disputedExposure } : null,
      blockingFindings: blocking.length, duplicateCandidates: duplicates, unallocatedPayments: unallocated,
      decisionCount: c.decisions?.length || 0,
      importedBy: importRecord?.actorId || null,
      createdAt: c.createdAt,
    };
  }).sort((a, b) => b.priority - a.priority);

  res.json({ items, scoringRules: "Priority is calculated from status, blocking findings, duplicates, unlinked payments, disputed exposure, age and decision history. Higher scores need attention first." });
}));

// ── Feature 3: Exception assignment & resolution workflow ─────────────
// Get assignable users for the company
router.get("/users/assignable", handle(async (req, res) => {
  const users = await User.find({ companyId: req.user.companyId, active: true }).select("_id name email role").lean();
  res.json(users.map(u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role })));
}));

// Assigns or reassigns a case with authoritative user validation
router.post("/cases/:id/assign", handle(async (req, res) => {
  if (!managers.has(req.user.role)) throw fail(403, "Only managers can assign investigations");
  const { assigneeId, reason } = req.body;
  if (!assigneeId || typeof assigneeId !== "string" || typeof reason !== "string" || reason.trim().length < 10) {
    throw fail(422, "A valid assigneeId and reason (10+ characters) are required");
  }

  // Validate assignee exists, active, and belongs to user's company
  const targetUser = await User.findOne({ _id: assigneeId, companyId: req.user.companyId, active: true }).lean();
  if (!targetUser) throw fail(404, "Assignee not found in your organization or inactive");

  const businessCase = await getCase(req);
  if (businessCase.status === "reconciled") throw fail(409, "Cannot assign a reconciled case");

  const prevAssignee = businessCase.assigneeName || "Unassigned";
  const actionName = businessCase.assigneeId ? "REASSIGN" : "ASSIGN";
  const nextExStatus = businessCase.exceptionStatus === "open" ? "assigned" : businessCase.exceptionStatus || "assigned";

  const assignmentDecision = {
    id: crypto.randomUUID(),
    action: actionName,
    reason: reason.trim(),
    actorId: String(req.user._id),
    actorName: req.user.name,
    actorRole: req.user.role,
    assigneeId: String(targetUser._id),
    assigneeName: targetUser.name,
    createdAt: new Date().toISOString(),
    effect: `Investigation assigned to ${targetUser.name} (previously ${prevAssignee})`,
    previousStatus: businessCase.status,
    newStatus: businessCase.status,
    previousExceptionStatus: businessCase.exceptionStatus || "open",
    newExceptionStatus: nextExStatus
  };

  const updated = await BusinessCase.findOneAndUpdate(
    { ...scope(req), id: businessCase.id, revision: businessCase.revision },
    {
      $set: {
        assigneeId: String(targetUser._id),
        assigneeName: targetUser.name,
        exceptionStatus: nextExStatus
      },
      $push: { decisions: assignmentDecision },
      $inc: { revision: 1 }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw fail(409, "Another reviewer updated this case; please refresh");

  await recordAudit({
    req,
    action: `business.${actionName.toLowerCase()}`,
    target: businessCase.id,
    meta: { assigneeId: String(targetUser._id), assigneeName: targetUser.name, reason: reason.trim() }
  });

  res.status(201).json({ assignment: assignmentDecision, case: updated });
}));

// Update exception resolution status (in_progress, awaiting_evidence, resolved, reopened)
router.post("/cases/:id/exception-status", handle(async (req, res) => {
  const { status: targetStatus, notes, reason } = req.body;
  if (!targetStatus || typeof targetStatus !== "string") throw fail(422, "Target exception status required");
  const businessCase = await getCase(req);

  const currentEx = businessCase.exceptionStatus || "open";
  const permitted = EXCEPTION_TRANSITIONS.get(currentEx);
  if (!permitted || !permitted.has(targetStatus)) {
    throw fail(409, `Cannot transition exception from "${currentEx}" to "${targetStatus}"`);
  }

  // Authorization: assignee or manager can update status; resolve/reopen requires meaningful notes/reason
  const isAssignee = businessCase.assigneeId && String(businessCase.assigneeId) === String(req.user._id);
  const isManager = managers.has(req.user.role);
  if (!isAssignee && !isManager) {
    throw fail(403, "Only the assigned investigator or a manager can update exception status");
  }

  const commentary = (notes || reason || "").trim();
  if ((targetStatus === "resolved" || targetStatus === "reopened") && commentary.length < 10) {
    throw fail(422, `A note of at least 10 characters is required to mark an exception as ${targetStatus}`);
  }

  const decisionObj = {
    id: crypto.randomUUID(),
    action: `EXCEPTION_${targetStatus.toUpperCase()}`,
    reason: commentary || `Exception marked ${targetStatus}`,
    actorId: String(req.user._id),
    actorName: req.user.name,
    actorRole: req.user.role,
    createdAt: new Date().toISOString(),
    effect: `Exception status transitioned from ${currentEx} to ${targetStatus}`,
    previousStatus: businessCase.status,
    newStatus: businessCase.status,
    previousExceptionStatus: currentEx,
    newExceptionStatus: targetStatus
  };

  const updateSet = { exceptionStatus: targetStatus };
  if (targetStatus === "resolved") {
    updateSet.resolutionNotes = commentary;
  }

  const updated = await BusinessCase.findOneAndUpdate(
    { ...scope(req), id: businessCase.id, revision: businessCase.revision },
    {
      $set: updateSet,
      $push: { decisions: decisionObj },
      $inc: { revision: 1 }
    },
    { returnDocument: "after" }
  );
  if (!updated) throw fail(409, "Another reviewer updated this case; please refresh");

  await recordAudit({
    req,
    action: `business.exception_${targetStatus}`,
    target: businessCase.id,
    meta: { previousStatus: currentEx, newStatus: targetStatus, commentary }
  });

  res.status(200).json({ status: targetStatus, case: updated });
}));

// ── Feature 4: Document Verification & Lifecycle ──────────────────────
router.get("/cases/:id/documents", handle(async (req, res) => {
  const businessCase = await getCase(req);
  const documents = await SourceDocument.find({
    ...scope(req),
    $or: [{ caseId: businessCase.id }, { id: { $in: businessCase.recordIds } }]
  }).select("id name source mediaType checksum documentType verificationStatus verifiedBy verifiedAt rejectionReason version supersededBy previousVersionId createdAt").lean();
  res.json(documents);
}));

router.post("/documents/:id/verify", handle(async (req, res) => {
  if (!managers.has(req.user.role)) throw fail(403, "Document verification requires a manager role");
  const { status: targetStatus, reason, documentType } = req.body;
  if (!["verified", "rejected"].includes(targetStatus)) {
    throw fail(422, "Status must be 'verified' or 'rejected'");
  }
  if (targetStatus === "rejected" && (!reason || reason.trim().length < 5)) {
    throw fail(422, "A rejection reason is required");
  }

  const doc = await SourceDocument.findOne({ ...scope(req), id: req.params.id });
  if (!doc) throw fail(404, "Source document not found");

  const currentStatus = doc.verificationStatus || "pending_verification";
  const allowed = DOCUMENT_TRANSITIONS.get(currentStatus);
  if (!allowed || !allowed.has(targetStatus)) {
    throw fail(409, `Cannot transition document from ${currentStatus} to ${targetStatus}`);
  }

  doc.verificationStatus = targetStatus;
  doc.verifiedBy = req.user.name;
  doc.verifiedAt = new Date();
  if (reason) doc.rejectionReason = reason.trim();
  if (documentType) doc.documentType = documentType;
  await doc.save();

  await recordAudit({
    req,
    action: `document.${targetStatus}`,
    target: doc.id,
    meta: { previousStatus: currentStatus, newStatus: targetStatus, reason }
  });

  res.json({ document: doc });
}));

// ── Feature 5: Persistent Alerts Management & Reminders ───────────────
router.get("/alerts", handle(async (req, res) => {
  // Return persistent alerts from database
  const alerts = await BusinessAlert.find(scope(req)).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ alerts, count: alerts.length });
}));

router.post("/alerts/:alertId/acknowledge", handle(async (req, res) => {
  const alert = await BusinessAlert.findOneAndUpdate(
    { ...scope(req), alertId: req.params.alertId },
    { $set: { status: "acknowledged", acknowledgedBy: req.user.name, acknowledgedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!alert) throw fail(404, "Alert not found");
  await recordAudit({ req, action: "alert.acknowledge", target: alert.alertId, meta: { caseId: alert.caseId } });
  res.json({ alert });
}));

router.post("/alerts/:alertId/dismiss", handle(async (req, res) => {
  const { reason } = req.body;
  const alert = await BusinessAlert.findOneAndUpdate(
    { ...scope(req), alertId: req.params.alertId },
    { $set: { status: "dismissed", dismissedBy: req.user.name, dismissedAt: new Date(), dismissalReason: (reason || "").trim() } },
    { returnDocument: "after" }
  );
  if (!alert) throw fail(404, "Alert not found");
  await recordAudit({ req, action: "alert.dismiss", target: alert.alertId, meta: { caseId: alert.caseId, reason } });
  res.json({ alert });
}));

// Reminders
router.get("/cases/:id/reminders", handle(async (req, res) => {
  const reminders = await BusinessReminder.find({ ...scope(req), caseId: req.params.id, status: "active" }).sort({ dueAt: 1 }).lean();
  res.json(reminders);
}));

router.post("/cases/:id/reminders", handle(async (req, res) => {
  const { dueAt, reason, recipientId } = req.body;
  if (!dueAt || isNaN(Date.parse(dueAt)) || !reason || reason.trim().length < 5) {
    throw fail(422, "Valid due date and reason required");
  }
  const businessCase = await getCase(req);
  let recipientName = null;
  if (recipientId) {
    const user = await User.findOne({ _id: recipientId, companyId: req.user.companyId, active: true }).lean();
    if (user) recipientName = user.name;
  }
  const reminder = await BusinessReminder.create({
    ...scope(req),
    reminderId: `REM-${crypto.randomUUID()}`,
    caseId: businessCase.id,
    poId: businessCase.poId,
    dueAt: new Date(dueAt),
    reason: reason.trim(),
    recipientId: recipientId || null,
    recipientName: recipientName || businessCase.assigneeName || null,
    createdBy: req.user.name,
    status: "active"
  });

  await recordAudit({ req, action: "reminder.create", target: reminder.reminderId, meta: { caseId: businessCase.id, dueAt } });
  res.status(201).json(reminder);
}));

// ── Feature 6: Audit-Ready, Evidence-Linked Reports (JSON & CSV) ──────
router.get("/cases/:id/report", handle(async (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  const businessCase = await getCase(req);
  const snapshot = businessCase.latestSnapshotId ? await snapshotFor(req.user.companyId, businessCase.latestSnapshotId) : null;
  const records = await BusinessRecord.find({ ...scope(req), id: { $in: businessCase.recordIds } }).lean();
  const byId = new Map(records.map((r) => [r.id, r.data]));
  const fullRecords = businessCase.inputRecords?.length ? businessCase.inputRecords : businessCase.recordIds.map((id) => byId.get(id));
  const documents = await SourceDocument.find({ ...scope(req), $or: [{ caseId: businessCase.id }, { id: { $in: businessCase.recordIds } }] }).lean();

  const anomalies = detectAnomalies({ businessCase, snapshot: snapshot?.result, records: fullRecords });
  const completeness = evaluateEvidenceCompleteness({ records: fullRecords, documents });
  const audits = await AuditLog.find({ ...scope(req), target: businessCase.id }).sort({ createdAt: -1 }).limit(50).lean();

  const reportPayload = {
    manifest: {
      generatedAt: new Date().toISOString(),
      requestedBy: { id: String(req.user._id), name: req.user.name, role: req.user.role },
      companyId: req.user.companyId,
      caseId: businessCase.id,
      revision: businessCase.revision,
      snapshotId: businessCase.latestSnapshotId || null,
    },
    caseSummary: {
      id: businessCase.id,
      poId: businessCase.poId,
      title: businessCase.title,
      supplier: businessCase.supplier,
      workflowStatus: businessCase.status,
      exceptionStatus: businessCase.exceptionStatus || "open",
      assignee: businessCase.assigneeName || "Unassigned",
      resolutionNotes: businessCase.resolutionNotes || null,
      createdBy: businessCase.createdBy || "System/Import"
    },
    financialLedger: snapshot?.result?.ledger || null,
    discrepancies: snapshot?.result?.findings || [],
    financialAnomalies: anomalies,
    evidenceCompleteness: completeness,
    sourceDocuments: documents.map(d => ({
      id: d.id,
      name: d.name,
      documentType: d.documentType || "other",
      verificationStatus: d.verificationStatus || "pending_verification",
      verifiedBy: d.verifiedBy || null,
      checksum: d.checksum || null
    })),
    decisionsHistory: businessCase.decisions || [],
    auditTrail: audits.map(a => ({
      eventId: a.eventId,
      action: a.action,
      role: a.role,
      createdAt: a.createdAt,
      meta: a.meta
    }))
  };

  // Record report generation audit
  await recordAudit({ req, action: "report.export", target: businessCase.id, meta: { format } });

  if (format === "json") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="satya-report-${businessCase.poId || businessCase.id}.json"`);
    return res.json(reportPayload);
  }

  // Generate safe CSV
  const sanitize = (val) => {
    if (val === null || val === undefined) return '""';
    let s = String(val).replace(/"/g, '""');
    if (/^[=\+\-@]/.test(s)) s = `'${s}`; // Prevent CSV formula injection
    return `"${s}"`;
  };

  const rows = [
    ["SECTION", "FIELD_1", "FIELD_2", "FIELD_3", "FIELD_4", "FIELD_5"],
    ["METADATA", "Report ID", businessCase.id, "Generated", reportPayload.manifest.generatedAt, `Requester: ${req.user.name}`],
    ["CASE", "PO ID", businessCase.poId, "Supplier", businessCase.supplier, `Status: ${businessCase.status}`],
    ["LEDGER", "Currency", reportPayload.financialLedger?.currency || "N/A", "Supported Outstanding", reportPayload.financialLedger?.supportedOutstanding || "N/A", `Disputed: ${reportPayload.financialLedger?.disputedExposure || "0"}`],
    ["---", "---", "---", "---", "---", "---"],
    ["ANOMALIES", "Anomaly ID", "Type", "Severity", "Title", "Observed vs Baseline"],
    ...anomalies.map(a => ["ANOMALY", a.id, a.type, a.severity, a.title, `${a.observedValue} vs ${a.baselineValue}`]),
    ["---", "---", "---", "---", "---", "---"],
    ["FINDINGS", "Finding ID", "Type", "Severity", "Action", "Title"],
    ...(snapshot?.result?.findings || []).map(f => ["FINDING", f.id, f.type, f.severity, f.action, f.title]),
    ["---", "---", "---", "---", "---", "---"],
    ["DOCUMENTS", "Doc ID", "Name", "Type", "Verification Status", "Verified By"],
    ...documents.map(d => ["DOCUMENT", d.id, d.name, d.documentType || "other", d.verificationStatus || "pending", d.verifiedBy || "N/A"]),
    ["---", "---", "---", "---", "---", "---"],
    ["DECISIONS", "Decision ID", "Action", "Actor", "Date", "Reason"],
    ...(businessCase.decisions || []).map(d => ["DECISION", d.id, d.action, d.actorName, d.createdAt, d.reason])
  ];

  const csvContent = rows.map(r => r.map(sanitize).join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="satya-report-${businessCase.poId || businessCase.id}.csv"`);
  return res.send(csvContent);
}));

// ── Feature 12: Enhanced audit with transition history ────────────────
router.get("/audit/detailed", handle(async (req, res) => {
  if (!managers.has(req.user.role) && req.user.role !== "auditor") throw fail(403, "Detailed audit access requires a manager or auditor");
  const logs = await AuditLog.find(scope(req)).sort({ createdAt: -1 }).limit(200).lean();
  // Enrich with case context where available
  const caseIds = [...new Set(logs.map((l) => l.target).filter(Boolean))];
  const cases = await BusinessCase.find({ ...scope(req), id: { $in: caseIds } }).select("id poId supplier status decisions").lean();
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const enriched = logs.map((log) => {
    const c = caseMap.get(log.target);
    return { ...log, caseContext: c ? { poId: c.poId, supplier: c.supplier, currentStatus: c.status, decisionCount: c.decisions?.length || 0 } : null };
  });
  res.json(enriched);
}));

export default router;
