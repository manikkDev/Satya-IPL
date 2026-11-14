import crypto from "node:crypto";
import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Case from "../models/Case.js";
import { ensurePolicy } from "./policies.js";
import { newId } from "../lib/ids.js";
import { settledPaiseFor } from "./settlement.js";
import { toPaise, fromPaise, cmp, grandOf, mulRate, rawAmount } from "../lib/money.js";

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
export const estimateGrand = (doc) => grandOf(doc);

// DoA routing (01 §8 + policy.doa): smallest covering maxAmount rule wins;
// no covering rule means it escalates to group_admin. Exact paise compare —
// Number({amount}) used to be NaN, which escalated every document.
export const requiredApproversFor = async (entityId, groupId, docType, grandTotal) => {
  const policy = await ensurePolicy(entityId, groupId);
  const total = toPaise(grandTotal);
  const rules = (policy?.doa || []).filter((r) => r.docType === docType && toPaise(r.maxAmount) >= total)
    .sort((a, b) => cmp(a.maxAmount, b.maxAmount));
  return rules.length ? rules[0].roles : ["group_admin"];
};

// Lifecycle aggregation per PO line (fallback when no engine snapshot — the
// result is labelled approximate:true per 04 P2-B4).
//  ordered   PO line qty
//  received  GRN line qty (refs.poId/poLineNo)
//  accepted  QC acceptedQty — QC lines may reference the PO line directly or
//            the GRN line they inspected; with no QC for a line, accepted =
//            received (acceptedBasis "receipt" says so)
//  invoiced  invoice line qty; invoicedValue its exact ₹ value
//  paidValue ₹ settled on the invoices behind the line (allocations/SETTLES),
//            attributed by the line's share of each invoice, plus advances
//            settled straight to the PO
//  paid      units — only units of invoice lines whose invoice is fully
//            settled (exact); partially-paid invoices contribute ₹, not units
const qtyNum = (v) => {
  const raw = rawAmount(v);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const lineValue = (l) => toPaise(l.lineTotal ?? l.taxableValue ?? mulRate(l.rate, String(rawAmount(l.qty) ?? "0")));

export const lineLifecycle = async (po) => {
  const perLine = new Map();
  for (const line of po.lines || []) {
    perLine.set(line.lineNo, {
      lineNo: line.lineNo, ordered: qtyNum(line.qty),
      received: 0, accepted: 0, rejected: 0, invoiced: 0, invoicedValue: "0.00", paid: 0, open: qtyNum(line.qty),
      _qc: false, _inv: 0n, _paid: 0n,
    });
  }
  const live = { $nin: ["cancelled", "reversed", "rejected", "draft"] };
  const fields = { id: 1, type: 1, lines: 1, totals: 1, inspectionOf: 1 };
  const direct = await Document.find({ groupId: po.groupId, type: { $in: ["GRN", "QC", "INVOICE_IN", "RETURN"] }, "lines.refs.poId": po.id, status: live }, fields).lean();
  const grns = direct.filter((d) => d.type === "GRN");
  const grnIds = grns.map((d) => d.id);
  const qcViaGrn = grnIds.length
    ? await Document.find({ groupId: po.groupId, type: "QC", status: live, id: { $nin: direct.map((d) => d.id) }, $or: [{ inspectionOf: { $in: grnIds } }, { "lines.refs.grnId": { $in: grnIds } }] }, fields).lean()
    : [];
  const grnLine = new Map(); // `${grnId}:${lineNo}` -> poLineNo
  for (const g of grns) for (const l of g.lines || []) grnLine.set(`${g.id}:${l.lineNo}`, l.refs?.poLineNo ?? l.lineNo);

  const invoices = [];
  for (const doc of [...direct, ...qcViaGrn]) {
    for (const line of doc.lines || []) {
      let poLineNo = line.refs?.poId === po.id ? (line.refs?.poLineNo ?? line.lineNo) : undefined;
      if (poLineNo === undefined && doc.type === "QC") {
        const grnId = line.refs?.grnId || doc.inspectionOf;
        poLineNo = grnLine.get(`${grnId}:${line.refs?.grnLineNo ?? line.lineNo}`);
      }
      const counter = perLine.get(poLineNo);
      if (!counter) continue;
      if (doc.type === "GRN") counter.received += qtyNum(line.qty);
      if (doc.type === "QC") {
        counter._qc = true;
        const acc = line.acceptedQty !== undefined ? qtyNum(line.acceptedQty) : Math.max(0, qtyNum(line.qty) - qtyNum(line.rejectedQty));
        counter.accepted += acc;
        counter.rejected += qtyNum(line.rejectedQty);
      }
      if (doc.type === "INVOICE_IN") { counter.invoiced += qtyNum(line.qty); counter._inv += lineValue(line); }
      if (doc.type === "RETURN") counter.rejected += qtyNum(line.qty);
    }
    if (doc.type === "INVOICE_IN") invoices.push(doc);
  }

  // money settled on the invoices, attributed per PO line by value share
  const settled = await settledPaiseFor(po.groupId, invoices.map((i) => i.id));
  for (const inv of invoices) {
    const paidOnInv = settled.get(inv.id) || 0n;
    if (paidOnInv <= 0n) continue;
    const invLines = inv.lines || [];
    const totalValue = invLines.reduce((s, l) => s + lineValue(l), 0n);
    const grand = toPaise(grandOf(inv));
    const fullyPaid = grand > 0n && paidOnInv >= grand;
    for (const l of invLines) {
      if (l.refs?.poId !== po.id) continue;
      const counter = perLine.get(l.refs?.poLineNo ?? l.lineNo);
      if (!counter) continue;
      counter._paid += totalValue > 0n ? (paidOnInv * lineValue(l)) / totalValue : 0n;
      if (fullyPaid) counter.paid += qtyNum(l.qty);
    }
  }
  // advances: SETTLES straight to the PO from payers that did not also settle
  // one of its invoices (seeds link a payment to both — count it once)
  const invoicePayers = new Set([...settled.payers.values()].flatMap((s) => [...s]));
  const advances = await DocumentLink.find({ groupId: po.groupId, toId: po.id, kind: "SETTLES" }, { fromId: 1, amount: 1 }).lean();
  const advancePaise = advances.filter((l) => !invoicePayers.has(l.fromId)).reduce((s, l) => s + toPaise(l.amount), 0n);

  const lines = [...perLine.values()].map(({ _qc, _inv, _paid, ...l }) => ({
    ...l,
    accepted: _qc ? l.accepted : l.received,
    acceptedBasis: _qc ? "qc" : "receipt",
    invoicedValue: fromPaise(_inv),
    paidValue: fromPaise(_paid),
    open: Math.max(0, l.ordered - l.received),
  }));
  return { lines, approximate: true, advancePaid: fromPaise(advancePaise), paidUnitsBasis: "fully_settled_invoices" };
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
