// Supplier risk score — transparent and rule-based. It replaces the earlier
// "survival analysis" (invented coefficients, no fitted data) with a score
// whose every point is explained by a visible factor. It is a prioritisation
// aid, not a prediction.

import Supplier from "../models/Supplier.js";
import Finding from "../models/Finding.js";
import Document from "../models/Document.js";
import Case from "../models/Case.js";
import { validateGstin } from "../lib/gstin.js";

const SEVERITY_POINTS = { critical: 20, high: 10, medium: 4, low: 1, info: 0 };
const DUPLICATE_CODES = /DUPLICATE|DUP_/;
const TAX_IDENTITY_CODES = /GSTIN|TAX_TYPE|IRN/;

export const bandFor = (score) => (score >= 50 ? "high" : score >= 20 ? "medium" : "low");

/** Pure scoring from already-loaded facts (unit-testable). */
export function scoreSupplier({ supplier, findings = [], openPoCount = 0 }) {
  const factors = [];
  const add = (points, label, detail) => {
    if (points > 0) factors.push({ points, label, detail });
  };

  const open = findings.filter((f) => f.status === "open");
  const severityPoints = Math.min(
    45,
    open.reduce((sum, f) => sum + (SEVERITY_POINTS[f.severity] ?? 0), 0),
  );
  if (open.length) {
    const bySeverity = ["critical", "high", "medium", "low"]
      .map((s) => [s, open.filter((f) => f.severity === s).length])
      .filter(([, n]) => n > 0)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");
    add(severityPoints, "Open issues on this supplier’s orders", bySeverity);
  }

  const duplicates = open.filter((f) => DUPLICATE_CODES.test(f.code)).length;
  add(Math.min(20, duplicates * 10), "Possible duplicate billing", `${duplicates} open duplicate-invoice or duplicate-payment flag${duplicates === 1 ? "" : "s"}`);

  const taxFlags = open.filter((f) => TAX_IDENTITY_CODES.test(f.code)).length;
  add(Math.min(10, taxFlags * 5), "GST identity or tax-type flags", `${taxFlags} open flag${taxFlags === 1 ? "" : "s"}`);

  const gstins = supplier.gstins || [];
  if (!gstins.length) add(10, "No GSTIN on file", "Input tax credit can’t be claimed without a valid supplier GSTIN");
  else {
    const invalid = gstins.filter((g) => !validateGstin(g.gstin).checksumValid);
    add(invalid.length ? 15 : 0, "GSTIN fails the checksum", invalid.map((g) => g.gstin).join(", "));
  }

  const banks = supplier.bankAccounts || [];
  if (!banks.length) add(5, "No bank account on file", "Payments can’t be matched to a verified account");
  else if (!banks.some((b) => b.status === "active")) add(8, "Bank account not verified", "Every account on file is pending change or inactive");

  if (supplier.msme && !supplier.udyam?.number) add(5, "MSME claimed without Udyam number", "45-day protection can’t be confirmed");

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return {
    supplierId: supplier.id,
    supplierName: supplier.legalName,
    score,
    band: bandFor(score),
    openIssues: open.length,
    openOrders: openPoCount,
    msme: Boolean(supplier.msme || supplier.udyam?.category),
    factors: factors.sort((a, b) => b.points - a.points),
    method: "rule-based",
  };
}

/** Score every supplier in a group (bounded queries, no N+1). */
export async function scoreSuppliers({ groupId, entityIds = null, supplierId = null }) {
  const supplierFilter = { groupId, ...(supplierId ? { id: supplierId } : {}) };
  const suppliers = await Supplier.find(supplierFilter).lean();
  if (!suppliers.length) return [];

  const ids = suppliers.map((s) => s.id);
  const docFilter = { groupId, type: "PO", $or: [{ supplierId: { $in: ids } }, { "seller.supplierId": { $in: ids } }] };
  if (entityIds) docFilter.entityId = { $in: entityIds };
  const pos = await Document.find(docFilter, { id: 1, supplierId: 1, "seller.supplierId": 1, status: 1 }).lean();
  const poSupplier = new Map(pos.map((p) => [p.id, p.supplierId || p.seller?.supplierId]));

  const cases = await Case.find({ groupId, subjectIds: { $in: [...poSupplier.keys()] } }, { id: 1, subjectIds: 1 }).lean();
  const caseSupplier = new Map();
  for (const c of cases) {
    const sid = c.subjectIds.map((s) => poSupplier.get(s)).find(Boolean);
    if (sid) caseSupplier.set(c.id, sid);
  }
  const findings = await Finding.find(
    { groupId, caseId: { $in: [...caseSupplier.keys()] }, status: "open" },
    { caseId: 1, code: 1, severity: 1, status: 1, snapshotId: 1, id: 1 },
  ).lean();
  // A finding can exist in several snapshots — count each finding id once.
  const seen = new Set();
  const bySupplier = new Map();
  for (const f of findings) {
    const key = `${f.caseId}:${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const sid = caseSupplier.get(f.caseId);
    if (!bySupplier.has(sid)) bySupplier.set(sid, []);
    bySupplier.get(sid).push(f);
  }
  const openPos = new Map();
  for (const p of pos) {
    if (["issued", "acknowledged", "partially_fulfilled"].includes(p.status)) {
      const sid = poSupplier.get(p.id);
      openPos.set(sid, (openPos.get(sid) || 0) + 1);
    }
  }
  return suppliers
    .map((supplier) => scoreSupplier({ supplier, findings: bySupplier.get(supplier.id) || [], openPoCount: openPos.get(supplier.id) || 0 }))
    .sort((a, b) => b.score - a.score);
}
