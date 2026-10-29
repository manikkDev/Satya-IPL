"use client";

// Suppliers (/app/suppliers) — docs/plan/06 §5.8.

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, ErrorState, EmptyState, Term, PageHeader, FadeIn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export default function SuppliersPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });
  const items = data?.items ?? [];

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Suppliers"
        description="Open orders, overdue MSME amounts and issues per supplier."
      />
      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState title="No suppliers yet" body="Add suppliers from Settings → Masters, or create a purchase order." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map((supplier) => (
            <li key={supplier.id}>
              <button
                type="button"
                onClick={() => router.push(`/app/suppliers/${supplier.id}`)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--surface-2)]/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--ink-2)]">
                      <Building2 size={17} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">{supplier.name}</p>
                      <p className="font-code mt-0.5 text-[11px] text-[var(--muted)]">{supplier.gstin}</p>
                    </div>
                  </div>
                  {supplier.msme && (
                    <span className="shrink-0 rounded-full bg-[var(--likely-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--likely)]">
                      {supplier.msme} <Term of="MSME">MSME</Term>
                    </span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--muted)]">
                  {supplier.openValue ? (
                    <span>Open: <Money value={supplier.openValue} className="font-medium text-[var(--ink)]" /></span>
                  ) : null}
                  {supplier.overdue && <span className="text-[var(--sev-high)]">Overdue MSME: <Money value={supplier.overdue} /></span>}
                  {supplier.issueCount > 0 && <span className="text-[var(--sev-high)]">{supplier.issueCount} issue{supplier.issueCount === 1 ? "" : "s"}</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </FadeIn>
  );
}
