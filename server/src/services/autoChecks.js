// Automatic checks after data changes. Anything that creates or confirms
// documents, imports files or changes links calls scheduleAutoCheck(); the
// job runner then (debounced, in the background):
//   1. binds references that were waiting for this document (a GRN imported
//      before its PO, a debit note before its invoice);
//   2. attaches the documents to the right case(s) — the PO's case, created
//      on demand, for invoices/GRNs/notes that reference a PO and payments
//      whose allocations/links reach one;
//   3. asks the ML linking service (services/matching.js autoLink) for links
//      and suggestions — optional, degrades gracefully when absent;
//   4. re-runs GSTR-2B matching when invoices or 2B entries changed;
//   5. queues a debounced reconcile per affected case.
// Bounded per job (documents processed in chunks; reconcile jobs staggered)
// so a 5,000-row import does not spike memory on a 512 MB instance.
import Document from "../models/Document.js";
import DocumentLink from "../models/DocumentLink.js";
import Case from "../models/Case.js";
import Job from "../models/Job.js";
import ImportRun from "../models/ImportRun.js";
import { newId } from "../lib/ids.js";
import { ensureCaseForPo } from "./documents.js";
import { runGstr2bMatch } from "./gstr2bMatch.js";

const CHUNK = 200;
const LIVE_PO = ["issued", "acknowledged", "partially_fulfilled", "fulfilled", "short_closed"];
export const AUTOCHECK_DELAY_MS = Number(process.env.AUTOCHECK_DELAY_MS || 3000);
export const RECONCILE_DEBOUNCE_MS = Number(process.env.RECONCILE_DEBOUNCE_MS || 8000);
const MAX_DEBOUNCE_WAIT_MS = 60000;
const normNo = (n) => String(n || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Debounced job: one queued job per key; later calls push runAfter out (up
 * to MAX_DEBOUNCE_WAIT_MS after the first) and merge array payload fields.
 */
export const enqueueDebounced = async (kind, key, payload, groupId, delayMs, merge = {}) => {
  const now = Date.now();
  const existing = await Job.findOne({ kind, groupId, status: "queued", "payload.debounceKey": key }, { _id: 1, createdAt: 1 }).lean();
  if (existing) {
    const capped = Math.min(now + delayMs, new Date(existing.createdAt).getTime() + MAX_DEBOUNCE_WAIT_MS);
    const update = { $set: { runAfter: new Date(Math.max(capped, now)) } };
    const add = Object.fromEntries(Object.entries(merge).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => [`payload.${k}`, { $each: v }]));
    if (Object.keys(add).length) update.$addToSet = add;
    const res = await Job.updateOne({ _id: existing._id, status: "queued" }, update);
    if (res.modifiedCount) return { jobId: null, merged: true };
  }
  const job = await Job.create({ id: newId("job"), kind, groupId, status: "queued", runAfter: new Date(now + delayMs), payload: { ...payload, ...merge, debounceKey: key } });
  return { jobId: job.id, merged: false };
};

/** Queue a reconcile for a case, collapsing bursts into one run. */
export const enqueueReconcileDebounced = (groupId, caseId, delayMs = RECONCILE_DEBOUNCE_MS) =>
  enqueueDebounced("reconcile", `reconcile:${caseId}`, { caseId, trigger: "auto" }, groupId, delayMs);

/**
 * Entry point for routes/importers: never throws (a failed schedule must not
 * fail the user's request). Large id lists are split across jobs.
 */
export const scheduleAutoCheck = async ({ groupId, documentIds = [], reason = "change", importRunId = null }) => {
  try {
    const ids = [...new Set(documentIds.filter(Boolean))];
    if (!ids.length || !groupId) return null;
    if (ids.length > 500) {
      const jobs = [];
      for (let i = 0; i < ids.length; i += 500) {
        jobs.push(await Job.create({ id: newId("job"), kind: "autocheck", groupId, status: "queued", runAfter: new Date(Date.now() + AUTOCHECK_DELAY_MS + i * 10), payload: { documentIds: ids.slice(i, i + 500), reasons: [reason], importRunIds: importRunId ? [importRunId] : [] } }));
      }
      return { jobs: jobs.length };
    }
    return await enqueueDebounced("autocheck", `autocheck:${groupId}`, {}, groupId, AUTOCHECK_DELAY_MS, {
      documentIds: ids, reasons: [reason], importRunIds: importRunId ? [importRunId] : [],
    });
  } catch (e) {
    console.warn(`[autocheck] could not schedule (${reason}): ${e.message}`);
    return null;
  }
};

