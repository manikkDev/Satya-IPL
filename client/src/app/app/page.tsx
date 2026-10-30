"use client";

// Today (/app) — the working dashboard. Answer first (four numbers with
// drill-down), then attention + deadlines, then operations at a glance
// (aging, supplier spend, monthly series), compliance snapshot, and
// unallocated payments. Everything is read-only evidence from B's summary
// endpoints — clicking a card explains the number, never just navigates.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CalendarClock, Activity, Sparkles, Wallet } from "lucide-react";
import { v2, type DashboardSummary, type ComplianceSummary } from "@/lib/api/v2";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";

import {
  Money, StatCard, StatCardSkeleton, DateText, ErrorState, Term,
  Card, CardTitle, FadeIn, Stagger, StaggerItem,
} from "@/components/ui/v2";
import {
  KpiDrillDown, DrillRow, HBar, AgingBars, SeriesBars, IssueBreakdown,
  UnallocatedList, ComplianceStrip,
} from "@/components/v2/today-insights";
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

const MOCK_SUMMARY: DashboardSummary = {
  openValue: "145000.00", casesByStatus: { open: 2, in_review: 1 }, issuesBySeverity: { critical: 1, high: 3, medium: 2, low: 1 },
  findingsByCertainty: { CONFIRMED: 4, PROBABLE: 2, POSSIBLE: 1 }, openInvestigations: 3,
  aging: { "0-30": 2, "31-60": 1, "61-90": 0, "90+": 0 },
  spendBySupplier: [
    { supplierId: "sup_1", value: "98500.00", docs: 6 },
    { supplierId: "sup_2", value: "46500.00", docs: 3 },
    { supplierId: "sup_3", value: "12000.00", docs: 1 },
  ],
  monthlySeries: [
    { month: "2026-08", value: "50000.00", docs: 3 }, { month: "2026-09", value: "72000.00", docs: 4 }, { month: "2026-10", value: "145000.00", docs: 7 },
  ],
  unallocatedPayments: [{ documentId: "doc_pay3", amount: "15000.00", allocated: "0" }],
  recentDecisions: [],
};

const MOCK_COMPLIANCE: ComplianceSummary = {
  msme45: { count: 1, items: [] }, rule37: { count: 0, items: [], itcAtRisk: "0.00" },
  tdsSummary: {}, itcSummary: { total: "26550.00", blockedOrAtRisk: "0.00" },
  einvoiceCoverage: { withIrn: 4, invoices: 6, pct: 66.7 },
  creditNotesUnapplied: { count: 1, items: [] },
};

type Drill = "supported" | "disputed" | "itc" | "payments" | null;

