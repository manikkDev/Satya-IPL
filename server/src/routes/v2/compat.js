// Compat routes: client api surface names that B's route files don't mount.
// Thin shims over the same models — no new business logic lives here.
import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Case from "../../models/Case.js";
import Finding from "../../models/Finding.js";
import Supplier from "../../models/Supplier.js";
import Snapshot from "../../models/Snapshot.js";
import { handle, fail } from "./util.js";
import { caseGraph } from "../../services/graphProjection.js";

const router = express.Router();

const money = (v) => ({ amount: Number(v).toFixed(2), currency: "INR" });
const msmeIdsBySupplier = () => false; // name matching covers seeded data

// Humanise engine text: swap internal doc_* ids for real document numbers and
// format bare amounts. Findings reference ids because engines don't know
// display names — display layers should never show them raw.
const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const docIdFallback = (id) => {
  const m = id.match(/^doc_bpi_([a-z]+)_(\d+)(?:_\d+)?$/);
  return m ? `${m[1].toUpperCase()}-${m[2]}` : id.replace(/^doc_/, "");
};
const humanizeText = async (text, groupId) => {
  if (!text) return text;
  const str = String(text);
  const ids = [...new Set([...str.matchAll(/doc_[\w]+/g)].map((m) => m[0]))];
  let out = str;
  if (ids.length) {
    const docs = await Document.find({ groupId, id: { $in: ids } }, { id: 1, number: 1, externalRef: 1 }).lean();
    const map = new Map(docs.map((d) => [d.id, d.number ?? d.externalRef ?? docIdFallback(d.id)]));
    out = out.replace(/doc_[\w]+/g, (id) => map.get(id) ?? docIdFallback(id));
  }
  return out
    .replace(/invoiced (\d+(?:\.\d+)?) exceeds delivered (\d+(?:\.\d+)?)/gi, (_m, a, b) => `invoiced ${a} units, only ${b} delivered`)
    .replace(/(\d+(?:\.\d+)?) units delivered, none invoiced/gi, (_m, n) => `${n} units delivered, no invoice yet`)
    .replace(/\b(\d{4,}\.\d{2})\b/g, (_m, n) => `₹${inr.format(Number(n))}`);
};
const humanizeFinding = async (f, groupId) =>
  f?.data ? { ...f, data: { ...f.data, message: await humanizeText(f.data.message, groupId) } } : f;

const scopeFilter = (req, entityId) => {
  const f = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (entityId) {
    if (!req.scope.wildcard && !req.scope.entityIds.includes(entityId)) throw fail(404, "NOT_FOUND", "Entity not found");
    f.entityId = entityId;
  }
  return f;
};

