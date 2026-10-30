import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Case from "../models/Case.js";
import Snapshot from "../models/Snapshot.js";
import Finding from "../models/Finding.js";
import { enginePost } from "./engine.js";
import { ensurePolicy } from "./policies.js";
import { projectGraph } from "./graphProjection.js";
import { newId } from "../lib/ids.js";

// Reconcile orchestration (04 P2-B6): collect the case's document set, run
// the deterministic engine, persist an immutable snapshot + denormalised
// findings, bump the case revision.
export const collectCaseInputs = async (kase) => {
  const subjectDocs = await Document.find({ groupId: kase.groupId, id: { $in: kase.subjectIds } }).lean();
  const supplierIds = subjectDocs.flatMap((d) => [d.supplierId, d.seller?.supplierId].filter(Boolean));
  const extra = await Document.find({
    groupId: kase.groupId,
    id: { $nin: kase.subjectIds },
    $or: [
      { "lines.refs.poId": { $in: kase.subjectIds } },
      { "lines.refs.grnId": { $in: kase.subjectIds } },
      { "lines.refs.invoiceId": { $in: kase.subjectIds } },
      { "payment.allocations.documentId": { $in: kase.subjectIds } },
      { "seller.supplierId": { $in: supplierIds } },
      { supplierId: { $in: supplierIds } },
    ],
    status: { $nin: ["cancelled", "draft"] },
  }).lean();
  // second pass — payments/adjustments settle docs found in the first pass
  // (a payment allocates to the invoice, which references the PO — one hop out)
  const passIds = [...kase.subjectIds, ...extra.map((d) => d.id)];
  const second = await Document.find({
    groupId: kase.groupId,
    id: { $nin: passIds },
    $or: [
      { "payment.allocations.documentId": { $in: passIds } },
      { "lines.refs.invoiceId": { $in: passIds } },
      { "lines.refs.grnId": { $in: passIds } },
    ],
    status: { $nin: ["cancelled", "draft"] },
  }).lean();
  const documents = [...subjectDocs, ...extra, ...second];
  const ids = documents.map((d) => d.id);
  const links = await DocumentLink.find({ groupId: kase.groupId, $or: [{ fromId: { $in: ids } }, { toId: { $in: ids } }] }).lean();
  return { documents, links };
};

const DROP_NESTED = new Set(["packing", "remarks"]);

// strip mongo noise + server-only fields; Dates -> ISO (engine requires
// createdAt/updatedAt/createdBy as strings). The engine contract is
// extra-forbid — any field it doesn't know (UI/compute extras like
// rateSource, utgst, irn at doc level) must be dropped here or every
// reconcile on that supplier's docs dies 422.
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object") {
    if (v._bsontype === "ObjectID" || v._bsontype === "ObjectId") return String(v);
    return Object.fromEntries(Object.entries(v)
      .filter(([k]) => ![
        "_id", "__v", "supplierId",
        "approvals", "requiredApprovers", "contentHash", "issuedAt",
        "caseId", "taxSummary", "taxWarnings", "irn",
        "rateSource", "utgst",
      ].includes(k) && !DROP_NESTED.has(k) && v[k] !== undefined)
      .map(([k, x]) => [k, strip(x)]));
  }
  return v;
};

const toEntityPolicy = (_p, kase) => ({ entityId: kase.entityId });

// engine shipTo is a strict address {line1, city, stateCode, pincode, country}
// — mapped docs carry {label, state, pin, contact}. Reshape when a pincode
// exists, else drop it (optional evidence — better absent than fabricated).
const shapeDoc = (d) => {
  const doc = { ...d };
  // engine totals is required; imported docs often carry only line qty/rate —
  // derive the grand total from the lines instead of letting ledger read 0.
  if (!doc.totals || !doc.totals.grand) {
    const sum = (doc.lines || []).reduce((s, l) => s + (l.amount !== undefined ? Number(l.amount) : Number(l.qty || 0) * Number(l.rate || 0)), 0);
    if (sum > 0) {
      const zero = { amount: "0.00", currency: doc.currency || "INR" };
      doc.totals = { ...(doc.totals || {}), taxable: { amount: sum.toFixed(2), currency: doc.currency || "INR" }, cgst: zero, sgst: zero, igst: zero, cess: zero, roundOff: { ...zero }, grand: { amount: sum.toFixed(2), currency: doc.currency || "INR" } };
    }
  }
  if (doc.shipTo) {
    const s = doc.shipTo;
    const pincode = s.pincode || s.pin;
    doc.shipTo = pincode
      ? { line1: s.line1 || s.address || s.label || "—", city: s.city || "—", stateCode: s.stateCode || s.state || "—", pincode, country: s.country || "IN" }
      : undefined;
  }
  return doc;
};

