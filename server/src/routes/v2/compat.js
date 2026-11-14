// Compat routes: client api surface names that B's route files don't mount.
// Thin shims over the same models — no new business logic lives here.
import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Case from "../../models/Case.js";
import Finding from "../../models/Finding.js";
import Supplier from "../../models/Supplier.js";
import Snapshot from "../../models/Snapshot.js";
import { handle, fail, assertPlainInput } from "./util.js";
import { caseGraph } from "../../services/graphProjection.js";
import { enginePost } from "../../services/engine.js";
import { settledPaiseFor } from "../../services/settlement.js";
import { acceptanceDates, msmeCategoryOf, msmeCovered, msmeDeadline } from "../../services/msme.js";
import { money, toPaise, fromPaise, grandOf, taxOf, taxableEstimate, toNumber, rawAmount } from "../../lib/money.js";

const router = express.Router();

// Humanise engine text: swap internal doc_* ids for real document numbers and
// format bare amounts. Findings reference ids because engines don't know
// display names — display layers should never show them raw. Batched: one
// lookup for every id in every message (was one query per finding).
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DOC_ID_RE = /doc_[\w]+/g;
const docIdFallback = (id) => {
  const m = id.match(/^doc_bpi_([a-z]+)_(\d+)(?:_\d+)?$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : id.replace(/^doc_/, "");
};
const docNameMap = async (texts, groupId, extraIds = []) => {
  const ids = [...new Set([...texts.flatMap((t) => [...String(t || "").matchAll(DOC_ID_RE)].map((m) => m[0])), ...extraIds.filter(Boolean)])];
  if (!ids.length) return new Map();
  const docs = await Document.find({ groupId, id: { $in: ids } }, { id: 1, number: 1, externalRef: 1 }).lean();
  return new Map(docs.map((d) => [d.id, d.number ?? d.externalRef ?? docIdFallback(d.id)]));
};
const humanizeWith = (map, text) => {
  if (!text) return text;
  return String(text).replace(DOC_ID_RE, (id) => map.get(id) ?? docIdFallback(id))
    .replace(/invoiced (\d+(?:\.\d+)?) exceeds delivered (\d+(?:\.\d+)?)/gi, (_m, a, b) => `invoiced ${a} units, only ${b} delivered`)
    .replace(/(\d+(?:\.\d+)?) units delivered, none invoiced/gi, (_m, n) => `${n} units delivered, no invoice yet`)
    .replace(/\b(\d{4,}\.\d{2})\b/g, (_m, n) => `₹${inr.format(Number(n))}`);
};
export const humanizeFindings = async (findings, groupId) => {
  const map = await docNameMap(findings.map((f) => f?.data?.message), groupId);
  return findings.map((f) => (f?.data ? { ...f, data: { ...f.data, message: humanizeWith(map, f.data.message) } } : f));
};

const scopeFilter = (req, entityId) => {
  const f = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (entityId) {
    if (!req.scope.entityIds.includes(String(entityId))) throw fail(404, "NOT_FOUND", "Entity not found");
    f.entityId = String(entityId);
  }
  return f;
};

const INVOICE_FIELDS = { id: 1, number: 1, externalRef: 1, date: 1, totals: 1, lines: 1, charges: 1, seller: 1, supplierId: 1, terms: 1, gst: 1, entityId: 1 };
const findingAmount = (x) => toPaise(x?.data?.amount ?? x?.amount);

// GET /dashboard/today?entityId — Today-page aggregates (client type Today).
router.get("/dashboard/today", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const [findings, draftDocs, openCaseCount, holdCases, invoices, suppliers] = await Promise.all([
    Finding.find({ ...f, status: "open" }).sort({ createdAt: -1 }).lean(),
    Document.countDocuments({ ...f, status: "draft" }),
    Case.countDocuments({ ...f, status: { $in: ["open", "in_review"] } }),
    Case.find({ ...f, status: "on_hold" }, { subjectIds: 1 }).lean(),
    Document.find({ ...f, type: "INVOICE_IN", status: { $nin: ["draft", "cancelled", "reversed"] } }, INVOICE_FIELDS).lean(),
    Supplier.find({ groupId: req.scope.groupId }, { id: 1, legalName: 1, udyam: 1, msme: 1, paymentTermsDays: 1 }).lean(),
  ]);

  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const flaggedDocIds = new Set(findings.flatMap((x) => (x.data?.evidence ?? []).map((e) => e.documentId)));
  const holdDocs = await Document.find({ ...f, id: { $in: holdCases.flatMap((c) => c.subjectIds) } }, { totals: 1, lines: 1, charges: 1 }).lean();
  const settled = await settledPaiseFor(req.scope.groupId, invoices.map((d) => d.id));
  const openOf = (d) => { const o = toPaise(grandOf(d)) - (settled.get(d.id) || 0n); return o > 0n ? o : 0n; };

  // MSME deadlines: micro/small suppliers, unpaid, clock from acceptance
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byName = new Map(suppliers.map((s) => [s.legalName, s]));
  const msmeInvoices = invoices.map((d) => ({ d, sup: byId.get(d.supplierId) || byId.get(d.seller?.supplierId) || byName.get(d.seller?.name) }))
    .filter(({ d, sup }) => msmeCovered(msmeCategoryOf(sup, d)) && openOf(d) > 0n);
  const accepted = await acceptanceDates(req.scope.groupId, msmeInvoices.map((x) => x.d));
  const deadlines = msmeInvoices.map(({ d, sup }) => {
    const dl = msmeDeadline(d, sup, accepted.get(d.id));
    return { kind: "MSME_45", documentId: d.id, supplier: sup?.legalName ?? d.seller?.name ?? "Supplier", dueDate: dl.dueDate, daysLeft: dl.daysLeft, amount: money(fromPaise(openOf(d))), clockBasis: dl.clockBasis };
  }).filter((d) => d.daysLeft < 30).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8);

  // Net position from each case's latest engine snapshot: what is owed on
  // delivered/accepted goods after payments and credits, and what is recorded
  // but not supported (counted once, however many findings describe it).
  const caseRows = await Case.find({ ...f, latestSnapshotId: { $exists: true, $ne: null } }, { latestSnapshotId: 1 }).lean();
  const snaps = await Snapshot.find({ groupId: req.scope.groupId, id: { $in: caseRows.map((c) => c.latestSnapshotId) } }, { "result.balances": 1 }).lean();
  let netSupported = 0n, netDisputed = 0n, haveNet = false;
  for (const snap of snaps) {
    const b = snap.result?.balances;
    if (b?.supportedOutstanding !== undefined) {
      haveNet = true;
      netSupported += toPaise(b.supportedOutstanding);
      netDisputed += toPaise(b.disputedOutstanding ?? "0");
    }
  }
  const cleanOutstanding = haveNet
    ? netSupported
    : invoices.filter((d) => !flaggedDocIds.has(d.id)).reduce((s, d) => s + openOf(d), 0n);
  const dueWeek = deadlines.filter((d) => d.daysLeft <= 7 && d.daysLeft >= 0).reduce((s, d) => s + toPaise(d.amount), 0n);

  const topSlice = sorted.slice(0, 10);
  const activitySlice = findings.slice(0, 5);
  const names = await docNameMap(
    [...topSlice, ...sorted.slice(0, 3), ...activitySlice].map((x) => x.data?.message),
    req.scope.groupId, activitySlice.map((x) => x.data?.evidence?.[0]?.documentId),
  );
  const human = (x) => (x?.data ? { ...x, data: { ...x.data, message: humanizeWith(names, x.data.message) } } : x);

  res.json({
    moneyAtRisk: money(fromPaise(haveNet ? netDisputed : findings.reduce((s, x) => s + findingAmount(x), 0n))),
    holds: { count: holdCases.length, amount: money(fromPaise(holdDocs.reduce((s, d) => s + toPaise(grandOf(d)), 0n))) },
    approvalsWaiting: draftDocs,
    deadlines,
    itcAtRisk: money(fromPaise(invoices.filter((d) => flaggedDocIds.has(d.id)).reduce((s, d) => s + toPaise(taxOf(d)), 0n))),
    topFindings: topSlice.map(human),
    supportedOutstanding: money(fromPaise(cleanOutstanding)),
    paymentsDueWeek: money(fromPaise(dueWeek)),
    openCaseCount,
    attention: sorted.slice(0, 3).map((x) => ({ id: x.id, text: humanizeWith(names, x.data?.message ?? x.code?.replaceAll("_", " ").toLowerCase() ?? "Finding"), actionLabel: "Review", href: `/app/investigations/${x.caseId}` })),
    activity: activitySlice.map((x) => {
      const fd = x.data || {};
      const docId = fd.evidence?.[0]?.documentId;
      return {
        id: x.id, kind: "finding", severity: fd.severity || "info", code: x.code || fd.code,
        text: humanizeWith(names, fd.message ?? x.code ?? "Finding recorded"),
        docRef: (docId && names.get(docId)) || docId || null,
        at: x.createdAt, ...(x.caseId ? { href: `/app/investigations/${x.caseId}` } : {}),
      };
    }),
  });
}));

