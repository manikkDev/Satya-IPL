import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import LinkSuggestion from "../models/LinkSuggestion.js";
import Case from "../models/Case.js";
import Supplier from "../models/Supplier.js";
import { enginePost } from "./engine.js";
import { settledPaiseFor } from "./settlement.js";
import { enqueue } from "../jobs/runner.js";
import { newId } from "../lib/ids.js";
import { toPaise, fromPaise, grandOf } from "../lib/money.js";

// Live document linking (ML). The engine's calibrated link models
// (/v2/link/suggest) propose INVOICE_IN→PO (BILLS), GRN→PO (RECEIVES) and
// PAYMENT_OUT→INVOICE_IN (SETTLES) links for documents that carry no explicit
// reference. Decision zones come from the model card:
//   auto   → DocumentLink {certainty: "PROBABLE", basis: "model",
//            confidence, createdBy: "model:<version>"} + LinkSuggestion(auto_linked)
//   review → LinkSuggestion(pending) for a person (routes/v2/matching.js)
// Model links are never CONFIRMED; a reviewer accept upgrades them, a reject
// removes them and becomes a training label.

const LINKABLE = ["PO", "GRN", "INVOICE_IN", "PAYMENT_OUT"];
const KINDS = ["BILLS", "RECEIVES", "SETTLES"];
const LIVE = { $nin: ["cancelled", "draft", "reversed"] };
const POOL_LIMIT = 3000;
const POOL_DAYS = 450;
const FIELDS = { id: 1, type: 1, number: 1, date: 1, status: 1, entityId: 1, seller: 1, supplierId: 1, lines: 1, totals: 1, payment: 1, externalRef: 1, terms: 1, caseId: 1 };

const daysBefore = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

// Mongo document → the lenient shape the engine's linking projection reads.
const toEngineDoc = (d, openPaise) => {
  const out = {
    id: d.id, type: d.type, number: d.number || "", date: d.date, status: d.status,
    externalRef: d.externalRef, seller: { ...(d.seller || {}), supplierId: d.seller?.supplierId || d.supplierId },
    lines: (d.lines || []).map((l) => ({
      lineNo: l.lineNo, description: l.description, sku: l.sku, itemId: l.itemId, hsn: l.hsn, uom: l.uom,
      qty: l.qty != null ? String(l.qty) : undefined, rate: l.rate != null ? String(l.rate) : undefined,
      taxableValue: l.taxableValue != null ? String(l.taxableValue) : undefined,
      lineTotal: l.lineTotal != null ? String(l.lineTotal) : undefined, refs: l.refs || undefined,
    })),
  };
  if (d.totals) out.totals = Object.fromEntries(Object.entries(d.totals).map(([k, v]) => [k, v == null ? v : String(v?.amount ?? v)]));
  if (d.payment) {
    out.payment = {
      amount: d.payment.amount != null ? fromPaise(toPaise(d.payment.amount)) : undefined,
      utr: d.payment.utr, narration: d.payment.narration || d.payment.remarks, valueDate: d.payment.valueDate,
      tdsAmount: d.payment.tdsAmount != null ? fromPaise(toPaise(d.payment.tdsAmount)) : undefined,
      allocations: d.payment.allocations?.length ? d.payment.allocations.map((a) => ({ documentId: a.documentId })) : undefined,
    };
  }
  if (d.terms?.creditDays != null) out.terms = { creditDays: Number(d.terms.creditDays) };
  if (openPaise !== undefined) out.openAmount = fromPaise(openPaise < 0n ? 0n : openPaise);
  return out;
};

const linkKey = (l) => `${l.fromId}|${l.toId}|${l.kind}`;

/**
 * Run the link models over the documents touched by an import / creation.
 * @param {{groupId: string, documentIds?: string[], enqueueReconcile?: boolean}} args
 * @returns {Promise<{linksCreated: number, suggestions: Array<{fromId, toId, kind, score, zone, reasons: string[]}>,
 *   reviewQueued?: number, affectedCaseIds?: string[], modelVersions?: object, error?: object}>}
 * Never throws for engine outages (returns error + zero links) so callers
 * such as imports are not failed by the ML layer.
 */
