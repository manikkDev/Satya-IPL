"use client";

// Suppliers (/app/suppliers) — docs/plan/06 §5.8.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, ShieldCheck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { v2 } from "@/lib/api/v2";
import type { SupplierRow } from "@/lib/api/v2";
import { Money, ErrorState, EmptyState, Term, PageHeader, FadeIn } from "@/components/ui/v2";
import { DataTable } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuppliersPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const items = useMemo(() => {
    const q = query.toLowerCase();
    return (data?.items ?? []).filter((s) => !q || `${s.name} ${s.gstin}`.toLowerCase().includes(q));
  }, [data, query]);

  const columns = useMemo<ColumnDef<SupplierRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Supplier",
        cell: ({ row }) => (
          <span className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--surface-2)] text-[var(--ink-2)]">
              <Building2 size={14} aria-hidden="true" />
            </span>
            <span className="font-medium text-[var(--ink)]">{row.original.name}</span>
          </span>
        ),
      },
      {
        accessorKey: "gstin",
        header: "GSTIN",
        cell: ({ row }) => <span className="font-code text-xs text-[var(--ink-2)]">{row.original.gstin || "—"}</span>,
      },
      {
        accessorKey: "pan",
        header: "PAN",
        cell: ({ row }) => <span className="font-code text-xs text-[var(--ink-2)]">{row.original.pan || "—"}</span>,
      },
      {
        accessorKey: "msme",
        header: "Status",
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
              <ShieldCheck size={10} /> Active
            </span>
            {row.original.msme && (
              <span className="rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--likely)]">
                <Term of="MSME">{row.original.msme}</Term>
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "tags",
        header: "Category",
        cell: ({ row }) => (
          <span className="text-xs capitalize text-[var(--muted)]">{(row.original.tags ?? []).join(", ") || "—"}</span>
        ),
      },
      {
        accessorKey: "paymentTermsDays",
        header: "Terms",
        cell: ({ row }) => <span className="tnum text-xs">{row.original.paymentTermsDays ? `${row.original.paymentTermsDays} days` : "—"}</span>,
      },
      {
        accessorKey: "openValue",
        header: "Open value",
        cell: ({ row }) => (row.original.openValue ? <Money value={row.original.openValue} /> : <span className="text-[var(--muted)]">—</span>),
      },
      {
        accessorKey: "issueCount",
        header: "Issues",
        cell: ({ row }) => (row.original.issueCount ? <span className="font-medium text-[var(--sev-high)]">{row.original.issueCount}</span> : <span className="text-[var(--muted)]">—</span>),
      },
    ],
    [],
  );

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Suppliers"
        description="Vendor master — registration, tax, bank details and open exposure per supplier."
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or GSTIN…" aria-label="Search suppliers"
          className="h-9 w-72 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
        />
        <span className="text-xs text-[var(--muted)]">{items.length} supplier{items.length === 1 ? "" : "s"}</span>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No suppliers yet" body="Add suppliers from Settings → Masters, or create a purchase order." />
      ) : (
        <DataTable data={items} columns={columns} onRowClick={(row) => router.push(`/app/suppliers/${row.id}`)} ariaLabel="Suppliers" />
      )}
    </FadeIn>
  );
}
