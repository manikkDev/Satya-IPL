"use client";

// Suppliers (/app/suppliers) — docs/plan/06 §5.8.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, CircleCheck, CircleAlert } from "lucide-react";
import { workflow } from "@/lib/api/workflow";
import { RiskBadge } from "@/components/v2/risk-badge";
import { mocksEnabled } from "@/lib/flags";
import type { ColumnDef } from "@tanstack/react-table";
import { v2 } from "@/lib/api/v2";
import type { SupplierRow } from "@/lib/api/v2";
import { ErrorState, EmptyState, Term, PageHeader, FadeIn } from "@/components/ui/v2";
import { DataTable } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuppliersPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const risks = useQuery({ queryKey: ["supplier-risks"], queryFn: workflow.supplierRisks, enabled: !mocksEnabled(), retry: 0 });
  const riskById = useMemo(() => new Map((risks.data?.items ?? []).map((r) => [r.supplierId, r])), [risks.data]);
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
        cell: ({ row }) => {
          const g = row.original.gstin;
          if (!g) return <span className="text-xs text-[var(--sev-high)]">Missing</span>;
          return <span className="whitespace-nowrap font-code text-xs text-[var(--ink-2)]">{g}</span>;
        },
      },
      {
        accessorKey: "msme",
        header: "MSME",
        cell: ({ row }) =>
          row.original.msme ? (
            <span className="whitespace-nowrap rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[13px] font-medium capitalize text-[var(--likely)]">
              <Term of="MSME">{row.original.msme}</Term>
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">—</span>
          ),
      },
      {
        accessorKey: "paymentTermsDays",
        header: "Terms",
        cell: ({ row }) => <span className="tnum whitespace-nowrap text-xs">{row.original.paymentTermsDays ? `${row.original.paymentTermsDays} days` : "—"}</span>,
      },
      {
        id: "issues",
        header: "Open issues",
        cell: ({ row }) => {
          const r = riskById.get(row.original.id);
          if (!r) return <span className="text-xs text-[var(--muted)]">—</span>;
          return r.openIssues ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--sev-high)]"><CircleAlert size={13} aria-hidden="true" />{r.openIssues}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-[var(--confirmed)]"><CircleCheck size={13} aria-hidden="true" />None</span>
          );
        },
      },
      {
        id: "risk",
        header: "Risk",
        cell: ({ row }) => <RiskBadge risk={riskById.get(row.original.id)} />,
      },
    ],
    [riskById],
  );

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Suppliers"
        description="Everyone you buy from: GST and MSME registration, bank accounts, what you owe them, and a risk score that shows how it was worked out."
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or GSTIN…" aria-label="Search suppliers"
          className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] sm:w-72 bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
        />
        <span className="text-[14px] text-[var(--muted)]">{items.length} supplier{items.length === 1 ? "" : "s"}</span>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title={query ? "No suppliers match" : "No suppliers yet"} body={query ? "Try a different name or GSTIN." : "Suppliers are added automatically when you import Tally ledgers or confirm an invoice. You can also add one in Settings."} actionLabel={query ? undefined : "Import data"} actionHref={query ? undefined : "/app/imports"} secondaryLabel={query ? undefined : "Add in Settings"} secondaryHref={query ? undefined : "/app/settings"} />
      ) : (
        <DataTable data={items} columns={columns} onRowClick={(row) => router.push(`/app/suppliers/${row.id}`)} ariaLabel="Suppliers" />
      )}
    </FadeIn>
  );
}
