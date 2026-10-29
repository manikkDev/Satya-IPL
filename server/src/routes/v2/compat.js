// Compat routes: client api surface names that B's route files don't mount.
// Thin shims over the same models — no new business logic lives here.
import express from "express";
import Document from "../../models/Document.js";
import Case from "../../models/Case.js";
import Finding from "../../models/Finding.js";
import Supplier from "../../models/Supplier.js";
import Snapshot from "../../models/Snapshot.js";
import { handle, fail } from "./util.js";
import { caseGraph } from "../../services/graphProjection.js";

const router = express.Router();

const money = (v) => ({ amount: Number(v).toFixed(2), currency: "INR" });
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
  const [findings, draftDocs, openCases] = await Promise.all([
    Finding.find({ ...f, status: "open" }).sort({ createdAt: -1 }).lean(),
    Document.find({ ...f, status: "draft" }).countDocuments(),
    Case.find({ ...f, status: { $in: ["open", "in_review"] } }).lean(),
  ]);
  const amt = (x) => Number(x.amount?.amount ?? x.amount ?? 0);
  const holds = findings.filter((x) => x.code?.includes("HOLD"));
  res.json({
    moneyAtRisk: money(findings.reduce((s, x) => s + amt(x), 0)),
    holds: { count: holds.length, amount: money(holds.reduce((s, x) => s + amt(x), 0)) },
    approvalsWaiting: draftDocs,
    deadlines: [],
    itcAtRisk: money(0),
    topFindings: findings.slice(0, 10),
    openCaseCount: openCases.length,
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
    const msmeIds = new Set(suppliers.filter((s) => s.udyam?.category || s.msme).map((s) => s.id));
    const items = invoices.filter((d) => msmeIds.has(d.seller?.id))
      .map((d) => ({ docId: d.id, number: d.number, date: d.date, amount: d.totals?.grand,
                     daysSinceReceived: days(d.date), deadlineStatus: days(d.date) > 30 ? "overdue" : "ok" }));
    return res.json({ items, overdue: items.filter((i) => i.deadlineStatus === "overdue").length });
  }
  if (section === "gstr2b") {
    const itcTotal = invoices.reduce((s, d) => s + Number(d.gst?.itcEligible?.amount ?? 0), 0);
    return res.json({ items: [], itcTotal: money(itcTotal), coverage: null,
      note: "GSTR-2B feed not connected — manual import via /imports/gstr2b" });
  }
  throw fail(404, "NOT_FOUND", `Unknown compliance section ${section}`);
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
