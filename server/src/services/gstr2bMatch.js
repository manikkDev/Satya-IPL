// GSTR-2B <-> purchase-invoice matching.
//
// Key: supplier GSTIN + normalised invoice number + financial year. When no
// exact key matches, a number variant is tried (FY tokens and leading zeros
// dropped: "SIS/26-27/0226" ~ "SIS/2026-27/226") and labelled as such.
// Values are compared with a tolerance (default ₹1 on tax and on the
// invoice value — rounding-off differences). Outcome per document:
//   matched          books and 2B agree
//   amount_differs   same invoice, taxable/tax/value differ beyond tolerance
//   only_in_books    invoice dated inside the imported 2B periods, not in 2B
//                    (supplier has not filed / filed wrongly -> ITC at risk)
//   pending_2b       invoice dated after the latest imported 2B period
//   only_in_2b       supplier reported it; no purchase invoice in books
// Results are stored on the documents (INVOICE_IN gst.gstr2b, GSTR2B_ENTRY
// gst.match) and as REPORTED_IN links (invoice -> 2B entry) so reconcile
// pulls the 2B entry into the invoice's case and the engine's GST checks
// see it.
import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Supplier from "../models/Supplier.js";
import Group from "../models/Group.js";
import { fyOf } from "../lib/fy.js";
import { toPaise, fromPaise, grandOf, taxOf, taxableOf } from "../lib/money.js";

const LIVE = { $nin: ["draft", "cancelled", "reversed", "rejected"] };
export const normNo = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Looser number key: FY tokens removed, numeric groups without leading zeros. */
export const variantNo = (n) => String(n || "").toUpperCase()
  .replace(/\b(20)?\d{2}\s*[-/]\s*(20)?\d{2}\b/g, " ")
  .replace(/\b(FY|F\.Y\.)\b/g, " ")
  .split(/[^A-Z0-9]+/).filter(Boolean)
  .map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join("");

const absP = (v) => (v < 0n ? -v : v);

export const toleranceFor = async (groupId) => {
  const g = await Group.findOne({ id: groupId }, { settings: 1 }).lean().catch(() => null);
  const t = g?.settings?.gstr2b?.tolerance || {};
  return { tax: toPaise(t.tax ?? "1.00"), value: toPaise(t.value ?? "1.00") };
};

/** Compare one books invoice with one 2B entry. */
export const compareValues = (inv, entry, tol) => {
  const tax = toPaise(taxOf(entry)) - toPaise(taxOf(inv));
  const value = toPaise(grandOf(entry)) - toPaise(grandOf(inv));
  const taxable = toPaise(taxableOf(entry)) - toPaise(taxableOf(inv));
  const differs = absP(tax) > tol.tax || absP(value) > tol.value;
  return { differs, diff: { tax: fromPaise(tax), value: fromPaise(value), taxable: fromPaise(taxable) } };
};

/**
 * Pure matcher over arrays (unit-testable).
 * books: INVOICE_IN docs with resolved `_gstin`; entries: GSTR2B_ENTRY docs.
 */
export const matchSets = (books, entries, tol, periods) => {
  const minP = periods[0] || null;
  const maxP = periods[periods.length - 1] || null;
  const exact = new Map();
  const loose = new Map();
  for (const e of entries) {
    const gstin = String(e.seller?.gstin || "").toUpperCase();
    const fy = e.fy || fyOf(e.date);
    const k = `${gstin}|${normNo(e.number)}|${fy}`;
    if (!exact.has(k)) exact.set(k, e);
    const v = `${gstin}|${variantNo(e.number)}|${fy}`;
    if (!loose.has(v)) loose.set(v, []);
    loose.get(v).push(e);
  }
  const usedEntries = new Set();
  const invoiceResults = [];
  for (const inv of books) {
    const gstin = String(inv._gstin || "").toUpperCase();
    const fy = inv.fy || fyOf(inv.date);
    let entry = gstin ? exact.get(`${gstin}|${normNo(inv.number)}|${fy}`) : null;
    let basis = "exact";
    if (entry && usedEntries.has(entry.id)) entry = null;
    if (!entry && gstin) {
      const cands = (loose.get(`${gstin}|${variantNo(inv.number)}|${fy}`) || []).filter((e) => !usedEntries.has(e.id));
      if (cands.length === 1) { entry = cands[0]; basis = "number_variant"; }
    }
    if (entry) {
      usedEntries.add(entry.id);
      const cmp = compareValues(inv, entry, tol);
      invoiceResults.push({ invoiceId: inv.id, entryId: entry.id, status: cmp.differs ? "amount_differs" : "matched", basis, diff: cmp.diff, period: entry.gst?.gstr2bPeriod || null });
      continue;
    }
    const month = String(inv.date || "").slice(0, 7);
    if (!gstin) invoiceResults.push({ invoiceId: inv.id, entryId: null, status: "no_gstin", basis: null, period: null });
    else if (maxP && month > maxP) invoiceResults.push({ invoiceId: inv.id, entryId: null, status: "pending_2b", basis: null, period: null });
    else if (minP && month < minP) invoiceResults.push({ invoiceId: inv.id, entryId: null, status: "before_2b_import", basis: null, period: null });
    else invoiceResults.push({ invoiceId: inv.id, entryId: null, status: "only_in_books", basis: null, period: month });
  }
  const entryResults = entries.map((e) => {
    const hit = invoiceResults.find((r) => r.entryId === e.id);
    return hit
      ? { entryId: e.id, invoiceId: hit.invoiceId, status: hit.status, basis: hit.basis, diff: hit.diff }
      : { entryId: e.id, invoiceId: null, status: "only_in_2b", basis: null };
  });
  return { invoiceResults, entryResults };
};

