"use client";

// Today (/app) — docs/plan/06 §5.1. Answer first: the four numbers that
// matter, then what needs attention, deadlines and recent activity.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Activity } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { useSession } from "@/components/v2/session";
import {
  Money, StatCard, StatCardSkeleton, DateText, ErrorState, Term,
} from "@/components/ui/v2";
import { BALANCE_TERMS } from "@/content/copy/vocabulary";
import { daysLeftText } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const DEADLINE_LABEL: Record<string, string> = {
  MSME_45: "MSME 45-day payment",
  RULE_37_180: "GST credit reversal risk (180 days unpaid)",
  EINVOICE_30: "e-invoice reporting window",
  PO_DELIVERY: "Delivery due",
};

function deadlineTone(daysLeft: number) {
  if (daysLeft < 0) return "text-[var(--sev-critical)] bg-[var(--sev-critical-soft)]";
  if (daysLeft <= 7) return "text-[var(--sev-medium)] bg-[var(--sev-medium-soft)]";
  return "text-[var(--muted)] bg-[var(--surface-2)]";
}

export default function TodayPage() {
  const { user, activeEntity } = useSession();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["today", activeEntity?.id],
    queryFn: () => v2.today(activeEntity?.id),
  });

  const firstName = user?.name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[var(--ink)]">
            Good day, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {activeEntity ? activeEntity.legalName : "All entities"} ·{" "}
            <DateText value={new Date().toISOString()} />
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {isLoading || !data ? (
              <>
                <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
              </>
            ) : (
              <>
                <StatCard
                  label={BALANCE_TERMS.evidenceSupportedPayable.label}
                  tip={BALANCE_TERMS.evidenceSupportedPayable.tip}
                  value={<Money value={data.supportedOutstanding ?? null} />}
                  delta="Backed by delivered & accepted goods"
                  seeWhy="See why"
                  onSeeWhy={() => router.push("/app/investigations")}
                />
                <StatCard
                  label={BALANCE_TERMS.disputedExposure.label}
                  tip={BALANCE_TERMS.disputedExposure.tip}
                  value={<Money value={data.moneyAtRisk} />}
                  delta={`${data.holds.count} hold${data.holds.count === 1 ? "" : "s"} · ${data.approvalsWaiting} approvals waiting`}
                  seeWhy="See why"
                  onSeeWhy={() => router.push("/app/investigations")}
                />
                <StatCard
                  label={BALANCE_TERMS.itcAtRisk.label}
                  tip={BALANCE_TERMS.itcAtRisk.tip}
                  value={<Money value={data.itcAtRisk} />}
                  delta="Across GSTR-2B and unpaid bills"
                  seeWhy="See why"
                  onSeeWhy={() => router.push("/app/compliance")}
                />
                <StatCard
                  label="Payments due this week"
                  tip="Payments that must go out this week to stay within agreed terms."
                  value={<Money value={data.paymentsDueWeek ?? null} />}
                  delta="Includes MSME 45-day deadlines"
                  seeWhy="See payments"
                  onSeeWhy={() => router.push("/app/payments")}
                />
              </>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <section aria-label="Needs your attention" className="lg:col-span-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h2 className="text-base font-semibold text-[var(--ink)]">Needs your attention</h2>
              {isLoading ? (
                <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : data?.attention?.length ? (
                <ul className="mt-4 divide-y divide-[var(--line)]">
                  {data.attention.slice(0, 7).map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <p className="min-w-0 flex-1 text-sm text-[var(--ink-2)]">{item.text}</p>
                      <Link
                        href={item.href}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
                      >
                        {item.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4">
                  <p className="text-sm text-[var(--muted)]">Nothing needs attention right now. Get set up:</p>
                  <ol className="mt-3 space-y-2 text-sm text-[var(--ink-2)] list-decimal list-inside">
                    <li>Add your entity details (GSTIN, addresses)</li>
                    <li>Add your suppliers</li>
                    <li>Create your first purchase order, or import one</li>
                    <li>Upload a document — an invoice, receipt or bank statement</li>
                    <li>Ask Satya a question about your records</li>
                  </ol>
                </div>
              )}
            </section>

            <section aria-label="Deadlines" className="lg:col-span-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
                <CalendarClock size={17} aria-hidden="true" /> Deadlines
              </h2>
              {isLoading ? (
                <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {(data?.deadlines ?? []).map((deadline) => (
                    <li key={`${deadline.kind}-${deadline.documentId}`} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--ink)]">{DEADLINE_LABEL[deadline.kind] ?? deadline.kind}</p>
                        <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
                          {deadline.supplier} · <Money value={deadline.amount} /> · due <DateText value={deadline.dueDate} />
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${deadlineTone(deadline.daysLeft)}`}>
                        {daysLeftText(deadline.daysLeft)}
                      </span>
                    </li>
                  ))}
                  {data && data.deadlines.length === 0 && (
                    <li className="text-sm text-[var(--muted)]">No upcoming deadlines.</li>
                  )}
                </ul>
              )}
              <p className="mt-4 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-[var(--muted)]">
                Includes <Term of="MSME">MSME</Term> 45-day, GST and delivery deadlines.
              </p>
            </section>
          </div>

          <section aria-label="Recent activity" className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--ink)]">
              <Activity size={17} aria-hidden="true" /> Recent activity
            </h2>
            {isLoading ? (
              <div className="mt-4 space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <ul className="mt-4 divide-y divide-[var(--line)]">
                {(data?.activity ?? []).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <p className="text-sm text-[var(--ink-2)]">{item.text}</p>
                    <span className="shrink-0 text-xs text-[var(--muted)]"><DateText value={item.at} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
