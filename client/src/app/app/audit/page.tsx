"use client";

// Review history (/app/audit) — docs/plan/06 §5.12. Hash-chain status and
// export land with B9; list the decisions recorded so far meanwhile.

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, DateText, ErrorState, PageHeader, FadeIn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuditPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["case", "case_po1001"], queryFn: () => v2.case("case_po1001") });

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Review history"
        description="Who decided what, when and why — the trail behind every number."
      />

      <div className="flex items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--confirmed)]/25 bg-[var(--confirmed-soft)] px-4 py-3 text-xs leading-relaxed text-[var(--muted)]">
        <ShieldCheck size={15} className="shrink-0 text-[var(--confirmed)]" aria-hidden="true" />
        Audit chain verification arrives with the audit API — entries here are read-only and time-ordered.
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : (
        <ol className="relative space-y-4 border-l border-[var(--line)] pl-5">
          {data.decisions.map((decision) => (
            <li key={decision.id}>
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
              <p className="text-sm text-[var(--ink)]">
                {decision.action.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                {"scope" in decision && decision.scope ? <> · <Money value={decision.scope} /></> : null}
                <span className="text-[var(--muted)]"> · on {data.case.title}</span>
              </p>
              <p className="mt-0.5 text-sm text-[var(--ink-2)]">{decision.reason}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{decision.actor} · {decision.role.replaceAll("_", " ")} · <DateText value={decision.createdAt} withTime /></p>
            </li>
          ))}
        </ol>
      )}
    </FadeIn>
  );
}