// ---------- 1. late binding of references ----------
const PENDING_FIELDS = { id: 1, type: 1, lines: 1, seller: 1, supplierId: 1, source: 1 };
export const bindPendingRefs = async (groupId, newDocs) => {
  const targets = newDocs.filter((d) => ["PO", "GRN", "INVOICE_IN"].includes(d.type) && d.number);
  if (!targets.length) return [];
  const pending = await Document.find({ groupId, "source.pendingRefs": true }, PENDING_FIELDS).limit(2000).lean();
  if (!pending.length) return [];
  const byNo = { PO: new Map(), GRN: new Map(), INVOICE_IN: new Map() };
  for (const t of targets) byNo[t.type].set(normNo(t.number), t);
  const sameParty = (a, b) => !b.supplierId || !a.supplierId || a.supplierId === b.supplierId || (a.seller?.gstin && a.seller.gstin === b.seller?.gstin);
  const updated = [];
  for (const d of pending) {
    let changed = false;
    const lines = (d.lines || []).map((l) => {
      const refs = { ...(l.refs || {}) };
      if (refs.poNumber) {
        const po = byNo.PO.get(normNo(refs.poNumber));
        if (po && sameParty(d, po)) {
          refs.poId = po.id;
          const m = (po.lines || []).find((x) => (l.sku && x.sku === l.sku) || x.description === l.description) || ((po.lines || []).length === 1 ? po.lines[0] : null);
          if (m) refs.poLineNo = m.lineNo;
          delete refs.poNumber; changed = true;
        }
      }
      if (refs.grnNumber) {
        const grn = byNo.GRN.get(normNo(refs.grnNumber));
        if (grn && sameParty(d, grn)) { refs.grnId = grn.id; delete refs.grnNumber; changed = true; }
      }
      if (refs.invoiceNumber) {
        const inv = byNo.INVOICE_IN.get(normNo(refs.invoiceNumber));
        if (inv && sameParty(d, inv)) { refs.invoiceId = inv.id; delete refs.invoiceNumber; changed = true; }
      }
      return { ...l, refs };
    });
    if (!changed) continue;
    const stillPending = lines.some((l) => l.refs?.poNumber || l.refs?.grnNumber || l.refs?.invoiceNumber);
    await Document.updateOne({ groupId, id: d.id }, { $set: { lines, "source.pendingRefs": stillPending, "source.boundAt": new Date().toISOString() } });
    updated.push(d.id);
  }
  return updated;
};

// ---------- 2. case attachment ----------
const CASE_FIELDS = { id: 1, groupId: 1, entityId: 1, type: 1, number: 1, externalRef: 1, seller: 1, status: 1, caseId: 1, lines: 1, payment: 1 };

/** PO ids reachable from documents (refs, GRN/invoice hops, payment allocations, SETTLES / REPORTED_IN links). */
export const poIdsFor = async (groupId, docs) => {
  const poIds = new Set();
  const hop = new Set();
  for (const d of docs) {
    if (d.type === "PO" || d.type === "PO_AMENDMENT") poIds.add(d.id);
    for (const l of d.lines || []) {
      if (l.refs?.poId) poIds.add(l.refs.poId);
      if (l.refs?.grnId) hop.add(l.refs.grnId);
      if (l.refs?.invoiceId) hop.add(l.refs.invoiceId);
    }
    for (const a of d.payment?.allocations || []) if (a.documentId) hop.add(a.documentId);
  }
  const ids = docs.map((d) => d.id);
  const links = await DocumentLink.find({ groupId, $or: [{ fromId: { $in: ids }, kind: { $in: ["SETTLES", "ADJUSTS", "BILLS", "RECEIVES", "RETURNS", "REPORTED_IN"] } }, { toId: { $in: ids }, kind: "REPORTED_IN" }] }, { fromId: 1, toId: 1, kind: 1 }).lean();
  for (const l of links) { hop.add(l.toId); if (l.kind === "REPORTED_IN") hop.add(l.fromId); }
  for (const id of ids) hop.delete(id);
  if (hop.size) {
    const second = await Document.find({ groupId, id: { $in: [...hop] } }, { id: 1, type: 1, lines: 1 }).lean();
    for (const d of second) {
      if (d.type === "PO") poIds.add(d.id);
      for (const l of d.lines || []) if (l.refs?.poId) poIds.add(l.refs.poId);
    }
  }
  return [...poIds];
};

export const attachToCases = async (groupId, docs) => {
  const caseIds = new Set(docs.map((d) => d.caseId).filter(Boolean));
  const poIds = await poIdsFor(groupId, docs);
  let created = 0;
  const poCase = new Map();
  if (poIds.length) {
    const pos = await Document.find({ groupId, id: { $in: poIds }, type: { $in: ["PO", "PO_AMENDMENT"] }, status: { $in: LIVE_PO } }, CASE_FIELDS).lean();
    for (const po of pos) {
      const had = po.caseId || (await Case.exists({ groupId, kind: "po", subjectIds: po.id }));
      const caseId = await ensureCaseForPo(po);
      if (!had) created++;
      poCase.set(po.id, caseId);
      caseIds.add(caseId);
    }
  }
  // stamp caseId on documents that have none yet (first PO case they reach)
  for (const d of docs) {
    if (d.caseId) continue;
    const pid = d.type === "PO" ? d.id : (d.lines || []).map((l) => l.refs?.poId).find((p) => poCase.has(p));
    const cid = pid ? poCase.get(pid) : null;
    if (cid) await Document.updateOne({ groupId, id: d.id, $or: [{ caseId: { $exists: false } }, { caseId: null }] }, { $set: { caseId: cid } });
  }
  return { caseIds: [...caseIds], casesCreated: created };
};

