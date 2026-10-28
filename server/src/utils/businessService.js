import crypto from "node:crypto";
import neo4j from "neo4j-driver";
import { BusinessCase, BusinessRecord, BusinessSnapshot, BusinessJob } from "../models/Business.js";
import { recordAudit } from './audit.js';

// ── Transaction Lifecycle State Machine ──────────────────────────────
// Permitted transitions: Map<currentStatus, Map<action, targetStatus>>
// Derived from the existing status-derivation logic in publish() and the
// decision actions permitted by businessRoutes.  System-initiated transitions
// (e.g. importing→needs_review via reconciliation) are handled separately in
// publish() and are not user-invoked actions.
export const TRANSITIONS = new Map([
  ['needs_review', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
  ])],
  ['on_hold', new Map([
    ['APPROVE',                'reconciled'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
    ['PLACE_ON_HOLD',          'on_hold'],       // idempotent hold-with-review
  ])],
  ['escalated', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'],
    ['ESCALATE',               'escalated'],     // re-escalate with new reason
  ])],
  ['awaiting_evidence', new Map([
    ['APPROVE',                'reconciled'],
    ['PLACE_ON_HOLD',          'on_hold'],
    ['ESCALATE',               'escalated'],
    ['REQUEST_CLARIFICATION',  'awaiting_evidence'], // request further evidence
  ])],
  // 'reconciled' — terminal for decisions; new records trigger re-reconcile
  // 'importing'  — system-only; transitions to needs_review/reconciled via publish()
]);

/**
 * Validate a proposed status transition.
 *
 * @param {string}  currentStatus  The case's current workflow status.
 * @param {string}  action         The decision action being attempted.
 * @returns {{ valid: boolean, targetStatus?: string, reason?: string }}
 */
export const validateTransition = (currentStatus, action) => {
  if (currentStatus === 'importing') {
    return { valid: false, reason: `Case is still being imported and cannot accept decisions yet` };
  }
  if (currentStatus === 'reconciled') {
    return { valid: false, reason: `Case is already reconciled; no further decisions are permitted unless new evidence triggers re-reconciliation` };
  }
  const allowed = TRANSITIONS.get(currentStatus);
  if (!allowed) {
    return { valid: false, reason: `Unknown case status "${currentStatus}"` };
  }
  const targetStatus = allowed.get(action);
  if (targetStatus === undefined) {
    return { valid: false, reason: `Action "${action}" is not permitted when the case status is "${currentStatus}"` };
  }
  return { valid: true, targetStatus };
};

