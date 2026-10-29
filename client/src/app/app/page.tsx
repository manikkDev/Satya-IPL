"use client";

// Today (/app) — answer first: the four numbers that matter, then what needs
// attention, deadlines and recent activity.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarClock, Activity, Sparkles } from "lucide-react";
import { v2 } from "@/lib/api/v2";
import { useSession } from "@/components/v2/session";
import {
  Money, StatCard, StatCardSkeleton, DateText, ErrorState, Term,
  Card, CardTitle, FadeIn,
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
  if (daysLeft < 0) return "text-[var(--sev-critical)] bg-[var(--sev-critical-soft)] border border-[var(--sev-critical)]/25";
  if (daysLeft <= 7) return "text-[var(--sev-medium)] bg-[var(--sev-medium-soft)] border border-[var(--sev-medium)]/25";
  return "text-[var(--muted)] bg-[var(--surface-2)] border border-[var(--line)]";
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
    <FadeIn className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">
          Good day, {firstName}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          {activeEntity ? activeEntity.legalName : "All entities"} ·{" "}
          <DateText value={new Date().toISOString()} />
        </p>
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <section aria-label="Needs your attention" className="lg:col-span-3">
              <Card className="h-full">
                <CardTitle>Needs your attention</CardTitle>
                {isLoading ? (
                  <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : data?.attention?.length ? (
                  <ul className="divide-y divide-[var(--line)]">
                    {data.attention.slice(0, 7).map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <p className="min-w-0 flex-1 text-sm text-[var(--ink-2)]">{item.text}</p>
                        <Link
                          href={item.href}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
                        >
                          {item.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-col items-start gap-3 py-2">
                    <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                      <Sparkles size={15} className="text-[var(--accent)]" aria-hidden="true" />
                      Nothing needs attention right now. Get set up:
                    </div>
                    <ol className="space-y-2 pl-1 text-sm text-[var(--ink-2)]">
                      <li className="flex items-baseline gap-2.5"><span className="tnum text-xs text-[var(--muted)]">1</span>Add your entity details (GSTIN, addresses)</li>
                      <li className="flex items-baseline gap-2.5"><span className="tnum text-xs text-[var(--muted)]">2</span>Add your suppliers</li>
                      <li className="flex items-baseline gap-2.5"><span className="tnum text-xs text-[var(--muted)]">3</span>Create your first purchase order, or import one</li>
                      <li className="flex items-baseline gap-2.5"><span className="tnum text-xs text-[var(--muted)]">4</span>Upload a document — an invoice, receipt or bank statement</li>
                      <li className="flex items-baseline gap-2.5"><span className="tnum text-xs text-[var(--muted)]">5</span>Ask Satya a question about your records</li>
                    </ol>
                  </div>
                )}
              </Card>
            </section>

            <section aria-label="Deadlines" className="lg:col-span-2">
              <Card className="h-full">
                <CardTitle>
                  <span className="flex items-center gap-2"><CalendarClock size={15} aria-hidden="true" /> Deadlines</span>
                </CardTitle>
                {isLoading ? (
                  <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : (
                  <ul className="space-y-3">
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
              </Card>
            </section>
          </div>

          <section aria-label="Recent activity">
            <Card>
              <CardTitle>
                <span className="flex items-center gap-2"><Activity size={15} aria-hidden="true" /> Recent activity</span>
              </CardTitle>
              {isLoading ? (
                <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {(data?.activity ?? []).map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <p className="text-sm text-[var(--ink-2)]">{item.text}</p>
                      <span className="shrink-0 text-xs text-[var(--muted)]"><DateText value={item.at} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </FadeIn>
  );
}