// GET /graph/case/:id — same payload as /cases/:id/graph (path the client
// uses): Neo4j projection when available, else the snapshot's own graph.
router.get("/graph/case/:id", handle(async (req, res) => {
  const kase = await Case.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!kase || !req.scope.entityIds.includes(kase.entityId)) throw fail(404, "NOT_FOUND", "Case not found");
  const snapshot = await Snapshot.findOne({ groupId: kase.groupId, caseId: kase.id, scenario: false }, { id: 1, "result.graph": 1 }).sort({ createdAt: -1 }).lean();
  try {
    const graph = await caseGraph(kase.groupId, snapshot?.id);
    if (graph.nodes?.length) return res.json(graph);
  } catch { /* fall through to the snapshot graph */ }
  if (snapshot?.result?.graph) return res.json({ ...snapshot.result.graph, source: "snapshot", snapshotId: snapshot.id });
  res.json({ nodes: [], edges: [], source: "none", snapshotId: snapshot?.id || null });
}));

// ---- /orders ---------------------------------------------------------------
// PO worklist with value + fulfilment percentages (exact money).
// * delivered: GRN line qty referencing the PO (refs or RECEIVES link)
// * invoiced: invoice line value attributed to the PO (refs or BILLS link)
// * paid: money settled on those invoices (allocations/SETTLES), attributed
//   to the PO by the invoice's line-value share, plus SETTLES straight to the
//   PO (advances). Payments link to invoices, not POs — counting only direct
//   PO links showed 0% paid everywhere.
const ATTENTION_RANK = {
  partially_fulfilled: 0, issued: 1, acknowledged: 2, approved: 3,
  pending_approval: 4, fulfilled: 5, short_closed: 6,
};
const qtyOf = (l) => Number(rawAmount(l?.qty) ?? 0) || 0;
const lineValuePaise = (l) => toPaise(taxableEstimate({ lines: [l] }));

