import crypto from "node:crypto";
import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Case from "../models/Case.js";
import Snapshot from "../models/Snapshot.js";
import Finding from "../models/Finding.js";
import Decision from "../models/Decision.js";
import { enginePost } from "./engine.js";
import { ensurePolicy } from "./policies.js";
import { projectGraph } from "./graphProjection.js";
import { toEngineInputs } from "./engineProjection.js";

const LIVE = { $nin: ["cancelled", "draft"] };
// link kinds that make the source document part of the target's chain
const CHAIN_LINK_KINDS = ["FULFILS", "RECEIVES", "INSPECTS", "BILLS", "SETTLES", "ADJUSTS", "AMENDS", "RETURNS", "DUPLICATE_OF", "SAME_AS"];
const MAX_HOPS = 4;
const MAX_DOCS = 400;

// Reconcile orchestration (04 P2-B6): collect the case's document set, run
// the deterministic engine, persist an immutable snapshot + findings, bump
// the case revision.
//
// A PO case is scoped to the PO's own evidence chain: documents that
// reference it (GRN/QC/invoice/amendment/return), documents that reference
// those (QC of a GRN, credit notes against an invoice), payments allocated
// or SETTLES-linked to any of them, and TDS/adjustments on those payments —
// plus anything explicitly stamped with this caseId. It no longer pulls in
// every document of the supplier, which leaked findings across POs and
// double-counted balances on the dashboard. Supplier-period/custom cases
// keep supplier-wide collection.
export const collectCaseInputs = async (kase) => {
  const groupId = kase.groupId;
  const subjectDocs = await Document.find({ groupId, id: { $in: kase.subjectIds } }).lean();
  const byId = new Map(subjectDocs.map((d) => [d.id, d]));
  let frontier = [...byId.keys()];

  if (kase.kind === "supplier_period" || kase.kind === "custom") {
    const supplierIds = subjectDocs.flatMap((d) => [d.supplierId, d.seller?.supplierId].filter(Boolean));
    if (supplierIds.length) {
      const supplierDocs = await Document.find({
        groupId, id: { $nin: [...byId.keys()] }, status: LIVE,
        $or: [{ "seller.supplierId": { $in: supplierIds } }, { supplierId: { $in: supplierIds } }],
      }).limit(MAX_DOCS).lean();
      for (const d of supplierDocs) byId.set(d.id, d);
      frontier = [...byId.keys()];
    }
  }

  for (let hop = 0; hop < MAX_HOPS && frontier.length && byId.size < MAX_DOCS; hop++) {
    const known = [...byId.keys()];
    const [referencing, chainLinks] = await Promise.all([
      Document.find({
        groupId, id: { $nin: known }, status: LIVE,
        $or: [
          { "lines.refs.poId": { $in: frontier } },
          { "lines.refs.grnId": { $in: frontier } },
          { "lines.refs.invoiceId": { $in: frontier } },
          { inspectionOf: { $in: frontier } },
          { amends: { $in: frontier } },
          { supersedes: { $in: frontier } },
          { "payment.allocations.documentId": { $in: frontier } },
          ...(hop === 0 ? [{ caseId: kase.id }] : []),
        ],
      }).limit(MAX_DOCS).lean(),
      DocumentLink.find({ groupId, toId: { $in: frontier }, kind: { $in: CHAIN_LINK_KINDS } }, { fromId: 1 }).lean(),
    ]);
    const next = [];
    for (const d of referencing) if (!byId.has(d.id)) { byId.set(d.id, d); next.push(d.id); }
    const linkedIds = [...new Set(chainLinks.map((l) => l.fromId))].filter((id) => !byId.has(id));
    if (linkedIds.length) {
      const linked = await Document.find({ groupId, id: { $in: linkedIds }, status: LIVE }).lean();
      for (const d of linked) if (!byId.has(d.id)) { byId.set(d.id, d); next.push(d.id); }
    }
    frontier = next;
  }

  const documents = [...byId.values()].slice(0, MAX_DOCS);
  const ids = documents.map((d) => d.id);
  const links = await DocumentLink.find({ groupId, fromId: { $in: ids }, toId: { $in: ids } }).lean();
  return { documents, links };
};

