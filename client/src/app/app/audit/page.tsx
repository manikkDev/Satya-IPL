"use client";

// Review history (/app/audit) — docs/plan/06 §5.12. Hash-chain status and
// export land with B9; list the decisions recorded so far meanwhile.

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, DateText, ErrorState } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";

export default function AuditPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["case", "case_po1001"], queryFn: () => v2.case("case_po1001") });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Review history</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Who decided what, when and why — the trail behind every number.</p>
      </div>

      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-xs text-[var(--muted)]">
        <ShieldCheck size={15} className="text-[var(--confirmed)]" aria-hidden="true" />
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
    </div>
  );
}
