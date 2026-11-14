import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import { toPaise, fromPaise } from "../lib/money.js";

// How much of each document has been settled, in integer paise.
//
// Two sources record settlement: a payment's own payment.allocations[] (the
// source of truth written by the allocation workbench and by imports/seeds)
// and SETTLES links (written alongside allocations, derived by reconcile, or
// created for credit notes). Counting both double-counts the same money, so
// a link only adds when its (payer, target) pair has no allocation row.
export const PAYMENT_TYPES = ["PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT", "ADVANCE_IN"];

export const settledPaiseFor = async (groupId, targetIds) => {
  const ids = [...new Set((targetIds || []).filter(Boolean))];
  const settled = new Map();
  if (!ids.length) return settled;
  const [payments, links] = await Promise.all([
    Document.find(
      { groupId, type: { $in: PAYMENT_TYPES }, status: { $nin: ["draft", "cancelled", "reversed"] }, "payment.allocations.documentId": { $in: ids } },
      { id: 1, "payment.allocations": 1 },
    ).lean(),
    DocumentLink.find({ groupId, kind: "SETTLES", toId: { $in: ids } }, { fromId: 1, toId: 1, amount: 1 }).lean(),
  ]);
  const wanted = new Set(ids);
  const seenPairs = new Set();
  for (const p of payments) {
    for (const a of p.payment?.allocations || []) {
      if (!wanted.has(a.documentId)) continue;
      seenPairs.add(`${p.id}|${a.documentId}`);
      settled.set(a.documentId, (settled.get(a.documentId) || 0n) + toPaise(a.amount));
    }
  }
  for (const l of links) {
    if (seenPairs.has(`${l.fromId}|${l.toId}`)) continue;
    seenPairs.add(`${l.fromId}|${l.toId}`);
    settled.set(l.toId, (settled.get(l.toId) || 0n) + toPaise(l.amount));
  }
  return settled;
};

export const settledFor = async (groupId, targetIds) => {
  const paise = await settledPaiseFor(groupId, targetIds);
  return new Map([...paise.entries()].map(([k, v]) => [k, fromPaise(v)]));
};
