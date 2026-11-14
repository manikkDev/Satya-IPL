// Report aggregations — exact paise sums (bigint), IST day counts.

import { paiseOf, sumPaise, daysBetween, fyOfDate, ZERO, type DocDetail, type FindingRaw } from "@/lib/api/v2-pages";

export type SupplierInfo = { id: string; name: string; msme: boolean; category?: string };

export type OpenInvoice = {
  id: string; number: string; date: string; supplier: string; supplierId?: string; msme: boolean;
  total: bigint; paid: bigint; outstanding: bigint; days: number; bucket: BucketKey | "future";
  poId?: string;
};

export const BUCKETS = [
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-45", label: "31–45 days", min: 31, max: 45 },
  { key: "46-60", label: "46–60 days", min: 46, max: 60 },
  { key: "60+", label: "Over 60 days", min: 61, max: Infinity },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"];

const LIVE = (d: DocDetail) => !["draft", "cancelled", "reversed"].includes(d.status);

const bucketOf = (days: number): BucketKey | "future" =>
  days < 0 ? "future" : (BUCKETS.find((b) => days >= b.min && days <= b.max)?.key ?? "60+");

/** Invoice total from the document; null when it was never recorded. */
const totalOf = (d: DocDetail): bigint | null => {
  const grand = d.totals?.grand;
  if (grand === undefined || grand === null || grand === "") return null;
  return paiseOf(grand);
};

export function buildPayables(invoices: DocDetail[], payments: DocDetail[], suppliers: SupplierInfo[]) {
  const paid = new Map<string, bigint>();
  for (const p of payments.filter(LIVE)) {
    for (const a of p.payment?.allocations ?? []) paid.set(a.documentId, (paid.get(a.documentId) ?? ZERO) + paiseOf(a.amount));
  }
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const byName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s]));
  const supplierOf = (d: DocDetail) => {
    const sid = d.supplierId ?? (d.seller as { supplierId?: string } | undefined)?.supplierId;
    return (sid ? byId.get(sid) : undefined) ?? (d.seller?.name ? byName.get(d.seller.name.toLowerCase()) : undefined);
  };

  const open: OpenInvoice[] = [];
  let missingAmount = 0;
  for (const d of invoices.filter(LIVE)) {
    const total = totalOf(d);
    if (total === null) {
      missingAmount += 1;
      continue;
    }
    const settled = paid.get(d.id) ?? ZERO;
    const outstanding = total - settled;
    if (outstanding <= ZERO) continue;
    const sup = supplierOf(d);
    const days = daysBetween(d.date);
    const poId = (d.lines ?? []).map((l) => (l as { refs?: { poId?: string } }).refs?.poId).find(Boolean);
    open.push({
      id: d.id, number: d.number ?? d.externalRef ?? d.id, date: d.date,
      supplier: sup?.name ?? d.seller?.name ?? "Supplier not recorded", supplierId: sup?.id,
      msme: Boolean(sup?.msme), total, paid: settled, outstanding, days, bucket: bucketOf(days), poId,
    });
  }
  open.sort((a, b) => b.days - a.days);

  const rows = BUCKETS.map((b) => {
    const inBucket = open.filter((o) => o.bucket === b.key);
    const msme = inBucket.filter((o) => o.msme);
    return {
      key: b.key, label: b.label,
      count: inBucket.length, amount: sumPaise(inBucket.map((o) => o.outstanding)),
      msmeCount: msme.length, msmeAmount: sumPaise(msme.map((o) => o.outstanding)),
    };
  });
  const future = open.filter((o) => o.bucket === "future");
  const total = sumPaise(open.map((o) => o.outstanding));
  return { open, rows, future: { count: future.length, amount: sumPaise(future.map((o) => o.outstanding)) }, total, missingAmount };
}

export function buildSpend(invoices: DocDetail[], suppliers: SupplierInfo[], fy: string) {
  const byId = new Map(suppliers.map((s) => [s.id, s]));
  const groups = new Map<string, { key: string; name: string; supplierId?: string; msme: boolean; amount: bigint; count: number }>();
  let missingAmount = 0;
  for (const d of invoices.filter(LIVE)) {
    if (fy && (d.fy ?? fyOfDate(d.date)) !== fy) continue;
    const total = totalOf(d);
    if (total === null) {
      missingAmount += 1;
      continue;
    }
    const sid = d.supplierId ?? (d.seller as { supplierId?: string } | undefined)?.supplierId;
    const sup = sid ? byId.get(sid) : undefined;
    const name = sup?.name ?? d.seller?.name ?? "Supplier not recorded";
    const key = sup?.id ?? (d.seller?.gstin || name).toLowerCase();
    const g = groups.get(key) ?? { key, name, supplierId: sup?.id, msme: Boolean(sup?.msme), amount: ZERO, count: 0 };
    g.amount += total;
    g.count += 1;
    groups.set(key, g);
  }
  const all = [...groups.values()].sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const grand = sumPaise(all.map((g) => g.amount));
  return { top: all.slice(0, 10), others: all.slice(10), grand, supplierCount: all.length, missingAmount };
}

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export const findingTypeLabel = (code?: string) =>
  code ? code.toLowerCase().replaceAll("_", " ").replace(/\bgstin\b/g, "GSTIN").replace(/\bgrn\b/g, "GRN").replace(/\bfy\b/g, "FY").replace(/^\w/, (c) => c.toUpperCase()) : "Other";

export function buildFindings(items: FindingRaw[]) {
  const rows = new Map<string, { code: string; counts: Record<string, number>; total: number; exposure: bigint }>();
  const bySeverity: Record<string, number> = {};
  for (const f of items) {
    const code = f.code ?? "OTHER";
    const sev = SEVERITIES.includes((f.severity ?? "info").toLowerCase() as (typeof SEVERITIES)[number]) ? (f.severity ?? "info").toLowerCase() : "info";
    const row = rows.get(code) ?? { code, counts: {}, total: 0, exposure: ZERO };
    row.counts[sev] = (row.counts[sev] ?? 0) + 1;
    row.total += 1;
    row.exposure += paiseOf(f.exposure?.amount ?? f.data?.amount ?? null);
    rows.set(code, row);
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }
  const sevRank = (r: { counts: Record<string, number> }) => SEVERITIES.map((s) => r.counts[s] ?? 0);
  const list = [...rows.values()].sort((a, b) => {
    const ra = sevRank(a), rb = sevRank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return b.total - a.total;
  });
  return { rows: list, bySeverity, exposure: sumPaise(list.map((r) => r.exposure)) };
}