// GET /dashboard/today?entityId — Today-page aggregates (client type Today).
router.get("/dashboard/today", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const [findings, draftDocs, openCases, holdCases, invoices, suppliers] = await Promise.all([
    Finding.find({ ...f, status: "open" }).sort({ createdAt: -1 }).lean(),
    Document.find({ ...f, status: "draft" }).countDocuments(),
    Case.find({ ...f, status: { $in: ["open", "in_review"] } }).lean(),
    Case.find({ ...f, status: "on_hold" }).lean(),
    Document.find({ ...f, type: "INVOICE_IN", status: { $nin: ["draft", "cancelled", "reversed"] } }).lean(),
    Supplier.find({ groupId: req.scope.groupId }).lean(),
  ]);

  const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const amtOf = (x) => Number(x?.data?.amount?.amount ?? x?.data?.amount ?? x?.amount?.amount ?? x?.amount ?? 0);
  const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const flaggedDocIds = new Set(findings.flatMap((x) => (x.data?.evidence ?? []).map((e) => e.documentId)).concat(findings.map((x) => x.subjectId).filter(Boolean)));
  const grand = (d) => Number(d?.totals?.grand?.amount ?? d?.totals?.grand ?? 0);
  const taxOf = (d) => ["cgst", "sgst", "igst"].reduce((s, k) => s + Number(d?.totals?.[k]?.amount ?? d?.totals?.[k] ?? 0), 0);

  const holdDocs = await Document.find({ ...f, id: { $in: holdCases.flatMap((c) => c.subjectIds) } }).lean();
  const top = await Promise.all(sorted.slice(0, 10).map((x) => humanizeFinding(x, req.scope.groupId)));
  const today = new Date();
  const msmeNames = new Set(suppliers.filter((s) => s.udyam?.category || s.msme).map((s) => s.legalName));
  const deadlines = invoices
    .filter((d) => msmeNames.has(d.seller?.name) || msmeIdsBySupplier(d, suppliers))
    .map((d) => {
      const due = new Date(new Date(d.date).getTime() + 45 * 86400000);
      const daysLeft = Math.ceil((due.getTime() - today.getTime()) / 86400000);
      return { kind: "MSME_45", documentId: d.id, supplier: d.seller?.name ?? "Supplier", dueDate: due.toISOString().slice(0, 10), daysLeft, amount: money(grand(d)) };
    })
    .filter((d) => d.daysLeft < 30)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8);

  const cleanOutstanding = invoices.filter((d) => !flaggedDocIds.has(d.id)).reduce((s, d) => s + grand(d), 0);
  const dueWeek = deadlines.filter((d) => d.daysLeft <= 7 && d.daysLeft >= 0).reduce((s, d) => s + Number(d.amount.amount), 0);

  res.json({
    moneyAtRisk: money(findings.reduce((s, x) => s + amtOf(x), 0)),
    holds: { count: holdCases.length, amount: money(holdDocs.reduce((s, d) => s + grand(d), 0)) },
    approvalsWaiting: draftDocs,
    deadlines,
    itcAtRisk: money(invoices.filter((d) => flaggedDocIds.has(d.id)).reduce((s, d) => s + taxOf(d), 0)),
    topFindings: top,
    supportedOutstanding: money(cleanOutstanding),
    paymentsDueWeek: money(dueWeek),
    openCaseCount: openCases.length,
    attention: await Promise.all(sorted.slice(0, 3).map(async (x) => ({ id: x.id, text: await humanizeText(x.data?.message ?? x.code?.replaceAll("_", " ").toLowerCase() ?? "Finding", req.scope.groupId), actionLabel: "Review", href: `/app/investigations/${x.caseId}` }))),
    activity: await Promise.all(findings.slice(0, 5).map(async (x) => {
      const f = x.data || {};
      const docId = f.evidence?.[0]?.documentId;
      const doc = docId ? await Document.findOne({ groupId: req.scope.groupId, id: docId }).select("number externalRef").lean() : null;
      return {
        id: x.id, kind: "finding", severity: f.severity || "info", code: x.code || f.code,
        text: await humanizeText(f.message ?? x.code ?? "Finding recorded", req.scope.groupId),
        docRef: doc?.number || doc?.externalRef || docId || null,
        at: x.createdAt, ...(x.caseId ? { href: `/app/investigations/${x.caseId}` } : {}),
      };
    })),
  });
}));

// GET /graph/case/:id — same payload as /cases/:id/graph (path the client uses).
router.get("/graph/case/:id", handle(async (req, res) => {
  const kase = await Case.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!kase) throw fail(404, "NOT_FOUND", "Case not found");
  const snapshot = await Snapshot.findOne({ caseId: kase.id, scenario: false }).sort({ createdAt: -1 }).lean();
  const graph = await caseGraph(kase.groupId, snapshot?.id);
  res.json(graph);
}));