export const engine = async (path, body) => {
  const response = await fetch(`${process.env.ENGINE_API_URL || process.env.ML_API_URL || "http://localhost:8000"}/internal/${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-internal-token": process.env.NODE_INTERNAL_TOKEN || "" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(response.status === 422 ? JSON.stringify(result.detail).slice(0, 500) : `Reconciliation engine unavailable (${response.status})`);
    error.status = response.status === 422 ? 422 : 503;
    throw error;
  }
  return result;
};

let graphDriver;
const driver = () => {
  if (!graphDriver) graphDriver = neo4j.driver(process.env.NEO4J_URI || "bolt://localhost:7687", neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || ""), { connectionTimeout: 5000, maxTransactionRetryTime: 5000 });
  return graphDriver;
};
export const projectSnapshot = async (snapshot) => {
  const session = driver().session();
  try {
    await session.run("CREATE CONSTRAINT satya_entity_key IF NOT EXISTS FOR (n:SatyaEntity) REQUIRE n.key IS UNIQUE");
    await session.run("CREATE INDEX satya_case_lookup IF NOT EXISTS FOR (n:SatyaEntity) ON (n.companyId,n.snapshotId,n.id)");
    const { companyId, id: snapshotId } = snapshot;
    const nodes = snapshot.result.graph.nodes.map((node) => ({ ...node, amount: node.amount || "", key: `${companyId}:${snapshotId}:${node.id}` }));
    await session.run("UNWIND $nodes AS row MERGE (n:SatyaEntity {key:row.key}) SET n.id=row.id, n.companyId=$companyId, n.snapshotId=$snapshotId, n.label=row.label, n.kind=row.type, n.currency=row.currency, n.amount=row.amount, n.provenance=row.provenance", { companyId, snapshotId, nodes });
    const edges = snapshot.result.graph.edges.map((edge) => ({ ...edge, key: `${companyId}:${snapshotId}:${edge.id}`, amount: edge.amount || "", quantity: edge.quantity || "" }));
    await session.run("UNWIND $edges AS row MATCH (a:SatyaEntity {companyId:$companyId,snapshotId:$snapshotId,id:row.source}), (b:SatyaEntity {companyId:$companyId,snapshotId:$snapshotId,id:row.target}) MERGE (a)-[r:EVIDENCE_LINK {key:row.key}]->(b) SET r.id=row.id, r.companyId=$companyId, r.snapshotId=$snapshotId, r.kind=row.type, r.status=row.status, r.amount=row.amount, r.quantity=row.quantity", { companyId, snapshotId, edges });
    await BusinessSnapshot.updateOne({ companyId, id: snapshotId }, { $set: { projection: "ready" } });
    return "ready";
  } finally { await session.close(); }
};
export const graphFor = async (companyId, snapshotId) => {
  const session = driver().session();
  try {
    const result = await session.run("MATCH (n:SatyaEntity {companyId:$companyId,snapshotId:$snapshotId}) RETURN n ORDER BY n.id LIMIT 200", { companyId, snapshotId });
    const nodes = result.records.map((record) => { const n = record.get("n").properties; return { id: n.id, label: n.label, type: n.kind, amount: n.amount, currency: n.currency, provenance: n.provenance }; });
    const ids = nodes.map((node) => node.id);
    const relations = await session.run("MATCH (a:SatyaEntity {companyId:$companyId,snapshotId:$snapshotId})-[r:EVIDENCE_LINK {companyId:$companyId,snapshotId:$snapshotId}]->(b:SatyaEntity {companyId:$companyId,snapshotId:$snapshotId}) WHERE a.id IN $ids AND b.id IN $ids RETURN a.id AS source,b.id AS target,r ORDER BY r.id LIMIT 400", { companyId, snapshotId, ids });
    return { nodes, edges: relations.records.map((row) => ({ ...row.get("r").properties, type: row.get("r").properties.kind, source: row.get("source"), target: row.get("target") })), source: "neo4j", snapshotId };
  } finally { await session.close(); }
};

export const inputFor = async (businessCase, cutoffs = {}) => {
  const rows = await BusinessRecord.find({ companyId: businessCase.companyId, id: { $in: businessCase.recordIds } }).lean();
  const byId = new Map(rows.map((row) => [row.id, row.data]));
  const decisionTimes = (businessCase.decisions || []).map((decision) => Date.parse(decision.createdAt));
  const defaultCutoff = businessCase.demoClock ? new Date(Math.max(Date.parse(businessCase.demoClock), ...decisionTimes)).toISOString() : new Date().toISOString();
  return { caseId: businessCase.id, companyId: businessCase.companyId, poId: businessCase.poId, records: businessCase.inputRecords?.length ? businessCase.inputRecords : businessCase.recordIds.map((id) => byId.get(id)).filter(Boolean), observedBefore: cutoffs.observedBefore || defaultCutoff, ...(cutoffs.occurredBefore ? { occurredBefore: cutoffs.occurredBefore } : {}), ...businessCase.reviews };
};
export const publish = async (businessCase, input, result) => {
  if (result.companyId !== businessCase.companyId || result.caseId !== businessCase.id) throw new Error("Engine result scope mismatch");
  const snapshot = await BusinessSnapshot.findOneAndUpdate({ companyId: businessCase.companyId, id: result.snapshotId }, { $setOnInsert: { caseId: businessCase.id, result, inputs: input, projection: "pending" } }, { upsert: true, returnDocument: "after" });
  const lastAction = businessCase.decisions?.at(-1)?.action;
  const workflowStatus = lastAction === 'PLACE_ON_HOLD' ? 'on_hold' : lastAction === 'ESCALATE' ? 'escalated' : lastAction === 'REQUEST_CLARIFICATION' ? 'awaiting_evidence' : result.findings.some((finding) => finding.severity !== 'info') ? 'needs_review' : 'reconciled';
  const updated = await BusinessCase.findOneAndUpdate({ companyId: businessCase.companyId, id: businessCase.id, revision: businessCase.revision }, { $set: { latestSnapshotId: snapshot.id, status: workflowStatus } }, { returnDocument: "after" });
  if (!updated) { const error = new Error("Case changed during reconciliation; result retained as historical only"); error.status = 409; throw error; }
  for (const decision of businessCase.decisions || []) {
    await recordAudit({ actor: { id: decision.actorId, role: decision.actorRole || 'ap_manager', companyId: businessCase.companyId }, action: `business.${decision.action.toLowerCase()}`, target: businessCase.id, meta: { decisionId: decision.id, snapshotId: decision.snapshotId } });
  }
  try { await projectSnapshot(snapshot); } catch { await BusinessSnapshot.updateOne({ companyId: snapshot.companyId, id: snapshot.id }, { $set: { projection: "pending" } }); }
  return result;
};
export const queueJob = async (businessCase) => {
  const input = await inputFor(businessCase);
  const job = await BusinessJob.create({ companyId: businessCase.companyId, id: crypto.randomUUID(), caseId: businessCase.id, baseRevision: businessCase.revision, input });
  return { id: job.id, status: job.status };
};
let working = false;
export const startWorker = () => {
  const timer = setInterval(async () => {
    if (working) return;
    working = true;
    try {
      const workerToken = crypto.randomUUID();
      const job = await BusinessJob.findOneAndUpdate({ $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lte: new Date() } }] }, { $set: { status: 'running', workerToken, leaseUntil: new Date(Date.now() + 120000) }, $inc: { attempts: 1 } }, { returnDocument: 'after', sort: { createdAt: 1 } });
      if (job) {
        try {
          const businessCase = await BusinessCase.findOne({ companyId: job.companyId, id: job.caseId, revision: job.baseRevision }).lean();
          if (!businessCase) throw new Error("Case revision changed; request reconciliation again");
          const result = await engine("reconcile", job.input);
          if (!(await BusinessJob.exists({ _id: job._id, workerToken, status: 'running' }))) throw new Error('Job lease changed');
          await publish(businessCase, job.input, result);
          await BusinessJob.updateOne({ _id: job._id, workerToken }, { $set: { status: "completed", snapshotId: result.snapshotId } });
        } catch (error) { await BusinessJob.updateOne({ _id: job._id, workerToken }, { $set: { status: "failed", error: error.status === 422 || error.status === 409 ? error.message : "Reconciliation failed; retry after checking service readiness" } }); }
      }
      const pending = await BusinessSnapshot.findOne({ projection: "pending" });
      if (pending) { try { await projectSnapshot(pending); } catch { } }
    } catch { console.error("Business worker dependency unavailable; retrying on the next poll"); }
    finally { working = false; }
  }, 1000);
  timer.unref();
};
