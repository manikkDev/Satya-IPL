"use client";

// Orders list (/app/orders) — docs/plan/06 §5.2.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { v2 } from "@/lib/api/v2";
import type { OrderListRow } from "@/lib/mocks/data";
import { DataTable } from "@/components/ui/data-table";
import { Money, StatusBadge, ErrorState, EmptyState, PageHeader, FadeIn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_OPTIONS = [
  ["", "All statuses"], ["issued", "Issued"], ["acknowledged", "Acknowledged"],
  ["partially_fulfilled", "Partly delivered"], ["fulfilled", "Fully delivered"],
  ["pending_approval", "Waiting for approval"], ["draft", "Draft"],
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

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [hasIssues, setHasIssues] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["orders"], queryFn: () => v2.orders() });

  const rows = useMemo(() => {
    return (data?.items ?? []).filter((row) => {
      if (status && row.status !== status) return false;
      if (hasIssues && row.issueCount === 0) return false;
      if (query && !`${row.number} ${row.supplier}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [data, status, hasIssues, query]);

  const columns = useMemo<ColumnDef<OrderListRow, unknown>[]>(
    () => [
      { accessorKey: "number", header: "PO number", cell: ({ row }) => <Link href={`/app/orders/${row.original.id}`} className="font-code text-xs font-medium text-[var(--accent-strong)] underline-offset-2 hover:underline">{row.original.number}</Link> },
      { accessorKey: "supplier", header: "Supplier" },
      { accessorKey: "value", header: "Value", cell: ({ row }) => <Money value={row.original.value} /> },
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
        description="Purchase orders — what was agreed, what arrived, what is owed."
        actions={
          <Link
            href="/app/orders/new"
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-strong)]"
          >
            <Plus size={16} aria-hidden="true" /> New purchase order
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by number or supplier…" aria-label="Search orders"
          className="h-9 w-64 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
        />
        <select
          value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status"
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2 text-sm text-[var(--ink-2)] outline-none transition-colors focus:border-[var(--accent)]"
        >
          {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-2)]">
          <input type="checkbox" checked={hasIssues} onChange={(e) => setHasIssues(e.target.checked)} className="accent-[var(--accent)]" />
          Has issues
        </label>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : rows.length ? (
        <DataTable data={rows} columns={columns} onRowClick={(row) => router.push(`/app/orders/${row.id}`)} ariaLabel="Purchase orders" />
      ) : (
        <EmptyState
          title="No orders match"
          body="Try widening the filters, or create your first purchase order."
          actionLabel="New purchase order"
          onAction={() => router.push("/app/orders/new")}
        />
      )}
    </FadeIn>
  );
}