router.get("/orders", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 25) || 25), 200);
  const cursor = Math.max(0, Number(req.query.cursor ?? 0) || 0);
  const sort = String(req.query.sort ?? "attention");
  const { status, q: search, hasIssues, supplierId, from, to } = req.query;
  const q = { ...f, type: "PO" };
  if (status) q.status = String(status);
  else q.status = { $nin: ["draft", "cancelled", "reversed"] };
  if (supplierId) q.supplierId = String(supplierId);
  if (from || to) q.date = { ...(from ? { $gte: String(from) } : {}), ...(to ? { $lte: String(to) } : {}) };
  if (search) {
    const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    q.$or = [{ number: rx }, { "seller.name": rx }, { externalRef: rx }];
  }
  // Bounded, projected working set — attention sort needs every matching PO.
  const items = await Document.find(q, { id: 1, number: 1, externalRef: 1, seller: 1, entityId: 1, date: 1, status: 1, totals: 1, lines: 1, charges: 1 })
    .sort({ date: -1, number: -1 }).limit(1000).lean();
  const ids = items.map((d) => d.id);
  const idSet = new Set(ids);
  const [links, refDocs] = await Promise.all([
    DocumentLink.find({ groupId: req.scope.groupId, toId: { $in: ids }, kind: { $in: ["RECEIVES", "BILLS", "SETTLES"] } }, { fromId: 1, toId: 1, kind: 1, amount: 1 }).lean(),
    Document.find({ groupId: req.scope.groupId, type: { $in: ["GRN", "INVOICE_IN"] }, status: { $nin: ["draft", "cancelled", "reversed"] }, "lines.refs.poId": { $in: ids } },
      { id: 1, type: 1, lines: 1, totals: 1 }).lean(),
  ]);
  const linkedOnly = [...new Set(links.filter((l) => l.kind !== "SETTLES").map((l) => l.fromId))].filter((id) => !refDocs.some((d) => d.id === id));
  const linkedDocs = linkedOnly.length ? await Document.find({ groupId: req.scope.groupId, id: { $in: linkedOnly } }, { id: 1, type: 1, lines: 1, totals: 1 }).lean() : [];
  const sources = new Map([...refDocs, ...linkedDocs].map((d) => [d.id, d]));
  const linkTargets = new Map();
  for (const l of links) if (l.kind !== "SETTLES") linkTargets.set(l.fromId, [...(linkTargets.get(l.fromId) || []), l.toId]);

  const received = new Map(), invoiced = new Map(), invoiceShares = new Map(); // invoiceId -> [{po, share num/den}]
  for (const d of sources.values()) {
    const refLines = (d.lines || []).filter((l) => idSet.has(l.refs?.poId));
    const perPo = new Map();
    if (refLines.length) {
      for (const l of refLines) {
        const po = l.refs.poId;
        const cur = perPo.get(po) || { qty: 0, value: 0n };
        perPo.set(po, { qty: cur.qty + qtyOf(l), value: cur.value + lineValuePaise(l) });
      }
    } else {
      for (const po of linkTargets.get(d.id) || []) {
        perPo.set(po, { qty: (d.lines || []).reduce((s, l) => s + qtyOf(l), 0), value: toPaise(taxableEstimate(d)) });
      }
    }
    if (d.type === "GRN") for (const [po, v] of perPo) received.set(po, (received.get(po) || 0) + v.qty);
    if (d.type === "INVOICE_IN") {
      const totalLine = [...perPo.values()].reduce((s, v) => s + v.value, 0n) + (d.lines || []).filter((l) => l.refs?.poId && !idSet.has(l.refs.poId)).reduce((s, l) => s + lineValuePaise(l), 0n);
      const grand = toPaise(grandOf(d));
      const shares = [];
      for (const [po, v] of perPo) {
        // invoiced value attributed to the PO, scaled to the invoice's grand (GST incl.)
        const attributed = totalLine > 0n ? (grand * v.value) / totalLine : grand;
        invoiced.set(po, (invoiced.get(po) || 0n) + attributed);
        shares.push({ po, num: v.value, den: totalLine });
      }
      invoiceShares.set(d.id, shares);
    }
  }
  const settled = await settledPaiseFor(req.scope.groupId, [...invoiceShares.keys()]);
  const paid = new Map();
  const payersByPo = new Map();
  for (const [inv, shares] of invoiceShares) {
    const s = settled.get(inv) || 0n;
    for (const sh of shares) {
      for (const p of settled.payers.get(inv) || []) payersByPo.set(sh.po, (payersByPo.get(sh.po) || new Set()).add(p));
      if (s) paid.set(sh.po, (paid.get(sh.po) || 0n) + (sh.den > 0n ? (s * sh.num) / sh.den : s));
    }
  }
  // advances settled straight to the PO — unless the same payment already
  // counted through one of the PO's invoices
  for (const l of links) {
    if (l.kind !== "SETTLES" || payersByPo.get(l.toId)?.has(l.fromId)) continue;
    paid.set(l.toId, (paid.get(l.toId) || 0n) + toPaise(l.amount));
  }

  const [openFindings, poCases] = await Promise.all([
    Finding.aggregate([{ $match: { ...f, status: "open" } }, { $group: { _id: "$caseId", n: { $sum: 1 } } }]),
    Case.find({ ...f, kind: "po", subjectIds: { $in: ids } }, { subjectIds: 1, id: 1 }).lean(),
  ]);
  const findingsByCase = new Map(openFindings.map((x) => [x._id, x.n]));
  const caseFor = new Map(poCases.flatMap((c) => c.subjectIds.map((s) => [s, c.id])));
  const pct = (part, whole) => (whole > 0n ? Math.min(100, Math.round(Number((part * 10000n) / whole) / 100)).toFixed(0) : "0");
  let rows = items.map((doc) => {
    const ordered = (doc.lines || []).reduce((s, l) => s + qtyOf(l), 0);
    const value = toPaise(grandOf(doc));
    const rec = received.get(doc.id) || 0;
    const invVal = invoiced.get(doc.id) || 0n;
    const paidVal = paid.get(doc.id) || 0n;
    const caseId = caseFor.get(doc.id);
    return {
      id: doc.id, number: doc.number ?? doc.externalRef ?? doc.id,
      supplier: doc.seller?.name ?? "—", entity: doc.entityId, date: doc.date, status: doc.status,
      value: money(fromPaise(value)), caseId,
      deliveredPct: ordered ? Math.min(100, (rec / ordered) * 100).toFixed(0) : "0",
      invoicedPct: pct(invVal, value),
      paidPct: pct(paidVal, value),
      issueCount: (caseId && findingsByCase.get(caseId)) || 0,
      // additive exact figures
      orderedQty: String(ordered), receivedQty: String(rec),
      invoicedValue: money(fromPaise(invVal)), paidValue: money(fromPaise(paidVal)),
    };
  });
  if (hasIssues === "1" || hasIssues === "true") rows = rows.filter((r) => r.issueCount > 0);
  if (sort === "attention") {
    rows = [...rows].sort((a, b) =>
      ((ATTENTION_RANK[a.status] ?? 9) - (ATTENTION_RANK[b.status] ?? 9)) ||
      (b.issueCount - a.issueCount) ||
      String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
  } else if (sort === "value") {
    rows = [...rows].sort((a, b) => toNumber(b.value) - toNumber(a.value));
  } else if (sort === "oldest") {
    rows = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)));
  } // "newest" keeps the mongo ordering
  const total = rows.length;
  const page = rows.slice(cursor, cursor + limit);
  res.json({ items: page, nextCursor: cursor + page.length < total ? String(cursor + page.length) : null, total });
}));

