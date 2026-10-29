import express from "express";
import Document from "../../models/Document.js";
import Case from "../../models/Case.js";
import Finding from "../../models/Finding.js";
import Decision from "../../models/Decision.js";
import Snapshot from "../../models/Snapshot.js";
import { fail, handle } from "./util.js";

const router = express.Router();

// GET /dashboard/summary?entityId — worklist-level aggregates (04 P3-B8).
router.get("/summary", handle(async (req, res) => {
  const entityFilter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (req.query.entityId) {
    if (!req.scope.wildcard && !req.scope.entityIds.includes(req.query.entityId)) throw fail(404, "NOT_FOUND", "Entity not found");
    entityFilter.entityId = req.query.entityId;
  }

  const [casesByStatus, openCases, findingsBySeverity, findingsByCertainty, recentDecisions, monthly] = await Promise.all([
    Case.aggregate([{ $match: entityFilter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    Case.find({ ...entityFilter, status: { $in: ["open", "in_review"] } }).lean(),
    Finding.aggregate([{ $match: { ...entityFilter, status: "open" } }, { $group: { _id: "$severity", count: { $sum: 1 } } }]),
    Finding.aggregate([{ $match: { ...entityFilter, status: "open" } }, { $group: { _id: "$certainty", count: { $sum: 1 } } }]),
    Decision.find(entityFilter).sort({ createdAt: -1 }).limit(10).lean(),
    Document.aggregate([
      { $match: { ...entityFilter, status: { $nin: ["draft", "cancelled"] } } },
      { $group: { _id: { $substr: ["$date", 0, 7] }, value: { $sum: { $toDouble: { $ifNull: ["$totals.grand", "0"] } } }, docs: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // openValue: evidence-supported payable across the latest snapshots of open cases
  const snaps = await Snapshot.find({ groupId: req.scope.groupId, caseId: { $in: openCases.map((c) => c.id) }, scenario: false }).lean();
  const latest = new Map();
  for (const s of snaps) if (!latest.has(s.caseId) || new Date(s.createdAt) > new Date(latest.get(s.caseId).createdAt)) latest.set(s.caseId, s);
  let openValue = 0;
  for (const s of latest.values()) openValue += Number(s.result?.balances?.evidenceSupportedPayable || 0);

  // aging: open cases grouped by oldest subject-doc date buckets
  const openDocs = await Document.find({ groupId: req.scope.groupId, id: { $in: openCases.flatMap((c) => c.subjectIds) } }).select("date").lean();
  const now = Date.now();
  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const c of openCases) {
    const doc = openDocs.find((d) => c.subjectIds.includes(d.id));
    const days = doc ? Math.floor((now - new Date(doc.date).getTime()) / 86400000) : 0;
    aging[days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+"] += 1;
  }

  const spend = await Document.aggregate([
    { $match: { ...entityFilter, supplierId: { $exists: true }, type: { $in: ["PO", "INVOICE_IN"] }, status: { $nin: ["draft", "cancelled"] } } },
    { $group: { _id: "$supplierId", value: { $sum: { $toDouble: { $ifNull: ["$totals.grand", "0"] } } }, docs: { $sum: 1 } } },
    { $sort: { value: -1 } }, { $limit: 10 },
  ]);

  const unallocated = await Document.find({
    ...entityFilter, type: { $in: ["PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT"] },
    status: { $nin: ["draft", "cancelled"] },
  }).lean();
  const unallocatedPayments = unallocated.filter((d) => {
    const total = Number(d.payment?.amount || 0);
    const allocated = (d.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0);
    return total > 0 && allocated < total - 0.01;
  }).map((d) => ({ documentId: d.id, amount: d.payment?.amount, allocated: String((d.payment?.allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0).toFixed(2)) }));

  res.json({
    openValue: openValue.toFixed(2),
    casesByStatus: Object.fromEntries(casesByStatus.map((x) => [x._id, x.count])),
    issuesBySeverity: Object.fromEntries(findingsBySeverity.map((x) => [x._id, x.count])),
    findingsByCertainty: Object.fromEntries(findingsByCertainty.map((x) => [x._id, x.count])),
    openInvestigations: openCases.length,
    aging,
    spendBySupplier: spend.map((s) => ({ supplierId: s._id, value: s.value.toFixed(2), docs: s.docs })),
    monthlySeries: monthly.map((m) => ({ month: m._id, value: m.value.toFixed(2), docs: m.docs })),
    unallocatedPayments,
    recentDecisions,
  });
}));

export default router;