export default function TodayPage() {
  const { user, activeEntity } = useSession();
  const [drill, setDrill] = useState<Drill>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["today", activeEntity?.id],
    queryFn: () => v2.today(activeEntity?.id),
  });
  const { data: summary } = useQuery({
    queryKey: ["dashboard-summary"],
    queryFn: () => (mocksEnabled() ? Promise.resolve(MOCK_SUMMARY) : v2.dashboardSummary()),
  });
  const { data: compliance } = useQuery({
    queryKey: ["compliance-summary"],
    queryFn: () => (mocksEnabled() ? Promise.resolve(MOCK_COMPLIANCE) : v2.complianceSummary()),
  });
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => v2.suppliers(),
  });

  const supplierName = useMemo(() => {
    const map = new Map((suppliers?.items ?? []).map((s) => [s.id, (s as { legalName?: string; name?: string }).legalName ?? s.name ?? s.id]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);

  const firstName = user?.name?.split(" ")[0] ?? "there";
  const maxSpend = Math.max(1, ...(summary?.spendBySupplier ?? []).map((s) => Number(s.value)));

  return (
    <FadeIn className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">Good day, {firstName}</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          {activeEntity ? activeEntity.legalName : "All entities"} · <DateText value={new Date().toISOString()} />
          {summary ? ` · ${summary.openInvestigations} open investigation${summary.openInvestigations === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : (
        <>
          {/* ---- the four numbers that matter ---- */}
          <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" key="stats">
            {isLoading || !data ? (
              <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
            ) : (
              <>
                <StaggerItem>
                  <StatCard label={BALANCE_TERMS.evidenceSupportedPayable.label} tip={BALANCE_TERMS.evidenceSupportedPayable.tip}
                    value={<Money value={data.supportedOutstanding ?? null} />}
                    delta="Backed by delivered & accepted goods" seeWhy="See why" tone="good"
                    onSeeWhy={() => setDrill("supported")} />
                </StaggerItem>
                <StaggerItem>
                  <StatCard label={BALANCE_TERMS.disputedExposure.label} tip={BALANCE_TERMS.disputedExposure.tip}
                    value={<Money value={data.moneyAtRisk} />}
                    delta={`${data.holds.count} hold${data.holds.count === 1 ? "" : "s"} · ${data.approvalsWaiting} approvals waiting`}
                    seeWhy="See why" tone="warn" onSeeWhy={() => setDrill("disputed")} />
                </StaggerItem>
                <StaggerItem>
                  <StatCard label={BALANCE_TERMS.itcAtRisk.label} tip={BALANCE_TERMS.itcAtRisk.tip}
                    value={<Money value={data.itcAtRisk} />}
                    delta="Across GSTR-2B and unpaid bills" seeWhy="See why" onSeeWhy={() => setDrill("itc")} />
                </StaggerItem>
                <StaggerItem>
                  <StatCard label="Payments due this week" tip="Payments that must go out this week to stay within agreed terms."
                    value={<Money value={data.paymentsDueWeek ?? null} />}
                    delta="Includes MSME 45-day deadlines" seeWhy="See payments" onSeeWhy={() => setDrill("payments")} />
                </StaggerItem>
              </>
            )}
          </Stagger>

          {/* ---- attention + deadlines ---- */}
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
                        <Link href={item.href} className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]">
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
                    {data && data.deadlines.length === 0 && <li className="text-sm text-[var(--muted)]">No upcoming deadlines.</li>}
                  </ul>
                )}
                <p className="mt-4 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-[var(--muted)]">
                  Includes <Term of="MSME">MSME</Term> 45-day, GST and delivery deadlines.
                </p>
              </Card>
            </section>
          </div>

          {/* ---- operations at a glance ---- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card>
              <CardTitle>Work queue age</CardTitle>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Open investigations by age — old ones stall the queue.</p>
              {summary ? <AgingBars aging={summary.aging} /> : <Skeleton className="h-28 w-full" />}
            </Card>
            <Card>
              <CardTitle>Spend by supplier</CardTitle>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Where the open value sits — click through to the supplier.</p>
              {summary ? (
                summary.spendBySupplier.length ? (
                  summary.spendBySupplier.slice(0, 5).map((s) => (
                    <HBar key={s.supplierId} label={supplierName(s.supplierId)} value={Number(s.value)} max={maxSpend}
                      display={`₹${Number(s.value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                      href={`/app/suppliers/${s.supplierId}`} />
                  ))
                ) : <p className="py-4 text-xs text-[var(--muted)]">No open supplier value yet.</p>
              ) : <Skeleton className="h-28 w-full" />}
            </Card>
            <Card>
              <CardTitle>Document volume</CardTitle>
              <p className="mb-3 text-[11px] text-[var(--muted)]">Monthly recorded document value — hover a bar for the figure.</p>
              {summary ? <SeriesBars series={summary.monthlySeries} /> : <Skeleton className="h-28 w-full" />}
            </Card>
          </div>

          {/* ---- compliance snapshot ---- */}
          <section aria-label="Compliance snapshot">
            <p className="mb-2.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
              Compliance snapshot
              <Link href="/app/compliance" className="inline-flex items-center gap-1 text-[11px] normal-case text-[var(--accent)] hover:underline">
                Open compliance <ArrowRight size={11} />
              </Link>
            </p>
            {compliance ? <ComplianceStrip summary={compliance} /> : <Skeleton className="h-24 w-full" />}
          </section>

          {/* ---- unallocated payments + recent activity ---- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <section aria-label="Payments waiting for a home" className="lg:col-span-2">
              <Card className="h-full">
                <CardTitle>
                  <span className="flex items-center gap-2"><Wallet size={15} aria-hidden="true" /> Unallocated payments</span>
                </CardTitle>
                {summary ? <UnallocatedList summary={summary} /> : <Skeleton className="h-20 w-full" />}
                {summary && summary.unallocatedPayments.length > 0 && (
                  <Link href="/app/payments" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
                    Open the workbench <ArrowRight size={12} />
                  </Link>
                )}
              </Card>
            </section>

            <section aria-label="Recent activity" className="lg:col-span-3">
              <Card className="h-full">
                <CardTitle>
                  <span className="flex items-center gap-2"><Activity size={15} aria-hidden="true" /> Recent activity</span>
                </CardTitle>
                {isLoading ? (
                  <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                ) : (
                  <ul className="divide-y divide-[var(--line)]">
                    {(data?.activity ?? []).slice(0, 6).map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <p className="text-sm text-[var(--ink-2)]">{item.text}</p>
                        <span className="shrink-0 text-xs text-[var(--muted)]"><DateText value={item.at} /></span>
                      </li>
                    ))}
                    {data && !data.activity?.length && <li className="text-sm text-[var(--muted)]">Nothing recorded yet.</li>}
                  </ul>
                )}
              </Card>
            </section>
          </div>
        </>
      )}

      {/* ---- KPI drill-downs ---- */}
      {drill === "supported" && summary && (
        <KpiDrillDown title={`${BALANCE_TERMS.evidenceSupportedPayable.label} — the breakdown`} onClose={() => setDrill(null)}>
          <DrillRow label="Open value across cases" value={`₹${Number(summary.openValue).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
          <DrillRow label="Open investigations" value={summary.openInvestigations} note="cases with a live snapshot" />
          <DrillRow label="Suppliers holding open value" value={summary.spendBySupplier.length} />
          <div className="mt-4">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Largest open positions</p>
            {summary.spendBySupplier.slice(0, 5).map((s) => (
              <HBar key={s.supplierId} label={supplierName(s.supplierId)} value={Number(s.value)} max={maxSpend}
                display={`₹${Number(s.value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
            ))}
          </div>
          <Link href="/app/investigations" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
            Open investigations <ArrowUpRight size={12} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "disputed" && summary && (
        <KpiDrillDown title={`${BALANCE_TERMS.disputedExposure.label} — what the issues look like`} onClose={() => setDrill(null)}>
          <IssueBreakdown summary={summary} />
          <Link href="/app/investigations" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
            Open investigations <ArrowUpRight size={12} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "itc" && compliance && (
        <KpiDrillDown title={`${BALANCE_TERMS.itcAtRisk.label} — where the credit stands`} onClose={() => setDrill(null)}>
          <DrillRow label="Total GST credit claimed" value={`₹${Number(compliance.itcSummary.total).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} />
          <DrillRow label="Blocked or at risk" value={`₹${Number(compliance.itcSummary.blockedOrAtRisk).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} note="Rule 37 unpaid + missing from GSTR-2B" />
          <DrillRow label="Invoices approaching the 180-day mark" value={compliance.rule37.count} />
          <DrillRow label="e-invoice coverage" value={`${compliance.einvoiceCoverage.pct}%`} note={`${compliance.einvoiceCoverage.withIrn} of ${compliance.einvoiceCoverage.invoices} invoices carry an IRN`} />
          <DrillRow label="Unapplied credit notes" value={compliance.creditNotesUnapplied.count} />
          <Link href="/app/compliance" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
            Open compliance <ArrowUpRight size={12} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "payments" && summary && (
        <KpiDrillDown title="Payments — what still needs a home" onClose={() => setDrill(null)}>
          <UnallocatedList summary={summary} />
          <Link href="/app/payments" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
            Open the payments workbench <ArrowUpRight size={12} />
          </Link>
        </KpiDrillDown>
      )}
    </FadeIn>
  );
}
