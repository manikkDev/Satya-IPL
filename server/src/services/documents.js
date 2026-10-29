import crypto from "node:crypto";
import Document from "../models/Document.js";
import Case from "../models/Case.js";
import { ensurePolicy } from "./policies.js";
import { newId } from "../lib/ids.js";

// Canonical JSON for contentHash: sorted keys, volatile fields removed
// (04 P2-B4) — the hash proves the issued content, not record metadata.
const VOLATILE = new Set(["_id", "__v", "createdAt", "updatedAt", "contentHash", "issuedAt", "observedAt", "caseId"]);
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).filter((k) => !VOLATILE.has(k)).sort().map((k) => [k, canonicalize(value[k])])
    );
  }
  return value;
};

export const contentHashOf = (doc) =>
  crypto.createHash("sha256").update(JSON.stringify(canonicalize(doc.toObject ? doc.toObject() : doc))).digest("hex");

// Best-known document value for DoA routing: computed grand total when the
// engine ran, else a taxable-value estimate from lines+charges (no GST) —
// routing on ₹0 would silently demote every uncomputed draft to the lowest tier.
export const estimateGrand = (doc) =>
  doc.totals?.grand ?? (
    (doc.lines || []).reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0) +
    (doc.charges || []).reduce((sum, c) => sum + (Number(c.amount) || 0), 0)
  ).toFixed(2);

// DoA routing (01 §8 + policy.doa): smallest covering maxAmount rule wins;
// no covering rule means it escalates to group_admin.
export const requiredApproversFor = async (entityId, groupId, docType, grandTotal) => {
  const policy = await ensurePolicy(entityId, groupId);
  const total = Number(grandTotal || 0);
  const rules = (policy?.doa || []).filter((r) => r.docType === docType && Number(r.maxAmount) >= total)
    .sort((a, b) => Number(a.maxAmount) - Number(b.maxAmount));
  return rules.length ? rules[0].roles : ["group_admin"];
};

// Lifecycle aggregation per PO line (fallback when no engine snapshot — the
// result is labelled approximate:true per 04 P2-B4). Sums linked documents
// by line refs: GRN->RECEIVES, QC->INSPECTS, INVOICE_IN->BILLS.
const dec = (v) => (v === undefined || v === null ? 0 : Number(v) || 0);

export const lineLifecycle = async (po) => {
  const perLine = new Map();
  for (const line of po.lines || []) {
    perLine.set(line.lineNo, {
      lineNo: line.lineNo,
      ordered: dec(line.qty),
      received: 0, accepted: 0, rejected: 0, invoiced: 0, invoicedValue: "0.00", paid: 0, open: dec(line.qty),
    });
  }
  const inbound = await Document.find({
    groupId: po.groupId,
    type: { $in: ["GRN", "QC", "INVOICE_IN", "RETURN"] },
    "lines.refs.poId": po.id,
    status: { $nin: ["cancelled", "reversed", "rejected"] },
  }).lean();
  let approximate = true;
  for (const doc of inbound) {
    for (const line of doc.lines || []) {
      const poLineNo = line.refs?.poLineNo ?? line.lineNo;
      const counter = perLine.get(poLineNo);
      if (!counter) continue;
      if (doc.type === "GRN") counter.received += dec(line.qty);
      if (doc.type === "QC") { counter.accepted += dec(line.acceptedQty ?? line.qty); counter.rejected += dec(line.rejectedQty); }
      if (doc.type === "INVOICE_IN") { counter.invoiced += dec(line.qty); counter.invoicedValue = (Number(counter.invoicedValue) + dec(line.lineTotal ?? dec(line.qty) * dec(line.rate))).toFixed(2); }
      if (doc.type === "RETURN") counter.rejected += dec(line.qty);
    }
  }
  const lines = [...perLine.values()].map((l) => ({ ...l, open: Math.max(0, l.ordered - l.received) }));
  return { lines, approximate };
};

// Auto-create the investigation case for an issued PO (04 P2-B6 expands).
export const ensureCaseForPo = async (doc) => {
  if (doc.caseId) return doc.caseId;
  let kase = await Case.findOne({ groupId: doc.groupId, kind: "po", subjectIds: doc.id });
  if (!kase) {
    kase = await Case.create({
      id: newId("case"), groupId: doc.groupId, entityId: doc.entityId, kind: "po",
      subjectIds: [doc.id],
      title: `${doc.type === "PO" ? "PO" : doc.type} ${doc.number || doc.externalRef || doc.id} — ${doc.seller?.legalName || doc.seller?.name || "supplier"}`,
    });
  }
  await Document.updateOne({ id: doc.id }, { $set: { caseId: kase.id } });
  return kase.id;
};

export const newDocId = () => newId("doc");