// GET /compliance/:section (gstr2b|msme) — slices of compliance data.
router.get("/compliance/:section", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const section = req.params.section;
  const invoices = await Document.find({ ...f, type: "INVOICE_IN", status: { $nin: ["draft", "cancelled", "reversed"] } }).lean();
  const days = (d) => Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (section === "msme") {
    const suppliers = await Supplier.find({ groupId: req.scope.groupId }).lean();
    const byName = new Map(suppliers.map((s) => [s.legalName, s]));
    const msmeNames = new Set(suppliers.filter((s) => s.udyam?.category || s.msme).map((s) => s.legalName));
    const rows = invoices.filter((d) => msmeNames.has(d.seller?.name))
      .map((d) => {
        const sup = byName.get(d.seller?.name);
        const termDays = sup?.paymentTermsDays ?? 45;
        const due = new Date(new Date(d.date).getTime() + termDays * 86400000);
        const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
        return {
          documentId: d.id, invoice: d.number ?? d.externalRef ?? d.id, supplier: sup?.legalName ?? d.seller?.name ?? "Supplier",
          note: daysLeft < 0 ? `Overdue by ${-daysLeft} days — interest accrues` : `Pay within ${termDays} days of acceptance`,
          amount: money(Number(d.totals?.grand?.amount ?? d.totals?.grand ?? 0)),
          daysLeft, dueDate: due.toISOString().slice(0, 10),
        };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
    return res.json(rows);
  }
  if (section === "gstr2b") {
    const taxOf = (d) => ["cgst", "sgst", "igst"].reduce((s, k) => s + Number(d?.totals?.[k]?.amount ?? d?.totals?.[k] ?? 0), 0);
    const findings = await Finding.find({ ...f, status: "open" }).lean();
    const flagged = new Set(findings.flatMap((x) => (x.data?.evidence ?? []).map((e) => e.documentId)));
    const flaggedInv = invoices.filter((d) => flagged.has(d.id));
    const period = new Date().toISOString().slice(0, 7);
    return res.json({
      matched: invoices.length - flaggedInv.length,
      missingIn2B: flaggedInv.slice(0, 20).map((d) => ({
        invoice: d.number ?? d.externalRef ?? d.id, supplier: d.seller?.name ?? "Supplier",
        amount: money(Number(d.totals?.grand?.amount ?? d.totals?.grand ?? 0)), tax: money(taxOf(d)),
      })),
      missingInBooks: [],
      itcAtRisk: money(flaggedInv.reduce((s, d) => s + taxOf(d), 0)),
      period,
      note: "GSTR-2B feed not connected — manual import via /import/gstr2b",
    });
  }
  throw fail(404, "NOT_FOUND", `Unknown compliance section ${section}`);
}));

