import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Case from "../models/Case.js";
import Snapshot from "../models/Snapshot.js";
import Finding from "../models/Finding.js";
import { enginePost } from "./engine.js";
import { ensurePolicy } from "./policies.js";
import { newId } from "../lib/ids.js";

// Reconcile orchestration (04 P2-B6): collect the case's document set, run
// the deterministic engine, persist an immutable snapshot + denormalised
// findings, bump the case revision.
export const collectCaseInputs = async (kase) => {
  const subjectDocs = await Document.find({ groupId: kase.groupId, id: { $in: kase.subjectIds } }).lean();
  const extra = await Document.find({
    groupId: kase.groupId,
    id: { $nin: kase.subjectIds },
    $or: [
      { "lines.refs.poId": { $in: kase.subjectIds } },
      { supplierId: { $in: subjectDocs.map((d) => d.supplierId).filter(Boolean) } },
    ],
    status: { $nin: ["cancelled", "draft"] },
  }).lean();
  const documents = [...subjectDocs, ...extra];
  const ids = documents.map((d) => d.id);
  const links = await DocumentLink.find({ groupId: kase.groupId, $or: [{ fromId: { $in: ids } }, { toId: { $in: ids } }] }).lean();
  return { documents, links };
};

// strip mongo noise + server-only fields; Dates -> ISO (engine requires
// createdAt/updatedAt/createdBy as strings). NOTE: engine EntityPolicy per
// A's live schema is {entityId} — the richer 02 §6.1 policy block was not
// adopted by A's contract.
const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object") {
    if (v._bsontype === "ObjectID" || v._bsontype === "ObjectId") return String(v);
    return Object.fromEntries(Object.entries(v)
      .filter(([k]) => ![
        "_id", "__v",
        "approvals", "requiredApprovers", "contentHash", "issuedAt",
        "caseId", "taxSummary", "taxWarnings",
      ].includes(k) && v[k] !== undefined)
      .map(([k, x]) => [k, strip(x)]));
  }
  return v;
};

const toEntityPolicy = (_p, kase) => ({ entityId: kase.entityId });

export const runReconcile = async (payload, job) => {
  const { caseId, scenario } = payload;
  const kase = await Case.findOne({ id: caseId });
  if (!kase) throw Object.assign(new Error("Case not found"), { status: 404 });
  const { documents, links } = await collectCaseInputs(kase);
  const entityPolicy = toEntityPolicy(await ensurePolicy(kase.entityId, kase.groupId), kase);
  const result = await enginePost("/v2/reconcile/case", {
    caseId, entityPolicy, ...(payload.knowledgeTime ? { knowledgeTime: payload.knowledgeTime } : {}),
    documents: strip(documents), links: strip(links), reviews: payload.reviews || {},
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
  }
  return { snapshotId: snapshot.id, scenario: Boolean(scenario), findings: result.findings?.length || 0 };
};