// derive DocumentLinks from doc cross-refs — imported/seeded docs carry
// references (lines[].refs.poId, inspectionOf, payment.allocations) but the
// source systems never wrote DocumentLink rows, so reconcile + graph ran
// edgeless: ledger stayed empty and the money trail collapsed.
export const deriveLinks = (documents) => {
  const ids = new Set(documents.map((d) => d.id));
  const out = [];
  const push = (d, toId, kind, extra = {}) => {
    if (!toId || String(toId) === d.id || !ids.has(String(toId))) return;
    out.push({ id: `lnk_${d.id}_${kind}_${toId}`, groupId: d.groupId, fromId: d.id, toId: String(toId), kind, certainty: "CONFIRMED", basis: "reference", createdBy: "satya:derive", ...extra });
  };
  for (const d of documents) {
    for (const l of d.lines || []) {
      for (const [key, target] of Object.entries(l.refs || {})) {
        const toId = typeof target === "object" ? target?.id || target?.documentId : target;
        const kind = d.type === "GRN" ? "RECEIVES" : d.type === "INVOICE_IN" ? "BILLS" : d.type === "QC" ? "INSPECTS" : d.type === "PO_AMENDMENT" ? "AMENDS" : d.type === "TDS_ENTRY" ? "ADJUSTS" : d.type === "CREDIT_NOTE_IN" ? "ADJUSTS" : null;
        if (kind && (key === "poId" || key === "grnId" || key === "invoiceId" || key === "paymentId" || key === "orderId")) push(d, toId, kind);
      }
    }
    if (d.type === "QC" && d.inspectionOf) push(d, d.inspectionOf, "INSPECTS");
    if (d.type === "PO_AMENDMENT" && d.amends) push(d, d.amends, "AMENDS");
    for (const a of d.payment?.allocations || []) {
      if (!a.documentId) continue;
      if (d.type === "TDS_ENTRY") push(d, a.documentId, "ADJUSTS");
      else push(d, a.documentId, "SETTLES", { amount: { amount: String(a.amount), currency: "INR" }, basis: a.basis === "reviewer" ? "reviewer" : "reference" });
    }
  }
  const seen = new Set();
  return out.filter((l) => { const k = `${l.fromId}|${l.toId}|${l.kind}`; return seen.has(k) ? false : seen.add(k); });
};

// Stable finding identity: the engine emits no ids, so a fresh random id
// per run orphaned every decision. Same case + code + evidence = same finding.
export const stableFindingId = (caseId, f) => {
  if (f.id) return String(f.id);
  const evidence = (f.evidence || []).map((e) => `${e.documentId || ""}:${e.lineNo ?? ""}`).sort().join(",");
  return `fnd_${crypto.createHash("sha256").update(`${caseId}|${f.code}|${evidence}`).digest("hex").slice(0, 24)}`;
};

// Idempotent finding persistence. Findings a human decided on (resolved /
// accepted_risk, or with any decision row) keep their status; open ones are
// refreshed in place; open findings the engine no longer reports are removed
// (or auto-resolved when a decision references them). Duplicate-key races
// are absorbed instead of failing the job.
export const persistFindings = async (kase, snapshotId, engineFindings) => {
  const existing = await Finding.find({ groupId: kase.groupId, caseId: kase.id }).sort({ updatedAt: -1 }).lean();
  const latestById = new Map();
  for (const f of existing) if (!latestById.has(f.id)) latestById.set(f.id, f);
  const decided = new Set(await Decision.distinct("findingId", { groupId: kase.groupId, caseId: kase.id, findingId: { $ne: null } }));
  const seen = new Set();
  for (const f of engineFindings || []) {
    const id = stableFindingId(kase.id, f);
    if (seen.has(id)) continue;
    seen.add(id);
    const data = { ...f, id };
    const prior = latestById.get(id);
    try {
      if (prior) {
        await Finding.updateOne({ _id: prior._id }, {
          $set: { snapshotId, code: f.code, title: f.title || prior.title, severity: f.severity, certainty: f.certainty, data, entityId: kase.entityId },
        });
      } else {
        await Finding.create({
          id, groupId: kase.groupId, entityId: kase.entityId, caseId: kase.id, snapshotId,
          code: f.code, title: f.title, severity: f.severity, certainty: f.certainty, status: "open", data,
        });
      }
    } catch (error) {
      if (error?.code !== 11000) throw error; // concurrent run already wrote it
    }
  }
  const gone = [...latestById.values()].filter((f) => f.status === "open" && !seen.has(f.id));
  const keep = gone.filter((f) => decided.has(f.id)).map((f) => f._id);
  const drop = gone.filter((f) => !decided.has(f.id)).map((f) => f._id);
  if (keep.length) await Finding.updateMany({ _id: { $in: keep } }, { $set: { status: "resolved", "data.resolvedBy": "reconcile", "data.resolvedAtSnapshot": snapshotId } });
  if (drop.length) await Finding.deleteMany({ _id: { $in: drop } });
  return { written: seen.size, autoResolved: keep.length, removed: drop.length };
};