export const autoLink = async ({ groupId, documentIds = [], enqueueReconcile = true } = {}) => {
  if (!groupId) throw Object.assign(new Error("groupId is required"), { status: 422 });
  const seeds = documentIds.length
    ? await Document.find({ groupId, id: { $in: documentIds }, type: { $in: LINKABLE }, status: LIVE }, FIELDS).lean()
    : [];
  const entityIds = [...new Set(seeds.map((d) => d.entityId))];
  if (documentIds.length && !seeds.length) return { linksCreated: 0, suggestions: [] };
  const newest = seeds.reduce((m, d) => (d.date > m ? d.date : m), "0000-00-00");
  const poolFilter = { groupId, type: { $in: LINKABLE }, status: LIVE };
  if (entityIds.length) poolFilter.entityId = { $in: entityIds };
  if (seeds.length) poolFilter.date = { $gte: daysBefore(newest, POOL_DAYS) };
  const pool = await Document.find(poolFilter, FIELDS).sort({ date: -1 }).limit(POOL_LIMIT).lean();
  const byId = new Map(pool.map((d) => [d.id, d]));
  for (const s of seeds) byId.set(s.id, s);
  const docs = [...byId.values()];

  // decide which documents may be the "from" side of a new link: the seeds
  // themselves, plus — when a seed is a link *target* (PO / invoice) — every
  // unlinked document of the matching source type in the pool.
  const seedTypes = new Set(seeds.map((d) => d.type));
  const fromIds = new Set(seeds.filter((d) => ["GRN", "INVOICE_IN", "PAYMENT_OUT"].includes(d.type)).map((d) => d.id));
  if (!documentIds.length || seedTypes.has("PO")) docs.filter((d) => d.type === "GRN" || d.type === "INVOICE_IN").forEach((d) => fromIds.add(d.id));
  if (!documentIds.length || seedTypes.has("INVOICE_IN")) docs.filter((d) => d.type === "PAYMENT_OUT").forEach((d) => fromIds.add(d.id));
  if (!fromIds.size) return { linksCreated: 0, suggestions: [] };

  const ids = docs.map((d) => d.id);
  const [existing, rejected, settled] = await Promise.all([
    DocumentLink.find({ groupId, kind: { $in: KINDS }, fromId: { $in: [...fromIds] } }, { fromId: 1, toId: 1, kind: 1 }).lean(),
    LinkSuggestion.find({ groupId, status: "rejected", fromId: { $in: [...fromIds] } }, { fromId: 1, toId: 1, kind: 1 }).lean(),
    settledPaiseFor(groupId, docs.filter((d) => d.type === "INVOICE_IN").map((d) => d.id)),
  ]);
  const engineDocs = docs.map((d) => toEngineDoc(d, d.type === "INVOICE_IN" ? toPaise(grandOf(d)) - (settled.get(d.id) || 0n) : undefined));

  let result;
  try {
    result = await enginePost("/v2/link/suggest", {
      documents: engineDocs, fromIds: [...fromIds],
      existingLinks: existing.map(({ fromId, toId, kind }) => ({ fromId, toId, kind })),
      rejected: rejected.map(({ fromId, toId, kind }) => ({ fromId, toId, kind })),
    }, { timeoutMs: 60000 });
  } catch (error) {
    return { linksCreated: 0, suggestions: [], error: { code: error.code || "UPSTREAM_UNAVAILABLE", message: error.message } };
  }

  const existingKeys = new Set(existing.map(linkKey));
  const decided = new Map((await LinkSuggestion.find({ groupId, fromId: { $in: [...fromIds] }, status: { $in: ["accepted", "rejected"] } }, { fromId: 1, toId: 1, kind: 1 }).lean()).map((s) => [linkKey(s), true]));
  let linksCreated = 0;
  let reviewQueued = 0;
  const touched = new Set();
  const out = [];
  for (const s of result.suggestions || []) {
    const key = linkKey(s);
    if (decided.has(key)) continue; // a person already ruled on this pair
    const from = byId.get(s.fromId);
    const base = {
      groupId, entityId: from?.entityId, fromId: s.fromId, toId: s.toId, kind: s.kind,
      score: Number(s.score).toFixed(4), zone: s.zone, reasons: s.reasons || [], explanation: s.explanation || [],
      lineRefs: s.lineRefs || [], amount: s.amount ? { amount: s.amount, currency: "INR" } : undefined, modelVersion: s.modelVersion,
    };
    if (s.zone === "auto") {
      let linkId;
      if (!existingKeys.has(key)) {
        linkId = newId("lnk");
        try {
          await DocumentLink.create({
            id: linkId, groupId, fromId: s.fromId, toId: s.toId, kind: s.kind, certainty: "PROBABLE",
            confidence: base.score, basis: "model", createdBy: `model:${s.modelVersion}`, lineRefs: base.lineRefs,
            ...(s.amount ? { amount: { amount: s.amount, currency: "INR" } } : {}),
          });
          existingKeys.add(key);
          linksCreated += 1;
          touched.add(s.fromId).add(s.toId);
        } catch (error) {
          if (error?.code !== 11000) throw error;
        }
      }
      await LinkSuggestion.updateOne({ groupId, fromId: s.fromId, toId: s.toId, kind: s.kind },
        { $set: { ...base, status: "auto_linked", ...(linkId ? { linkId } : {}) }, $setOnInsert: { id: newId("lsg") } }, { upsert: true });
    } else {
      const res = await LinkSuggestion.updateOne({ groupId, fromId: s.fromId, toId: s.toId, kind: s.kind, status: { $in: ["pending", "superseded"] } },
        { $set: { ...base, status: "pending" } }).catch(() => null);
      if (!res?.matchedCount) {
        await LinkSuggestion.create({ id: newId("lsg"), ...base, status: "pending" }).catch((e) => { if (e?.code !== 11000) throw e; });
      }
      reviewQueued += 1;
    }
    out.push({ fromId: s.fromId, toId: s.toId, kind: s.kind, score: Number(s.score), zone: s.zone, reasons: s.reasons || [] });
  }

  let affectedCaseIds = [];
  if (touched.size) {
    const ids2 = [...touched];
    const docsCases = [...byId.values()].filter((d) => touched.has(d.id) && d.caseId).map((d) => d.caseId);
    const subjectCases = (await Case.find({ groupId, subjectIds: { $in: ids2 } }, { id: 1 }).lean()).map((c) => c.id);
    affectedCaseIds = [...new Set([...docsCases, ...subjectCases])];
    if (enqueueReconcile) {
      await Promise.all(affectedCaseIds.map((caseId) => enqueue("reconcile", { caseId }, groupId).catch(() => null)));
    }
  }
  return {
    linksCreated, suggestions: out, reviewQueued, affectedCaseIds,
    modelVersions: Object.fromEntries(Object.entries(result.models || {}).map(([k, v]) => [k, v.version || null])),
  };
};