// links are stricter than documents: no groupId/createdAt/updatedAt allowed.
const stripLink = (l) => {
  const { groupId, createdAt, updatedAt, ...rest } = strip(l);
  return rest;
};

// derive DocumentLinks from doc cross-refs — imported/seeded docs carry
// references (lines[].refs.poId, inspectionOf, payment.allocations) but the
// source systems never wrote DocumentLink rows, so reconcile + graph ran
// edgeless: ledger stayed empty and the money trail collapsed.
const deriveLinks = (documents) => {
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
        const kind = d.type === "GRN" ? "RECEIVES" : d.type === "INVOICE_IN" ? "BILLS" : d.type === "QC" ? "INSPECTS" : d.type === "PO_AMENDMENT" ? "AMENDS" : d.type === "TDS_ENTRY" ? "ADJUSTS" : null;
        if (kind && (key === "poId" || key === "grnId" || key === "invoiceId" || key === "paymentId" || key === "orderId")) push(d, toId, kind);
      }
    }
    if (d.type === "QC" && d.inspectionOf) push(d, d.inspectionOf, "INSPECTS");
    if (d.type === "PO_AMENDMENT" && d.amends) push(d, d.amends, "AMENDS");
    for (const a of d.payment?.allocations || []) {
      if (a.documentId) push(d, a.documentId, "SETTLES", { amount: { amount: String(a.amount), currency: "INR" }, basis: a.basis === "reviewer" ? "reviewer" : "reference" });
    }
  }
  const seen = new Set();
  return out.filter((l) => { const k = `${l.fromId}|${l.toId}|${l.kind}`; return seen.has(k) ? false : seen.add(k); });
};

export const runReconcile = async (payload, job) => {
  const { caseId, scenario } = payload;
  const kase = await Case.findOne({ id: caseId });
  if (!kase) throw Object.assign(new Error("Case not found"), { status: 404 });
  const { documents, links } = await collectCaseInputs(kase);
  // fill in links the source data never persisted, so ledger + graph are real
  const derived = deriveLinks(documents);
  if (derived.length) {
    const known = new Set(links.map((l) => `${l.fromId}|${l.toId}|${l.kind}`));
    const fresh = derived.filter((l) => !known.has(`${l.fromId}|${l.toId}|${l.kind}`));
    if (fresh.length) {
      await DocumentLink.bulkWrite(fresh.map((l) => ({ updateOne: { filter: { id: l.id }, update: { $setOnInsert: l }, upsert: true } })));
      links.push(...fresh);
    }
  }
  const entityPolicy = toEntityPolicy(await ensurePolicy(kase.entityId, kase.groupId), kase);
  const result = await enginePost("/v2/reconcile/case", {
    caseId, entityPolicy, ...(payload.knowledgeTime ? { knowledgeTime: payload.knowledgeTime } : {}),
    documents: strip(documents.map(shapeDoc)), links: links.map(stripLink), reviews: payload.reviews || {},
    ...(scenario ? { scenario } : {}),
  }, { timeoutMs: 60000 });

  const snapshot = await Snapshot.findOneAndUpdate(
    { groupId: kase.groupId, id: result.snapshotId || `snp_${job.id}` },
    { $setOnInsert: { caseId, groupId: kase.groupId, knowledgeTime: job.payload.knowledgeTime, engineVersion: result.engineVersion, modelVersion: result.modelVersion, result, inputs: { documentIds: documents.map((d) => d.id) }, scenario: Boolean(scenario) } },
    { upsert: true, new: true }
  );
  if (!scenario) {
    await Finding.deleteMany({ caseId, status: "open" });
    if (result.findings?.length) {
      await Finding.insertMany(result.findings.map((f) => ({
        id: f.id || newId("fnd"), groupId: kase.groupId, entityId: kase.entityId, caseId,
        snapshotId: snapshot.id, code: f.code, title: f.title,
        severity: f.severity, certainty: f.certainty, status: "open", data: f,
      })));
    }
    await Case.updateOne({ id: caseId }, { $set: { latestSnapshotId: snapshot.id }, $inc: { revision: 1 } });
    // Neo4j is a derived store — projection failure must never fail the job;
    // /cases/:id/graph falls back to snapshot.graph.
    try { if (result.graph) await projectGraph(kase.groupId, snapshot.id, result.graph); }
    catch (e) { console.warn("graph projection skipped:", e.message); }
  }
  return { snapshotId: snapshot.id, scenario: Boolean(scenario), findings: result.findings?.length || 0 };
};
