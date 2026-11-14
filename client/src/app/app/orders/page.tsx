"use client";

// Orders list (/app/orders) — docs/plan/06 §5.2.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { v2 } from "@/lib/api/v2";
import type { OrderListRow } from "@/lib/mocks/data";
import { DataTable } from "@/components/ui/data-table";
import { Money, DateText, StatusBadge, ErrorState, EmptyState, PageHeader, FadeIn, Chip } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  ["", "All statuses"], ["issued", "Issued"], ["acknowledged", "Acknowledged"],
  ["partially_fulfilled", "Partly delivered"], ["fulfilled", "Fully delivered"],
  ["pending_approval", "Waiting for approval"], ["approved", "Approved"],
  ["short_closed", "Short-closed"], ["draft", "Draft"],
];

const SORT_OPTIONS = [
  ["attention", "Needs attention"], ["newest", "Newest first"], ["oldest", "Oldest first"], ["value", "Highest value"],
];

function ProgressCell({ pct }: { pct: string }) {
  const value = Math.min(100, Math.max(0, Number(pct)));
  if (value === 0) return <span className="text-xs text-[var(--muted)]">not started</span>;
  if (value >= 100) return <span className="tnum text-xs font-medium text-[var(--confirmed)]">100%</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${value}%` }} />
      </span>
      <span className="tnum text-xs">{pct}%</span>
    </span>
  );
}

/** Numbered pagination over an offset cursor — page N maps to offset (N-1)*size. */
function Pagination({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  const window = [...new Set([1, 2, page - 1, page, page + 1, pages - 1, pages])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  const items: (number | "…")[] = [];
  window.forEach((p, i) => {
    if (i > 0 && p - window[i - 1] > 1) items.push("…");
    items.push(p);
  });
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-sm)] px-2 text-xs font-medium transition-colors";
  return (
    <nav aria-label="Order pages" className="flex flex-wrap items-center justify-between gap-3">
      <p className="tnum text-xs text-[var(--muted)]">
        Showing {(page - 1) * size + 1}–{Math.min(page * size, total)} of {total}
      </p>
      <div className="flex items-center gap-1">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"
          className={cn(btn, "border border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)] disabled:opacity-40")}>
          <ChevronLeft size={14} />
        </button>
        {items.map((it, i) =>
          it === "…" ? (
            <span key={`gap-${i}`} className="px-1 text-xs text-[var(--muted)]">…</span>
          ) : (
            <button key={it} type="button" onClick={() => onPage(it)} aria-current={it === page ? "page" : undefined}
              className={cn(btn, it === page ? "bg-[var(--accent)] text-[var(--on-accent)]" : "border border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)]")}>
              {it}
            </button>
          ),
        )}
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"
          className={cn(btn, "border border-[var(--line)] text-[var(--ink-2)] hover:border-[var(--accent)] disabled:opacity-40")}>
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hasIssues, setHasIssues] = useState(false);
  const [sort, setSort] = useState("attention");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [status, debounced, hasIssues, sort]);

  const params = useMemo(() => ({
    limit: String(PAGE_SIZE), cursor: String((page - 1) * PAGE_SIZE), sort,
    ...(status ? { status } : {}), ...(debounced ? { q: debounced } : {}), ...(hasIssues ? { hasIssues: "1" } : {}),
  }), [page, sort, status, debounced, hasIssues]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["orders", params],
    queryFn: () => v2.orders(params),
    placeholderData: (prev) => prev,
  });
  const rows = data?.items ?? [];

  const columns = useMemo<ColumnDef<OrderListRow, unknown>[]>(
    () => [
      { accessorKey: "number", header: "PO number", cell: ({ row }) => <Link href={`/app/orders/${row.original.id}`} className="whitespace-nowrap font-code text-[14px] font-medium text-[var(--accent-strong)] underline-offset-2 hover:underline dark:text-[var(--accent)]">{row.original.number}</Link> },
      { accessorKey: "supplier", header: "Supplier", cell: ({ row }) => <span className="line-clamp-2 min-w-40 text-[var(--ink)]">{row.original.supplier}</span> },
      { accessorKey: "date", header: "Dated", cell: ({ row }) => <DateText value={row.original.date} className="whitespace-nowrap" /> },
      { accessorKey: "value", header: "Value", cell: ({ row }) => <Money value={row.original.value} className="whitespace-nowrap font-medium text-[var(--ink)]" /> },
      { accessorKey: "deliveredPct", header: "Delivered", cell: ({ row }) => <ProgressCell pct={row.original.deliveredPct} /> },
      { accessorKey: "invoicedPct", header: "Invoiced", cell: ({ row }) => <ProgressCell pct={row.original.invoicedPct} /> },
      { accessorKey: "paidPct", header: "Paid", cell: ({ row }) => <ProgressCell pct={row.original.paidPct} /> },
      {
        accessorKey: "issueCount", header: "Issues",
        cell: ({ row }) => (row.original.issueCount ? <span className="font-medium text-[var(--sev-high)]">{row.original.issueCount}</span> : <span className="text-[var(--muted)]">—</span>),
      },
      { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    ],
    [],
  );

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Orders"
        description="Every purchase order with how much has been delivered, billed and paid. Open one to see its full trail."
        actions={
          <Link
            href="/app/orders/new"
            className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 text-[15px] font-medium text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)]"
          >
            <Plus size={16} aria-hidden="true" /> New purchase order
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by PO number or supplier…" aria-label="Search orders"
          className="sm:w-72 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
        />
        <select
          value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-sm text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--accent)]"
        >
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort orders"
          className="h-10 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-sm text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--accent)]"
        >
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Chip active={hasIssues} onClick={() => setHasIssues((v) => !v)}>Has issues</Chip>
        {isFetching && !isLoading ? <span className="text-[14px] text-[var(--muted)]">Updating…</span> : null}
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : rows.length ? (
        <>
          <DataTable data={rows} columns={columns} onRowClick={(row) => router.push(`/app/orders/${row.id}`)} ariaLabel="Purchase orders" />
          <Pagination page={page} total={data?.total ?? 0} size={PAGE_SIZE} onPage={setPage} />
        </>
      ) : (
        <EmptyState
          title={debounced || status || hasIssues ? "No orders match" : "No purchase orders yet"}
          body={debounced || status || hasIssues ? "Try a different search, or clear the filters." : "Create a purchase order here — GST and HSN are worked out for you — or import your existing POs from Tally."}
          secondaryLabel={debounced || status || hasIssues ? undefined : "Import from Tally"}
          secondaryHref={debounced || status || hasIssues ? undefined : "/app/imports"}
          actionLabel="New purchase order"
          onAction={() => router.push("/app/orders/new")}
        />
      )}
    </FadeIn>
  );
}