/**
 * Run the match for an entity (all imported periods) and persist outcomes.
 * Returns {stats, changedInvoiceIds}.
 */
export const runGstr2bMatch = async ({ groupId, entityId }) => {
  const scope = { groupId, ...(entityId ? { entityId } : {}) };
  const entries = await Document.find({ ...scope, type: "GSTR2B_ENTRY", status: LIVE }, { id: 1, number: 1, date: 1, fy: 1, seller: 1, totals: 1, gst: 1, entityId: 1 }).lean();
  if (!entries.length) return { stats: { entries: 0 }, changedInvoiceIds: [] };
  const periods = [...new Set(entries.map((e) => e.gst?.gstr2bPeriod || String(e.date).slice(0, 7)))].sort();
  const fys = [...new Set(entries.map((e) => e.fy || fyOf(e.date)))];
  const books = await Document.find({ ...scope, type: "INVOICE_IN", status: LIVE, fy: { $in: fys } }, { id: 1, number: 1, date: 1, fy: 1, seller: 1, supplierId: 1, totals: 1, lines: 1, charges: 1, gst: 1 }).lean();
  // resolve a GSTIN for books invoices whose seller block lacks one
  const needs = [...new Set(books.filter((b) => !b.seller?.gstin).map((b) => b.supplierId || b.seller?.supplierId).filter(Boolean))];
  const sup = needs.length ? new Map((await Supplier.find({ groupId, id: { $in: needs } }, { id: 1, gstins: 1 }).lean()).map((s) => [s.id, s.gstins?.[0]?.gstin])) : new Map();
  for (const b of books) b._gstin = b.seller?.gstin || sup.get(b.supplierId || b.seller?.supplierId) || "";
  const tol = await toleranceFor(groupId);
  const { invoiceResults, entryResults } = matchSets(books, entries, tol, periods);

  const at = new Date().toISOString();
  const before = new Map(books.map((b) => [b.id, b.gst?.gstr2b?.status ? `${b.gst.gstr2b.status}|${b.gst.gstr2b.entryId || ""}` : null]));
  const changedInvoiceIds = invoiceResults.filter((r) => before.get(r.invoiceId) !== `${r.status}|${r.entryId || ""}`).map((r) => r.invoiceId);
  const ops = [
    ...invoiceResults.map((r) => ({ updateOne: { filter: { groupId, id: r.invoiceId }, update: { $set: { "gst.gstr2b": { status: r.status, entryId: r.entryId, basis: r.basis, diff: r.diff || null, period: r.period, periods: [periods[0], periods.at(-1)], at } } } } })),
    ...entryResults.map((r) => ({ updateOne: { filter: { groupId, id: r.entryId }, update: { $set: { "gst.match": { status: r.status, invoiceId: r.invoiceId, basis: r.basis, diff: r.diff || null, at } } } } })),
  ];
  for (let i = 0; i < ops.length; i += 500) await Document.bulkWrite(ops.slice(i, i + 500), { ordered: false });

  // REPORTED_IN links: invoice -> 2B entry (replace stale ones)
  const linked = invoiceResults.filter((r) => r.entryId);
  const wanted = new Set(linked.map((r) => `lnk_2b_${r.invoiceId}_${r.entryId}`));
  const entryIds = entries.map((e) => e.id);
  await DocumentLink.deleteMany({ groupId, kind: "REPORTED_IN", toId: { $in: entryIds }, id: { $nin: [...wanted] } });
  const linkOps = linked.map((r) => ({
    updateOne: {
      filter: { groupId, id: `lnk_2b_${r.invoiceId}_${r.entryId}` },
      update: { $set: { certainty: r.status === "matched" ? "CONFIRMED" : "PROBABLE" }, $setOnInsert: { groupId, id: `lnk_2b_${r.invoiceId}_${r.entryId}`, fromId: r.invoiceId, toId: r.entryId, kind: "REPORTED_IN", basis: "rule", createdBy: "satya:gstr2b-match" } },
      upsert: true,
    },
  }));
  for (let i = 0; i < linkOps.length; i += 500) await DocumentLink.bulkWrite(linkOps.slice(i, i + 500), { ordered: false }).catch((e) => { if (e?.code !== 11000) throw e; });

  const count = (arr, s) => arr.filter((r) => r.status === s).length;
  const stats = {
    entries: entries.length, invoices: books.length, periods,
    matched: count(invoiceResults, "matched"), amountDiffers: count(invoiceResults, "amount_differs"),
    onlyInBooks: count(invoiceResults, "only_in_books"), pending2b: count(invoiceResults, "pending_2b"),
    onlyIn2b: count(entryResults, "only_in_2b"), numberVariant: invoiceResults.filter((r) => r.basis === "number_variant").length,
    tolerance: { tax: fromPaise(tol.tax), value: fromPaise(tol.value) },
  };
  return { stats, changedInvoiceIds };
};