// ------------------------------------------------------------ review actions
export const decideSuggestion = async ({ groupId, suggestion, verdict, actor, reason, decisionId }) => {
  const now = new Date();
  if (verdict === "accept") {
    let linkId = suggestion.linkId;
    const existing = await DocumentLink.findOne({ groupId, fromId: suggestion.fromId, toId: suggestion.toId, kind: suggestion.kind });
    if (existing) {
      await DocumentLink.updateOne({ _id: existing._id }, { $set: { certainty: "CONFIRMED", basis: "reviewer", createdBy: actor, decisionId } });
      linkId = existing.id;
    } else {
      linkId = newId("lnk");
      await DocumentLink.create({
        id: linkId, groupId, fromId: suggestion.fromId, toId: suggestion.toId, kind: suggestion.kind,
        certainty: "CONFIRMED", basis: "reviewer", createdBy: actor, decisionId, lineRefs: suggestion.lineRefs || [],
        ...(suggestion.amount ? { amount: suggestion.amount } : {}),
      });
    }
    await LinkSuggestion.updateOne({ _id: suggestion._id }, { $set: { status: "accepted", label: 1, linkId, decidedBy: actor, decidedAt: now, decisionReason: reason, decisionId } });
    // competing pending suggestions for the same source become superseded
    if (suggestion.kind !== "SETTLES") {
      await LinkSuggestion.updateMany({ groupId, fromId: suggestion.fromId, kind: suggestion.kind, status: "pending", _id: { $ne: suggestion._id } }, { $set: { status: "superseded" } });
    }
    return { status: "accepted", linkId };
  }
  // reject: remove a model-written link (never a reviewer/reference one)
  await DocumentLink.deleteMany({ groupId, fromId: suggestion.fromId, toId: suggestion.toId, kind: suggestion.kind, basis: "model" });
  await LinkSuggestion.updateOne({ _id: suggestion._id }, { $set: { status: "rejected", label: 0, decidedBy: actor, decidedAt: now, decisionReason: reason, decisionId } });
  return { status: "rejected" };
};

export const casesTouching = async (groupId, ids) => {
  const docs = await Document.find({ groupId, id: { $in: ids } }, { caseId: 1 }).lean();
  const subject = await Case.find({ groupId, subjectIds: { $in: ids } }, { id: 1 }).lean();
  return [...new Set([...docs.map((d) => d.caseId).filter(Boolean), ...subject.map((c) => c.id)])];
};

// ------------------------------------------------------- supplier duplicates
export const supplierDuplicates = async ({ groupId }) => {
  const suppliers = await Supplier.find({ groupId }, { id: 1, legalName: 1, tradeNames: 1, gstins: 1, pan: 1, bankAccounts: 1, addresses: 1, contacts: 1 }).limit(10000).lean();
  const records = suppliers.map((s) => ({
    id: s.id, name: s.legalName, tradeNames: s.tradeNames || [],
    gstins: (s.gstins || []).map((g) => g.gstin).filter(Boolean), pan: s.pan || undefined,
    bankHashes: (s.bankAccounts || []).map((b) => b.accountHash).filter(Boolean),
    pincode: (s.addresses || []).map((a) => a?.pin || a?.pincode).find(Boolean) || undefined,
    email: (s.contacts || []).map((c) => c?.email).find(Boolean) || undefined,
    phone: (s.contacts || []).map((c) => c?.phone).find(Boolean) || undefined,
  }));
  const result = await enginePost("/v2/suppliers/duplicates", { suppliers: records }, { timeoutMs: 30000 });
  const name = new Map(suppliers.map((s) => [s.id, s.legalName]));
  const named = (ids) => ids.map((id) => ({ id, name: name.get(id) || id }));
  return {
    clusters: (result.clusters || []).map((c) => ({ ...c, suppliers: named(c.supplierIds) })),
    possible: (result.possible || []).map((p) => ({ ...p, suppliers: named([p.a, p.b]) })),
    sameLegalEntity: (result.sameLegalEntity || []).map((e) => ({ ...e, suppliers: named(e.supplierIds) })),
    method: result.method, thresholds: result.thresholds, suppliersScanned: records.length,
    note: "Suggestions only — nothing is merged automatically",
  };
};
