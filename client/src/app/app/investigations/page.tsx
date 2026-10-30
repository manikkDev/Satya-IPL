"use client";

// Investigations (/app/investigations) — worklist per 06 §5.6.
// Real mode: GET /api/v2/cases returns per-case stats (finding counts,
// severity, open/disputed value, reconciled flag, last check) with
// page/pageSize/q/status/kind params — search + status chips + numbered pages.
// A case that was never reconciled shows "Not checked yet" — opening it
// offers a Run check button that triggers POST /cases/:id/reconcile.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { GitBranch, Search, ChevronLeft, ChevronRight, CircleCheck, Clock3 } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { StatusBadge, SeverityBadge, ErrorState, EmptyState, PageHeader, FadeIn, Card } from "@/components/ui/v2";
import type { Severity } from "@/lib/api/types";
import { Money } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type CaseRow = {
  id: string; title?: string; kind?: string; status: string; entityId?: string;
  subjectIds?: string[]; updatedAt?: string;
  reconciled?: boolean; lastReconciledAt?: string | null;
  findings?: number; topSeverity?: Severity | null;
  severity?: { critical?: number; high?: number; medium?: number; low?: number };
  openValue?: string | null; disputedValue?: string | null; recommendation?: string | null;
};

const STATUS_FILTERS = [["", "All"], ["open", "Open"], ["in_review", "In review"], ["resolved", "Resolved"], ["closed", "Closed"]];

function sevSummary(s?: CaseRow["severity"]) {
  if (!s) return null;
  const parts: string[] = [];
  if (s.critical) parts.push(`${s.critical} critical`);
  if (s.high) parts.push(`${s.high} high`);
  if (s.medium) parts.push(`${s.medium} medium`);
  if (s.low) parts.push(`${s.low} low`);
  return parts.join(" · ") || null;
}

export default function InvestigationsPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [debounced, status]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["cases", { q: debounced, status, page }],
    queryFn: () => v2.cases({ q: debounced, status, page: String(page), pageSize: "10" }),
  });
  const items = useMemo(() => (data?.items ?? []) as CaseRow[], [data]);
  const total = (data as { total?: number })?.total ?? items.length;
  const pages = (data as { pages?: number })?.pages ?? 1;
  const unchecked = items.filter((i) => !i.reconciled).length;

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Investigations"
        description="One check per order, supplier or payment — what Satya found, the evidence, and what to do next."
      />

      {/* filter bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search case, PO number, supplier…" aria-label="Search investigations"
            className="h-9 w-72 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]" />
        </div>
        <div className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] p-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)}
              className={cn("rounded-[calc(var(--radius-sm)-3px)] px-2.5 py-1 text-xs font-medium transition-colors",
                status === value ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--muted)] hover:text-[var(--ink)]")}>
              {label}
            </button>
          ))}
        </div>
        {unchecked > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Clock3 size={12} /> {unchecked} on this page not checked yet
          </span>
        )}
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px] w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title={debounced || status ? "Nothing matches" : "No investigations yet"}
          body={debounced || status ? "Try a different search or filter." : "Cases appear here automatically when a purchase order is issued."}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item, i) => (
              <motion.li key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.25 }}>
                <button
                  type="button"
                  onClick={() => router.push(`/app/investigations/${item.id}`)}
                  className="group flex w-full items-center gap-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)]/40"
                >
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)]",
                    item.topSeverity === "critical" || item.topSeverity === "high"
                      ? "bg-[var(--sev-high-soft)] text-[var(--sev-high)]"
                      : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>
                    <GitBranch size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-code text-sm font-medium text-[var(--ink)]">{item.title || item.id}</p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
                      <span>{item.kind === "po" ? "Order check" : item.kind === "supplier" ? "Supplier check" : "Check"}</span>
                      {item.reconciled ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[var(--confirmed)]"><CircleCheck size={11} /> checked</span>
                          {item.findings ? <span>{item.findings} finding{item.findings === 1 ? "" : "s"}{sevSummary(item.severity) ? ` (${sevSummary(item.severity)})` : ""}</span> : <span>clean</span>}
                          {item.openValue ? <span>· <Money value={item.openValue} /> recorded</span> : null}
                          {item.disputedValue ? <span className="text-[var(--sev-high)]">· <Money value={item.disputedValue} /> disputed</span> : null}
                        </>
                      ) : (
                        <span className="text-[var(--muted)]">not checked yet — open it to run the check</span>
                      )}
                    </p>
                  </div>
                  {item.topSeverity && <SeverityBadge severity={item.topSeverity} />}
                  <ChevronRight size={15} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </motion.li>
            ))}
          </ul>

          {/* numbered pagination */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-[var(--muted)]">Showing {(page - 1) * 10 + 1}–{Math.min(page * 10, total)} of {total}</p>
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} aria-label="Previous page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + Math.min(5, pages)).map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined}
                    className={cn("h-8 min-w-8 rounded-[var(--radius-sm)] border px-2 text-xs font-medium transition-colors",
                      n === page ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)]/50")}>
                    {n}
                  </button>
                ))}
                <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} aria-label="Next page"
                  className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 disabled:opacity-40">
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </FadeIn>
  );
}