// ---------- 3. ML linking (optional module) ----------
let matchingModule;
const loadMatching = async () => {
  if (matchingModule !== undefined) return matchingModule;
  try { matchingModule = await import("./matching.js"); } catch (e) {
    if (e?.code !== "ERR_MODULE_NOT_FOUND") console.warn(`[autocheck] matching module failed to load: ${e.message}`);
    matchingModule = null;
  }
  return matchingModule;
};
export const resetMatchingModuleCache = () => { matchingModule = undefined; };

export const callAutoLink = async (groupId, documentIds) => {
  const mod = await loadMatching();
  if (!mod || typeof mod.autoLink !== "function") return { available: false, linksCreated: 0, suggestions: 0 };
  try {
    const r = await mod.autoLink({ groupId, documentIds });
    const suggestions = Array.isArray(r?.suggestions) ? r.suggestions.length : Number(r?.suggestions || 0);
    const linksCreated = Array.isArray(r?.linksCreated) ? r.linksCreated.length : Number(r?.linksCreated || 0);
    return { available: true, linksCreated, suggestions };
  } catch (e) {
    console.warn(`[autocheck] autoLink failed — continuing without ML links: ${e.message}`);
    return { available: true, linksCreated: 0, suggestions: 0, error: e.message };
  }
};

// ---------- job handler ----------
export const runAutoCheck = async (payload, job) => {
  const groupId = job?.groupId || payload.groupId;
  const ids = [...new Set(payload.documentIds || [])];
  const summary = { documents: ids.length, bound: 0, casesCreated: 0, caseIds: [], linksCreated: 0, suggestions: 0, mlAvailable: null, gstr2b: null, reconcileQueued: 0 };
  const allCases = new Set();
  const entities2b = new Set();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let docs = await Document.find({ groupId, id: { $in: chunk }, status: { $nin: ["draft", "cancelled", "rejected"] } }, { ...CASE_FIELDS, date: 1, supplierId: 1 }).lean();
    const bound = await bindPendingRefs(groupId, docs);
    summary.bound += bound.length;
    if (bound.length) docs = [...docs, ...(await Document.find({ groupId, id: { $in: bound } }, CASE_FIELDS).lean())];
    for (const d of docs) if (d.type === "INVOICE_IN" || d.type === "GSTR2B_ENTRY") entities2b.add(d.entityId);

    const ml = await callAutoLink(groupId, docs.map((d) => d.id));
    summary.mlAvailable = ml.available;
    summary.linksCreated += ml.linksCreated;
    summary.suggestions += ml.suggestions;

    const { caseIds, casesCreated } = await attachToCases(groupId, docs);
    summary.casesCreated += casesCreated;
    caseIds.forEach((c) => allCases.add(c));
  }
  // GSTR-2B match per entity that got invoices or 2B entries
  for (const entityId of entities2b) {
    const has2b = await Document.exists({ groupId, entityId, type: "GSTR2B_ENTRY" });
    if (!has2b) continue;
    try {
      const { stats, changedInvoiceIds } = await runGstr2bMatch({ groupId, entityId });
      summary.gstr2b = stats;
      if (changedInvoiceIds.length) {
        const invs = await Document.find({ groupId, id: { $in: changedInvoiceIds.slice(0, 2000) } }, CASE_FIELDS).lean();
        const { caseIds } = await attachToCases(groupId, invs);
        caseIds.forEach((c) => allCases.add(c));
      }
    } catch (e) {
      console.warn(`[autocheck] GSTR-2B match failed for ${entityId}: ${e.message}`);
    }
  }
  let n = 0;
  for (const caseId of allCases) {
    await enqueueReconcileDebounced(groupId, caseId, RECONCILE_DEBOUNCE_MS + n * 1500);
    n++;
  }
  summary.reconcileQueued = n;
  summary.caseIds = [...allCases].slice(0, 200);
  for (const runId of payload.importRunIds || []) {
    // several autocheck jobs can serve one run (large imports): accumulate
    await ImportRun.updateOne({ groupId, id: runId }, {
      $set: { "checks.at": new Date().toISOString(), "checks.mlAvailable": summary.mlAvailable, ...(summary.gstr2b ? { "checks.gstr2b": summary.gstr2b } : {}) },
      $inc: { "checks.documents": summary.documents, "checks.bound": summary.bound, "checks.casesCreated": summary.casesCreated, "checks.linksCreated": summary.linksCreated, "checks.suggestions": summary.suggestions, "checks.reconcileQueued": summary.reconcileQueued },
      $addToSet: { caseIds: { $each: summary.caseIds } },
    }).catch((e) => console.warn(`[autocheck] import run ${runId} not updated: ${e.message}`));
  }
  return summary;
};
