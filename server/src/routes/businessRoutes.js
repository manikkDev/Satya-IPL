import crypto from "node:crypto";
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { BusinessCase, BusinessRecord, BusinessSnapshot, BusinessJob, BusinessImport, SourceDocument, ImportPreview } from "../models/Business.js";
import { engine, inputFor, queueJob, graphFor, validateTransition } from "../utils/businessService.js";
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
  res.json({ ...businessCase, records: businessCase.inputRecords?.length ? businessCase.inputRecords : businessCase.recordIds.map((id) => byId.get(id)), snapshot: snapshot?.result || null, projection: snapshot?.projection || "pending", pendingReconciliation: !!(await BusinessJob.exists({ ...scope(req), caseId: businessCase.id, baseRevision: businessCase.revision, status: { $in: ['queued', 'running'] } })) });
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
    const importRecord = await BusinessImport.findOne({ companyId: req.user.companyId, caseId: businessCase.id }).lean();
    if (importRecord && String(importRecord.actorId) === String(req.user._id)) {
      throw fail(403, 'The user who imported this case cannot approve it (segregation of duties)');
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

// ── Feature 8: Exception assignment ──────────────────────────────────
// Assigns a case to a specific user for investigation. Stored in the decisions array.
router.post("/cases/:id/assign", handle(async (req, res) => {
  if (!managers.has(req.user.role)) throw fail(403, "Only managers can assign investigations");
  const { assigneeId, assigneeName, reason } = req.body;
  if (typeof assigneeId !== "string" || typeof assigneeName !== "string" || typeof reason !== "string" || reason.trim().length < 10) throw fail(422, "Assignee and a meaningful reason (10+ characters) are required");
  const businessCase = await getCase(req);
  if (businessCase.status === "reconciled") throw fail(409, "Cannot assign a reconciled case");
  const assignment = { id: crypto.randomUUID(), action: "ASSIGN", reason: reason.trim(), actorId: String(req.user._id), actorName: req.user.name, actorRole: req.user.role, assigneeId, assigneeName, createdAt: new Date().toISOString(), effect: "internal_workflow_only_no_transfer_or_message", previousStatus: businessCase.status, newStatus: businessCase.status };
  const updated = await BusinessCase.findOneAndUpdate({ ...scope(req), id: businessCase.id, revision: businessCase.revision }, { $set: { assigneeId, assigneeName }, $push: { decisions: assignment }, $inc: { revision: 1 } }, { returnDocument: "after" });
  if (!updated) throw fail(409, "Another reviewer updated this case");
  await recordAudit({ req, action: "business.assign", target: businessCase.id, meta: { assigneeId, assigneeName } });
  res.status(201).json({ assignment });
}));

// ── Feature 11: Alerts — in-app notification log (no external provider) ─
// Returns generated alerts based on case state. No external email/push — safe.
router.get("/alerts", handle(async (req, res) => {
  const cases = await BusinessCase.find(scope(req)).sort({ createdAt: 1 }).limit(200).lean();
  const snapshotIds = cases.map((c) => c.latestSnapshotId).filter(Boolean);
  const snapshots = await BusinessSnapshot.find({ ...scope(req), id: { $in: snapshotIds } }).select("id result.ledger result.findings result.duplicateCandidates result.unallocatedPayments").lean();
  const snapshotMap = new Map(snapshots.map((s) => [s.id, s]));

  const alerts = [];
  for (const c of cases) {
    if (c.status === "reconciled" || c.status === "importing") continue;
    const snapshot = snapshotMap.get(c.latestSnapshotId);
    const findings = snapshot?.result?.findings || [];
    const blocking = findings.filter((f) => f.severity !== "info");
    const duplicates = snapshot?.result?.duplicateCandidates?.length || 0;
    const unallocated = snapshot?.result?.unallocatedPayments?.length || 0;
    const disputed = parseFloat(snapshot?.result?.ledger?.disputedExposure || "0");

    if (c.status === "escalated") alerts.push({ type: "escalated", severity: "high", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `Case ${c.poId} has been escalated and requires manager review`, createdAt: c.updatedAt || c.createdAt });
    if (blocking.length > 0) alerts.push({ type: "blocking_findings", severity: "medium", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `${blocking.length} blocking issue${blocking.length > 1 ? "s" : ""} found in ${c.poId}`, createdAt: c.updatedAt || c.createdAt });
    if (duplicates > 0) alerts.push({ type: "duplicate_candidates", severity: "high", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `${duplicates} possible duplicate invoice${duplicates > 1 ? "s" : ""} in ${c.poId} — ${snapshot.result.ledger.currency} ${disputed.toFixed(2)} at risk`, createdAt: c.updatedAt || c.createdAt });
    if (unallocated > 0) alerts.push({ type: "unlinked_payments", severity: "medium", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `${unallocated} payment${unallocated > 1 ? "s" : ""} not linked to an invoice in ${c.poId}`, createdAt: c.updatedAt || c.createdAt });
    if (c.status === "awaiting_evidence") alerts.push({ type: "awaiting_evidence", severity: "medium", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `Case ${c.poId} is waiting for additional evidence`, createdAt: c.updatedAt || c.createdAt });

    // Age-based alerts
    const ageHours = (Date.now() - new Date(c.createdAt).getTime()) / 3600000;
    if (ageHours > 168 && !c.decisions?.length) alerts.push({ type: "stale_no_action", severity: "high", caseId: c.id, poId: c.poId, supplier: c.supplier, message: `Case ${c.poId} has been open for ${Math.floor(ageHours / 24)} days with no recorded decisions`, createdAt: c.createdAt });
  }

  alerts.sort((a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1));
  res.json({ alerts, notice: "These are in-app alerts generated from case state. No external notifications (email, SMS, push) are configured." });
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
