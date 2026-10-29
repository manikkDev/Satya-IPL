import Policy from "../models/Policy.js";
import { ensurePolicy, DEFAULT_NUMBERING } from "./policies.js";

// Atomic document numbering per entity/FY/series (04 P2-B4). Pattern tokens:
// {ENT}=entity code, {DOC}=doc type, {FY}=short Indian FY ("26-27"), {SEQ:n}.
export const renderNumber = (pattern, { entityCode, docType, fy, seq }) =>
  pattern
    .replaceAll("{ENT}", entityCode)
    .replaceAll("{DOC}", docType)
    .replaceAll("{FY}", fy.slice(2)) // "2026-27" -> "26-27"
    .replace(/\{SEQ:(\d+)\}/, (_m, width) => String(seq).padStart(Number(width), "0"));

const defaultPattern = (docType) =>
  (DEFAULT_NUMBERING.find((n) => n.docType === docType) || { pattern: "{ENT}/{DOC}/{FY}/{SEQ:6}" }).pattern;

// One atomic findOneAndUpdate per issue; on FY rollover it inserts a fresh
// series entry for that year and retries once (unique sequence guaranteed).
export const nextNumber = async (entityId, groupId, entityCode, docType, fy, attempt = 0) => {
  await ensurePolicy(entityId, groupId);
  const updated = await Policy.findOneAndUpdate(
    { entityId, "numbering.docType": docType, "numbering.fy": fy },
    { $inc: { "numbering.$.nextSeq": 1 } },
    { new: true }
  );
  if (updated) {
    const series = updated.numbering.find((n) => n.docType === docType && n.fy === fy);
    return { number: renderNumber(series.pattern, { entityCode, docType, fy, seq: series.nextSeq - 1 }), seq: series.nextSeq - 1, fy };
  }
  // No series for this FY yet — create one starting at 2, then take seq 1.
  const policy = await Policy.findOne({ entityId });
  const inherited = policy.numbering.find((n) => n.docType === docType)?.pattern || defaultPattern(docType);
  await Policy.updateOne(
    { entityId, "numbering": { $not: { $elemMatch: { docType, fy } } } },
    { $push: { numbering: { docType, pattern: inherited, nextSeq: 1, fy } } }
  );
  if (attempt > 3) throw new Error(`Numbering failed for ${docType}/${fy}`);
  return nextNumber(entityId, groupId, entityCode, docType, fy, attempt + 1);
};
