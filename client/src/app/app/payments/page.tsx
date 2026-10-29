"use client";

// Payments (/app/payments) — docs/plan/06 §5.7. Bank import + allocation
// status; unclear payments open the workbench view with engine solutions.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UploadCloud, X } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { Money, DateText, CertaintyBadge, ErrorState, Term, PageHeader, FadeIn, Card } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ALLOCATION_LABEL: Record<string, { label: string; classes: string }> = {
  linked: { label: "Linked", classes: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  partly: { label: "Partly linked", classes: "bg-[var(--likely-soft)] text-[var(--likely)]" },
  unclear: { label: "Unclear — needs your decision", classes: "bg-[var(--unclear-soft)] text-[var(--unclear)]" },
  not_linked: { label: "Not linked", classes: "bg-[var(--missing-soft)] text-[var(--missing)]" },
};

function Workbench({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["payment-workbench", paymentId], queryFn: () => v2.paymentWorkbench(paymentId) });
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;
  const { payment, solutions } = data;
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Where does this payment belong?</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {payment.supplier} · <Money value={payment.amount} /> · <DateText value={payment.date} /> · {payment.mode} · a/c {payment.bankAccountMasked}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close workbench" className="text-[var(--muted)] hover:text-[var(--ink)]"><X size={16} /></button>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--ink-2)]">
        The engine found two ways this could fit — Satya will not pick for you. Choose one, or allocate by hand.
        Attaching the supplier&apos;s remittance advice settles it for sure.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {solutions.map((solution) => (
          <div key={solution.id} className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 p-3 transition-colors hover:border-[var(--accent)]/40">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[var(--ink)]">{solution.label}</p>
              <CertaintyBadge certainty={solution.certainty} short />
            </div>
            <ul className="mt-2 space-y-1">
              {solution.allocations.map((allocation) => (
                <li key={allocation.document} className="flex justify-between text-xs text-[var(--ink-2)]">
                  <span>{allocation.document}</span>
                  <Money value={allocation.amount} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-[var(--muted)]">{solution.why}</p>
            <button type="button" className="mt-3 w-full rounded-[var(--radius-sm)] bg-[var(--accent)] py-1.5 text-xs font-medium text-white">
              Use this allocation
            </button>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3 text-xs">
        <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-1.5 font-medium text-[var(--ink-2)]">Allocate by hand</button>
        <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--accent)] px-3 py-1.5 font-medium text-[var(--accent-strong)]">Attach remittance advice</button>
        <span className="text-[var(--muted)]">Amounts must sum exactly — checked by the engine.</span>
      </div>
    </Card>
  );
}

export default function PaymentsPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payments"], queryFn: () => v2.payments() });
  const [workbench, setWorkbench] = useState<string | null>(null);

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Payments"
        description="Bank transfers matched to invoices. Unclear ones wait for your call — Satya never guesses."
        actions={
          <button type="button" className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--accent)]/50 px-4 py-2 text-sm font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]">
            <UploadCloud size={15} aria-hidden="true" /> Import bank CSV
          </button>
        }
      />

      {workbench && <Workbench paymentId={workbench} onClose={() => setWorkbench(null)} />}

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
      ) : (
        <ul className="space-y-2.5">
          {(data?.items ?? []).map((payment) => {
            const meta = ALLOCATION_LABEL[payment.status] ?? ALLOCATION_LABEL.not_linked;
            return (
              <li key={payment.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--ink-2)]/25">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--ink)]"><Money value={payment.amount} /> · {payment.supplier}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    <DateText value={payment.date} />
                    {payment.utr ? <> · <Term of="UTR">UTR</Term> <span className="font-code">{payment.utr}</span></> : " · no bank reference"}
                    {payment.linkedTo ? ` · pays ${payment.linkedTo}` : ""}
                  </p>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", meta.classes)}>{meta.label}</span>
                {payment.status === "unclear" && (
                  <button type="button" onClick={() => setWorkbench(payment.id)} className="rounded-[var(--radius-sm)] border border-[var(--accent)]/50 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]">
                    Resolve
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FadeIn>
  );
}