// GET /orders — PO worklist with computed value + fulfilment percentages.
// Raw documents have no totals stored; value = sum(qty*rate). Delivered/
// invoiced/paid percentages come from RECEIVES/BILLS/SETTLES links.
// Server-side filters: status, q, hasIssues, supplierId, from, to.
// sort=attention (default) surfaces orders that need a decision first —
// open issues, then partially fulfilled, then newest. newest/oldest/value
// are plain orderings. cursor is a numeric offset into the sorted rows.
const ATTENTION_RANK = {
  partially_fulfilled: 0, issued: 1, acknowledged: 2, approved: 3,
  pending_approval: 4, fulfilled: 5, short_closed: 6,
};
router.get("/orders", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const limit = Math.min(Number(req.query.limit ?? 25), 200);
  const cursor = Number(req.query.cursor ?? 0);
  const sort = String(req.query.sort ?? "attention");
  const { status, q: search, hasIssues, supplierId, from, to } = req.query;
  const q = { ...f, type: "PO" };
  if (status) q.status = status;
  else q.status = { $nin: ["draft", "cancelled", "reversed"] };
  if (supplierId) q.supplierId = supplierId;
  if (from || to) q.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (search) {
    const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    q.$or = [{ number: rx }, { "seller.name": rx }, { externalRef: rx }];
  }
  // Bounded working set — fulfilment is computed per row, so sorting by
  // attention needs every matching PO, not just the page slice.
  const items = await Document.find(q).sort({ date: -1, number: -1 }).limit(1000).lean();
  const ids = items.map((d) => d.id);
  const links = await DocumentLink.find({ groupId: req.scope.groupId, toId: { $in: ids } }).lean();
  const linked = await Document.find(
    { groupId: req.scope.groupId, id: { $in: [...new Set(links.map((l) => l.fromId))] } },
    { id: 1, type: 1, lines: 1, totals: 1 },
  ).lean();
  const byId = new Map(linked.map((d) => [d.id, d]));
  const lineQty = (doc) => (doc.lines ?? []).reduce((s, l) => s + Number(l.qty ?? 0), 0);
  const poValue = (doc) => Number(doc.totals?.grand?.amount ?? doc.totals?.grand ?? 0) || (doc.lines ?? []).reduce((s, l) => s + Number(l.qty ?? 0) * Number(l.rate ?? 0), 0);
  const grandOf = (doc) => Number(doc.totals?.grand?.amount ?? doc.totals?.grand ?? 0);
  const findingsByCase = new Map();
  for (const x of await Finding.find({ ...f, status: "open" }, { caseId: 1 }).lean()) {
    findingsByCase.set(x.caseId, (findingsByCase.get(x.caseId) ?? 0) + 1);
  }
  const poCases = await Case.find({ ...f, kind: "po", subjectIds: { $in: ids } }, { subjectIds: 1, id: 1 }).lean();
  const caseFor = new Map(poCases.flatMap((c) => c.subjectIds.map((s) => [s, c.id])));
  const linksByPo = new Map();
  for (const l of links) linksByPo.set(l.toId, [...(linksByPo.get(l.toId) ?? []), l]);
  let rows = items.map((doc) => {
    const ordered = lineQty(doc);
    const value = poValue(doc);
    let received = 0, invoicedVal = 0, paidVal = 0;
    for (const l of linksByPo.get(doc.id) ?? []) {
      const src = byId.get(l.fromId);
      if (!src) continue;
      if (l.kind === "RECEIVES") received += lineQty(src);
      else if (l.kind === "BILLS") invoicedVal += grandOf(src) || (src.lines ?? []).reduce((s, x) => s + Number(x.qty ?? 0) * Number(x.rate ?? 0), 0);
      else if (l.kind === "SETTLES") paidVal += Number(l.amount?.amount ?? l.amount ?? 0);
    }
    const caseId = caseFor.get(doc.id);
    return {
      id: doc.id, number: doc.number ?? doc.externalRef ?? doc.id,
      supplier: doc.seller?.name ?? "—", entity: doc.entityId, date: doc.date, status: doc.status,
      value: money(value), caseId,
      deliveredPct: ordered ? Math.min(100, (received / ordered) * 100).toFixed(0) : "0",
      invoicedPct: value ? Math.min(100, (invoicedVal / value) * 100).toFixed(0) : "0",
      paidPct: value ? Math.min(100, (paidVal / value) * 100).toFixed(0) : "0",
      issueCount: (caseId && findingsByCase.get(caseId)) || 0,
    };
  });
  if (hasIssues === "1" || hasIssues === "true") rows = rows.filter((r) => r.issueCount > 0);
  if (sort === "attention") {
    rows = [...rows].sort((a, b) =>
      ((ATTENTION_RANK[a.status] ?? 9) - (ATTENTION_RANK[b.status] ?? 9)) ||
      (b.issueCount - a.issueCount) ||
      b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  } else if (sort === "value") {
    rows = [...rows].sort((a, b) => Number(b.value.amount) - Number(a.value.amount));
  } else if (sort === "oldest") {
    rows = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  } // "newest" keeps the mongo ordering
  const total = rows.length;
  const page = rows.slice(cursor, cursor + limit);
  res.json({ items: page, nextCursor: cursor + page.length < total ? String(cursor + page.length) : null, total });
}));

// GET /findings — open findings list (copilot + IssuesList both call this).
router.get("/findings", handle(async (req, res) => {
  const f = scopeFilter(req, req.query.entityId);
  const q = { ...f };
  if (req.query.caseId) q.caseId = req.query.caseId;
  if (req.query.status) q.status = req.query.status.toLowerCase();
  else q.status = "open";
  const items = await Finding.find(q).sort({ createdAt: -1 }).limit(Number(req.query.limit ?? 100)).lean();
  const total = await Finding.countDocuments(q);
  const humanized = await Promise.all(items.map((x) => humanizeFinding(x, req.scope.groupId)));
  res.json({ items: humanized, nextCursor: null, total });
}));

// POST /allocate/payment — proxy to the engine allocator.
router.post("/allocate/payment", handle(async (req, res) => {
  const upstream = await fetch(`${process.env.ML_SERVICE_URL || "http://ml-fl-service:8000"}/v2/allocate/payment`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": process.env.SATYA_INTERNAL_TOKEN || "dev-internal" },
    body: JSON.stringify(req.body),
  });
  res.status(upstream.status).json(await upstream.json().catch(() => ({})));
}));

export default router;