// GET /findings — findings list (copilot + IssuesList). Filters: entityId,
// caseId, findingId (exact), severity (comma list), code, status (default
// open; "all" for every status), limit (≤ 200).
router.get("/findings", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const q = { ...f };
  if (req.query.caseId) q.caseId = String(req.query.caseId);
  if (req.query.findingId) q.id = String(req.query.findingId);
  if (req.query.code) q.code = String(req.query.code);
  if (req.query.severity) q.severity = { $in: String(req.query.severity).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean) };
  const status = req.query.status ? String(req.query.status).toLowerCase() : req.query.findingId ? "all" : "open";
  if (status !== "all") q.status = status;
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 100) || 100), 200);
  const [items, total] = await Promise.all([
    Finding.find(q).sort({ createdAt: -1 }).limit(limit).lean(),
    Finding.countDocuments(q),
  ]);
  res.json({ items: await humanizeFindings(items, req.scope.groupId), nextCursor: null, total });
}));

// POST /allocate/payment — proxy to the engine allocator via the shared
// engine client (ENGINE_API_URL + NODE_INTERNAL_TOKEN, with a timeout).
router.post("/allocate/payment", handle(async (req, res) => {
  assertPlainInput(req.body);
  res.json(await enginePost("/v2/allocate/payment", req.body || {}, { timeoutMs: 15000 }));
}));

export default router;
