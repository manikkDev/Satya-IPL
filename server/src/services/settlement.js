import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import { toPaise, fromPaise, grandOf } from "../lib/money.js";

// How much of each document has been settled, in integer paise.
//
// Sources: a payment's own payment.allocations[] (source of truth written by
// the allocation workbench and imports), SETTLES links (written alongside
// allocations, derived by reconcile, or for credit notes), and credit notes
// raised against an invoice (lines.refs.invoiceId or an ADJUSTS/SETTLES link)
// — a credit note reduces what is due exactly like a payment does.
// Each (payer, target) pair counts once, so a payment recorded both as an
// allocation and a link is never double-counted.
export const PAYMENT_TYPES = ["PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT", "ADVANCE_IN"];
const CREDIT_TYPES = ["CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"];
const LIVE = { $nin: ["draft", "cancelled", "reversed"] };

export const settledPaiseFor = async (groupId, targetIds, { credits = true } = {}) => {
  const ids = [...new Set((targetIds || []).filter(Boolean))];
  const settled = new Map();
  // payers per target, for callers that must not count the same payment
  // twice (e.g. a payment linked to both an invoice and its PO)
  settled.payers = new Map();
  settled.credited = new Map();
  if (!ids.length) return settled;
  const addPayer = (target, payer) => {
    if (!settled.payers.has(target)) settled.payers.set(target, new Set());
    settled.payers.get(target).add(payer);
  };
  const [payments, links, creditDocs] = await Promise.all([
    Document.find(
      { groupId, type: { $in: PAYMENT_TYPES }, status: LIVE, "payment.allocations.documentId": { $in: ids } },
      { id: 1, "payment.allocations": 1 },
    ).lean(),
    DocumentLink.find({ groupId, kind: { $in: credits ? ["SETTLES", "ADJUSTS"] : ["SETTLES"] }, toId: { $in: ids } }, { fromId: 1, toId: 1, amount: 1, kind: 1 }).lean(),
    credits ? Document.find({ groupId, type: { $in: CREDIT_TYPES }, status: LIVE, "lines.refs.invoiceId": { $in: ids } }, { id: 1, lines: 1, totals: 1, charges: 1 }).lean() : [],
  ]);
  const wanted = new Set(ids);
  const seenPairs = new Set();
  const add = (target, payer, paise) => {
    seenPairs.add(`${payer}|${target}`);
    addPayer(target, payer);
    settled.set(target, (settled.get(target) || 0n) + paise);
  };
  for (const p of payments) {
    for (const a of p.payment?.allocations || []) {
      if (wanted.has(a.documentId)) add(a.documentId, p.id, toPaise(a.amount));
    }
  }
  // credit notes: the note's value against each invoice it references
  const creditIds = new Set();
  for (const c of creditDocs) {
    creditIds.add(c.id);
    const targets = [...new Set((c.lines || []).map((l) => l.refs?.invoiceId).filter((t) => wanted.has(t)))];
    if (!targets.length) continue;
    const value = toPaise(grandOf(c));
    // split evenly when one note references several invoices (rare)
    const each = value / BigInt(targets.length);
    for (const t of targets) {
      if (seenPairs.has(`${c.id}|${t}`)) continue;
      add(t, c.id, each);
      settled.credited.set(t, (settled.credited.get(t) || 0n) + each);
    }
  }
  const linkSources = links.filter((l) => l.kind === "ADJUSTS").map((l) => l.fromId).filter((id) => !creditIds.has(id));
  const adjustingCredits = linkSources.length && credits
    ? new Map((await Document.find({ groupId, id: { $in: linkSources }, type: { $in: CREDIT_TYPES }, status: LIVE }, { id: 1, totals: 1, lines: 1, charges: 1 }).lean()).map((d) => [d.id, d]))
    : new Map();
  for (const l of links) {
    if (seenPairs.has(`${l.fromId}|${l.toId}`)) continue;
    if (l.kind === "ADJUSTS") {
      const note = adjustingCredits.get(l.fromId);
      if (!note) continue; // ADJUSTS from TDS entries etc. are not settlement
      const value = l.amount ? toPaise(l.amount) : toPaise(grandOf(note));
      add(l.toId, l.fromId, value);
      settled.credited.set(l.toId, (settled.credited.get(l.toId) || 0n) + value);
      continue;
    }
    add(l.toId, l.fromId, toPaise(l.amount));
  }
  return settled;
};

export const settledFor = async (groupId, targetIds) => {
  const paise = await settledPaiseFor(groupId, targetIds);
  return new Map([...paise.entries()].map(([k, v]) => [k, fromPaise(v)]));
};
