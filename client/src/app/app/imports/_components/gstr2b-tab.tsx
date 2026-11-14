"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, ReceiptIndianRupee, Loader2 } from "lucide-react";
import { importsApi } from "@/lib/api/imports";
import { EmptyState, ErrorState, Btn, Money, DateText } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Pill, Count, errorText } from "./shared";

const STATUS: Record<string, { label: string; tone: "create" | "warning" | "error" | "unchanged" | "update"; help: string }> = {
  matched: { label: "Matched", tone: "create", help: "Books and the supplier's filing agree" },
  amount_differs: { label: "Amount differs", tone: "warning", help: "Same invoice, different tax or value" },
  only_in_books: { label: "Missing from 2B", tone: "error", help: "Supplier has not reported it — ITC at risk" },
  only_in_2b: { label: "Only in 2B", tone: "warning", help: "Supplier reported it; no purchase invoice in your books" },
  pending_2b: { label: "Awaiting 2B", tone: "unchanged", help: "Dated after the latest imported 2B period" },
  before_2b_import: { label: "Before imported periods", tone: "unchanged", help: "No 2B imported for that month yet" },
  no_gstin: { label: "No GSTIN", tone: "unchanged", help: "Supplier GSTIN missing on the invoice" },
};
const ORDER = ["only_in_books", "amount_differs", "only_in_2b", "matched", "pending_2b", "before_2b_import", "no_gstin"];

export function Gstr2bTab({ entityId, canImport }: { entityId: string; canImport: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [period, setPeriod] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["gstr2b-status", entityId, period], queryFn: () => importsApi.gstr2bStatus({ entityId, period }), enabled: Boolean(entityId) });
  const rematch = async () => {
    setBusy(true);
    try {
      const r = await importsApi.gstr2bRematch(entityId);
      toast.success(`Re-matched: ${r.stats.matched} matched, ${r.changed} changed`);
      qc.invalidateQueries({ queryKey: ["gstr2b-status"] });
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  };
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  if (q.error) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />;
  const data = q.data!;
  if (!data.periods.length) return <EmptyState icon={ReceiptIndianRupee} title="No GSTR-2B imported yet" body="Import the GSTR-2B JSON from the GST portal (New import → GSTR-2B JSON). Each purchase invoice is then matched on supplier GSTIN, invoice number and financial year." />;
  const rows = status ? data.items.filter((r) => r.status === status) : data.items;
  const c = data.counts;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Count label="Matched" value={c.matched ?? 0} tone="good" />
        <Count label="Amount differs" value={c.amount_differs ?? 0} tone={c.amount_differs ? "warn" : "muted"} />
        <Count label="Missing from 2B" value={c.only_in_books ?? 0} tone={c.only_in_books ? "bad" : "muted"} hint="supplier hasn't filed" />
        <Count label="ITC at risk" value={`₹${Number(data.itcAtRisk).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} tone={Number(data.itcAtRisk) > 0 ? "warn" : "muted"} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Match status">
          <button type="button" aria-pressed={!status} onClick={() => setStatus("")} className={cn("rounded-full px-3 py-1 text-[13px] font-medium", !status ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-2)] text-[var(--ink-2)] hover:bg-[var(--surface-3)]")}>All</button>
          {ORDER.filter((s) => c[s]).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} title={STATUS[s].help} onClick={() => setStatus(s)}
              className={cn("rounded-full px-3 py-1 text-[13px] font-medium", status === s ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-2)] text-[var(--ink-2)] hover:bg-[var(--surface-3)]")}>
              {STATUS[s].label} <span className="tnum opacity-75">{c[s]}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Return period" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[14px] text-[var(--ink)]">
            <option value="">All periods</option>
            {data.periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {canImport ? <Btn size="sm" variant="secondary" icon={busy ? Loader2 : RefreshCw} onClick={rematch} disabled={busy}>Re-match</Btn> : null}
        </div>
      </div>
      <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
        {rows.map((r) => {
          const meta = STATUS[r.status] ?? STATUS.no_gstin;
          return (
            <li key={`${r.kind}-${r.documentId}`} className="flex flex-col gap-1.5 border-b border-[var(--line)] px-4 py-3 last:border-0 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-[var(--ink)]">{r.number} <span className="font-normal text-[var(--muted)]">· {r.supplier ?? r.gstin}</span></p>
                <p className="mt-0.5 text-[13px] text-[var(--muted)]">
                  <DateText value={r.date} /> · GSTIN {r.gstin ?? "—"}{r.basis === "number_variant" ? " · matched despite a different number format" : ""}
                  {r.diff && r.status === "amount_differs" ? ` · 2B differs by ₹${r.diff.tax} tax, ₹${r.diff.value} value` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-[15px] tnum text-[var(--ink)]"><Money value={r.amount as string} /></span>
                <Pill tone={meta.tone}>{meta.label}</Pill>
                {r.caseId ? <Link href={`/app/investigations/${r.caseId}`} className="text-[13px] font-medium text-[var(--accent)] hover:underline">Case</Link> : null}
              </div>
            </li>
          );
        })}
        {!rows.length ? <li className="px-5 py-8 text-center text-sm text-[var(--muted)]">Nothing in this view.</li> : null}
      </ul>
      <p className="text-[13px] text-[var(--muted)]">{data.note}</p>
    </div>
  );
}
