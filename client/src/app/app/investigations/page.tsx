"use client";

// Investigations list (/app/investigations) — docs/plan/06 §5.6.

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { StatusBadge, SeverityBadge, ErrorState, EmptyState } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export default function InvestigationsPage() {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["cases"], queryFn: () => v2.cases() });
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Investigations</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          One check per order, supplier or payment — what Satya found, the evidence, and what to do next.
        </p>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No investigations yet"
          body="Investigations appear automatically once you have purchase orders and documents to check."
          actionLabel="Go to orders"
          onAction={() => router.push("/app/orders")}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => router.push(`/app/investigations/${item.id}`)}
                className="flex w-full items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 text-left hover:border-[var(--accent)]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                    <GitBranch size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--ink)]">{item.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {item.kind === "po" ? "Order check" : item.kind === "payment" ? "Payment check" : "Supplier check"}
                      {"findingCount" in item && item.findingCount ? ` · ${item.findingCount} open issue${item.findingCount === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {"severity" in item && item.severity ? <SeverityBadge severity={item.severity} /> : null}
                  <StatusBadge status={item.status} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