const toEntityPolicy = (_p, kase) => ({ entityId: kase.entityId });

export const runReconcile = async (payload, job) => {
  const { caseId, scenario } = payload;
  const kase = await Case.findOne({ id: caseId, ...(job?.groupId ? { groupId: job.groupId } : {}) });
  if (!kase) throw Object.assign(new Error("Case not found"), { status: 404 });
  const { documents, links } = await collectCaseInputs(kase);
  // fill in links the source data never persisted, so ledger + graph are real
  const derived = deriveLinks(documents);
  if (derived.length) {
    const known = new Set(links.map((l) => `${l.fromId}|${l.toId}|${l.kind}`));
    const fresh = derived.filter((l) => !known.has(`${l.fromId}|${l.toId}|${l.kind}`));
    if (fresh.length) {
      await DocumentLink.bulkWrite(fresh.map((l) => ({ updateOne: { filter: { groupId: l.groupId, id: l.id }, update: { $setOnInsert: l }, upsert: true } })), { ordered: false })
        .catch((e) => { if (e?.code !== 11000) throw e; });
      links.push(...fresh);
    }
  }
  const engineInput = toEngineInputs(documents, links);
  if (!engineInput.documents.length) {
    throw Object.assign(new Error(`No documents in case ${caseId} satisfy the engine contract (${engineInput.skipped.length} skipped)`), { status: 422 });
  }
  const entityPolicy = toEntityPolicy(await ensurePolicy(kase.entityId, kase.groupId), kase);
  const result = await enginePost("/v2/reconcile/case", {
    caseId, entityPolicy, ...(payload.knowledgeTime ? { knowledgeTime: payload.knowledgeTime } : {}),
    documents: engineInput.documents, links: engineInput.links, reviews: payload.reviews || {},
    ...(scenario ? { scenario } : {}),
  }, { timeoutMs: 60000 });

  const snapshot = await Snapshot.findOneAndUpdate(
    { groupId: kase.groupId, id: result.snapshotId || `snp_${job.id}` },
    { $setOnInsert: {
      caseId, groupId: kase.groupId, knowledgeTime: job?.payload?.knowledgeTime, engineVersion: result.engineVersion, modelVersion: result.modelVersion, result,
      inputs: { documentIds: engineInput.documents.map((d) => d.id), skipped: engineInput.skipped, synthesized: engineInput.synthesized },
      scenario: Boolean(scenario),
    } },
    { upsert: true, returnDocument: "after" }
  );
  let findingStats = null;
  if (!scenario) {
    findingStats = await persistFindings(kase, snapshot.id, result.findings);
    await Case.updateOne({ id: caseId, groupId: kase.groupId }, { $set: { latestSnapshotId: snapshot.id }, $inc: { revision: 1 } });
    // Neo4j is a derived store — projection failure must never fail the job;
    // /cases/:id/graph falls back to snapshot.graph.
    try { if (result.graph) await projectGraph(kase.groupId, snapshot.id, result.graph); }
    catch (e) { if (e.code !== "GRAPH_DISABLED") console.warn("graph projection skipped:", e.message); }
  }
  return { snapshotId: snapshot.id, scenario: Boolean(scenario), findings: result.findings?.length || 0, skipped: engineInput.skipped.length, ...(findingStats ? { findingStats } : {}) };
};
