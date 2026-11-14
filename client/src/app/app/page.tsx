"use client";

// Home (/app) answers, in this order:
//   1. What needs me today — one prioritised to-do list (₹ at stake, deadline,
//      the action) built from open issues and statutory deadlines.
//   2. The four numbers that matter, each with a plain explanation and a
//      "see why" drill-down.
//   3. Upcoming deadlines, payments without a home, recent activity.
// A brand-new workspace (no data yet) is sent to /app/setup once per session.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, ArrowUpRight, CalendarClock, Activity, Wallet, OctagonAlert, TriangleAlert, CircleAlert, Clock,
  CheckCircle2, Plus, Upload, type LucideIcon,
} from "lucide-react";
import { v2, type DashboardSummary, type ComplianceSummary } from "@/lib/api/v2";
import type { Finding, Deadline } from "@/lib/api/types";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { onboarding, setupDismissKey } from "@/lib/api/onboarding";
import {
  Money, StatCard, StatCardSkeleton, DateText, ErrorState, Term, Card, CardTitle, FadeIn, Stagger, StaggerItem,
  BtnLink, SectionHeader, InfoTip,
} from "@/components/ui/v2";
import { KpiDrillDown, DrillRow, HBar, IssueBreakdown, UnallocatedList, ComplianceStrip } from "@/components/v2/today-insights";
import { BALANCE_TERMS } from "@/content/copy/vocabulary";
import { daysLeftText, formatMoney, formatDate, toPaise } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const DEADLINE_LABEL: Record<string, string> = {
  MSME_45: "MSME 45-day payment limit",
  RULE_37_180: "180-day GST credit rule",
  EINVOICE_30: "e-invoice reporting window",
  PO_DELIVERY: "Delivery due",
};

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

/* ---------------- to-do list ---------------- */

type Todo = {
  id: string;
  rank: number;
  tone: "bad" | "warn" | "info";
  title: string;
  /** Short rule name shown in the meta line, with a plain explanation on hover. */
  rule?: { label: string; tip: string };
  why?: string;
  amount?: string | null;
  due?: { daysLeft: number; date: string };
  href: string;
  action: string;
};

const TONE_ICON: Record<Todo["tone"], { icon: LucideIcon; color: string; word: string }> = {
  bad: { icon: OctagonAlert, color: "var(--sev-critical)", word: "Urgent" },
  warn: { icon: TriangleAlert, color: "var(--sev-high)", word: "Soon" },
  info: { icon: CircleAlert, color: "var(--sev-low)", word: "Check" },
};

const exposureOf = (f: Finding): string | null => {
  const e = f.exposure as { amount?: string; max?: { amount: string } } | undefined;
  return e?.amount ?? e?.max?.amount ?? null;
};

function buildTodos(findings: Finding[], deadlines: Deadline[]): Todo[] {
  const todos: Todo[] = [];
  for (const d of deadlines) {
    if (d.daysLeft > 14) continue;
    const overdue = d.daysLeft < 0;
    const base = { id: `dl-${d.kind}-${d.documentId}`, amount: d.amount?.amount ?? null, due: { daysLeft: d.daysLeft, date: d.dueDate } };
    const heldPaise = toPaise(d.disputed?.amount ?? "0");
    if (d.kind === "MSME_45" && heldPaise > BigInt(0)) {
      const payable = d.payable?.amount ?? "0";
      const fullyHeld = toPaise(payable) === BigInt(0);
      const duplicate = (d.disputeCodes ?? []).some((c) => c.startsWith("DUP"));
      todos.push({
        ...base, rank: overdue ? 1 : 3, tone: "bad",
        title: fullyHeld
          ? `${duplicate ? "Likely duplicate bill" : "Disputed bill"} from ${d.supplier} — resolve before paying`
          : `Pay ${d.supplier} only the undisputed ${formatMoney(payable)}`,
        rule: { label: "On hold", tip: `${formatMoney(d.disputed?.amount)} of this bill is disputed (${duplicate ? "it looks like a duplicate posting" : "it doesn’t match what was received, accepted or agreed"}). The MSME clock still runs, so settle the dispute with the supplier quickly.` },
        href: d.caseId ? `/app/investigations/${d.caseId}` : "/app/investigations", action: "Review issue",
      });
      continue;
    }
    if (d.kind === "MSME_45") {
      todos.push({
        ...base, rank: overdue ? 0 : d.daysLeft <= 7 ? 2 : 4, tone: overdue || d.daysLeft <= 3 ? "bad" : "warn",
        title: `Pay ${d.supplier}`,
        rule: { label: "MSME 45-day limit", tip: "Paying a micro or small supplier after 45 days costs interest at 3× the RBI rate, and the expense can’t be deducted from income tax this year." },
        href: "/app/compliance", action: "Plan payment",
      });
    } else if (d.kind === "RULE_37_180") {
      todos.push({
        ...base, rank: overdue ? 0 : 3, tone: overdue ? "bad" : "warn",
        title: `Pay ${d.supplier} or reverse the GST credit`,
        rule: { label: "180-day GST credit rule", tip: "Bills unpaid for 180 days force you to give back the GST credit you claimed, with interest." },
        href: "/app/compliance", action: "Review",
      });
    } else if (d.kind === "EINVOICE_30") {
      todos.push({ ...base, rank: 5, tone: "info", title: `Check the e-invoice from ${d.supplier}`, rule: { label: "e-invoice check", tip: "Without a valid e-invoice number (IRN) the bill may never reach your GST statement, so you can’t claim the credit." }, href: "/app/compliance", action: "Check" });
    } else {
      todos.push({ ...base, rank: 6, tone: "info", title: `Delivery due from ${d.supplier}`, href: `/app/orders/${d.documentId}`, action: "Open order" });
    }
  }
  for (const f of findings) {
    const caseId = (f as Finding & { caseId?: string }).caseId;
    const sev = f.severity as string;
    if (sev === "info" || sev === "low") continue;
    todos.push({
      id: `f-${f.id}`, rank: sev === "critical" ? 1 : sev === "high" ? 3 : 5, tone: sev === "critical" ? "bad" : sev === "high" ? "warn" : "info",
      title: f.title, why: f.whatResolvesIt ? `To settle it: ${f.whatResolvesIt}` : undefined, amount: exposureOf(f),
      href: caseId ? `/app/investigations/${caseId}` : "/app/investigations", action: "Review",
    });
  }
  return todos.sort((a, b) => a.rank - b.rank || (a.due?.daysLeft ?? 99) - (b.due?.daysLeft ?? 99));
}

function TodoRow({ todo }: { todo: Todo }) {
  const tone = TONE_ICON[todo.tone];
  const Icon = tone.icon;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon size={20} className="mt-0.5 shrink-0" style={{ color: tone.color }} aria-label={tone.word} />
        <div className="min-w-0">
          <p className="text-base font-medium leading-snug text-[var(--ink)]">{todo.title}</p>
          {todo.why ? <p className="mt-1 text-[14px] leading-relaxed text-[var(--muted)]">{todo.why}</p> : null}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px]">
            {todo.rule ? (
              <span className="inline-flex items-center gap-1 text-[var(--ink-2)]">
                {todo.rule.label}
                <InfoTip label={`About the ${todo.rule.label}`}>{todo.rule.tip}</InfoTip>
              </span>
            ) : null}
            {todo.amount ? (
              <span className="text-[var(--ink-2)]">
                At stake <span className="font-semibold text-[var(--ink)] tnum">{formatMoney(todo.amount)}</span>
              </span>
            ) : null}
            {todo.due ? (
              <span className="inline-flex items-center gap-1.5" style={{ color: todo.due.daysLeft < 0 ? "var(--sev-critical)" : todo.due.daysLeft <= 7 ? "var(--sev-medium)" : "var(--muted)" }}>
                <Clock size={14} aria-hidden="true" />
                {daysLeftText(todo.due.daysLeft)} · {formatDate(todo.due.date)}
              </span>
            ) : null}
          </p>
        </div>
      </div>
      <Link
        href={todo.href}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 text-[14px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] sm:self-center"
      >
        {todo.action} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </li>
  );
}

function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Kolkata" }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Sends a brand-new workspace to the setup checklist once per browser session. */
function useFirstRunRedirect() {
  const router = useRouter();
  const { mocks, group, hasPermission } = useSession();
  const { data } = useQuery({ queryKey: ["onboarding-status"], queryFn: () => onboarding.status(), enabled: !mocks, staleTime: 60_000 });
  useEffect(() => {
    if (!data || !group?.id || group.plan === "demo" || !data.isNew || data.dismissedAt || !hasPermission("entity.manage")) return;
    try {
      if (localStorage.getItem(setupDismissKey(group.id)) === "1") return;
      const key = `satya.setup.autoOpened.${group.id}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage unavailable: still open setup */
    }
    router.replace("/app/setup");
  }, [data, group, hasPermission, router]);
  return data;
}

export default function HomePage() {
  const { user, activeEntity } = useSession();
  const [drill, setDrill] = useState<Drill>(null);
  const [showAll, setShowAll] = useState(false);
  const setup = useFirstRunRedirect();

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
  const { data: suppliers } = useQuery({ queryKey: ["suppliers"], queryFn: () => v2.suppliers() });

  const supplierName = useMemo(() => {
    const map = new Map((suppliers?.items ?? []).map((s) => [s.id, (s as { legalName?: string; name?: string }).legalName ?? s.name ?? s.id]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);

  const todos = useMemo(() => buildTodos(data?.topFindings ?? [], data?.deadlines ?? []), [data]);
  const visibleTodos = showAll ? todos : todos.slice(0, 6);
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const maxSpend = Math.max(1, ...(summary?.spendBySupplier ?? []).map((s) => Number(s.value)));
  const isEmptyWorkspace = setup && setup.isNew;

  return (
    <FadeIn className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-page-title">{greeting()}, {firstName}</h1>
          <p className="mt-1.5 text-base text-[var(--muted)]">
            {activeEntity ? activeEntity.legalName : "All companies"} · <DateText value={new Date().toISOString()} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <BtnLink href="/app/documents" variant="secondary" icon={Upload}>Upload invoice</BtnLink>
          <BtnLink href="/app/orders/new" variant="secondary" icon={Plus}>New order</BtnLink>
        </div>
      </header>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : (
        <>
          {/* ---- 1. what needs me today ---- */}
          <section aria-labelledby="todo-title">
            <Card>
              <CardTitle
                description={
                  todos.length
                    ? "Most urgent first — overdue deadlines, then the issues with the most money at stake."
                    : undefined
                }
                action={todos.length ? <span className="text-[14px] text-[var(--muted)] tnum">{todos.length} to do</span> : undefined}
              >
                <span id="todo-title">What needs you today</span>
              </CardTitle>
              {isLoading ? (
                <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
              ) : todos.length ? (
                <>
                  <ul className="divide-y divide-[var(--line)]">
                    {visibleTodos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
                  </ul>
                  <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-4">
                    {todos.length > visibleTodos.length ? (
                      <button type="button" onClick={() => setShowAll(true)} className="text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                        Show all {todos.length}
                      </button>
                    ) : null}
                    <Link href="/app/investigations" className="inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                      Open To review <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </>
              ) : isEmptyWorkspace ? (
                <div className="flex flex-col items-start gap-3 py-2">
                  <p className="text-base text-[var(--ink-2)]">
                    Nothing to review yet — Satya needs your orders, invoices and payments first.
                  </p>
                  <BtnLink href="/app/setup">Continue setup</BtnLink>
                </div>
              ) : (
                <p className="flex items-center gap-2.5 py-2 text-base text-[var(--ink-2)]">
                  <CheckCircle2 size={20} className="text-[var(--confirmed)]" aria-hidden="true" />
                  You’re all caught up. Nothing is overdue and no open issue needs a decision.
                </p>
              )}
            </Card>
          </section>

          {/* ---- 2. the numbers that matter ---- */}
          <section aria-labelledby="numbers-title">
            <SectionHeader id="numbers-title" title="Your payables at a glance" description="Hover the (i) for what each number includes; “See why” shows the breakdown." />
            <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {isLoading || !data ? (
                <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
              ) : (
                <>
                  <StaggerItem className="h-full">
                    <StatCard label={BALANCE_TERMS.evidenceSupportedPayable.label} tip={BALANCE_TERMS.evidenceSupportedPayable.tip}
                      value={<Money value={data.supportedOutstanding ?? null} />}
                      delta="For goods that were delivered and passed quality check." seeWhy="See why" tone="good"
                      onSeeWhy={() => setDrill("supported")} />
                  </StaggerItem>
                  <StaggerItem className="h-full">
                    <StatCard label={BALANCE_TERMS.disputedExposure.label} tip={BALANCE_TERMS.disputedExposure.tip}
                      value={<Money value={data.moneyAtRisk} />}
                      delta={`Possible duplicates or over-billing · ${data.holds.count} on hold`}
                      seeWhy="See why" tone="warn" onSeeWhy={() => setDrill("disputed")} />
                  </StaggerItem>
                  <StaggerItem className="h-full">
                    <StatCard label={BALANCE_TERMS.itcAtRisk.label} tip={BALANCE_TERMS.itcAtRisk.tip}
                      value={<Money value={data.itcAtRisk} />}
                      delta="GST on bills with an open issue, that you could lose." seeWhy="See why" onSeeWhy={() => setDrill("itc")} />
                  </StaggerItem>
                  <StaggerItem className="h-full">
                    <StatCard label="Due this week" tip="Payments that must go out in the next 7 days to stay within agreed or legal terms."
                      value={<Money value={data.paymentsDueWeek ?? null} />}
                      delta="Includes MSME 45-day deadlines." seeWhy="See payments" onSeeWhy={() => setDrill("payments")} />
                  </StaggerItem>
                </>
              )}
            </Stagger>
          </section>

          {/* ---- 3. deadlines + payments ---- */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <section aria-label="Upcoming deadlines" className="lg:col-span-3">
              <Card className="h-full">
                <CardTitle icon={CalendarClock} description={<>Legal payment and tax deadlines in the next 30 days, including <Term of="MSME">MSME</Term> 45-day limits.</>}>
                  Upcoming deadlines
                </CardTitle>
                {isLoading ? (
                  <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : data?.deadlines.length ? (
                  <ul className="divide-y divide-[var(--line)]">
                    {data.deadlines.map((deadline) => {
                      const tone = deadline.daysLeft < 0 ? "var(--sev-critical)" : deadline.daysLeft <= 7 ? "var(--sev-medium)" : "var(--muted)";
                      return (
                        <li key={`${deadline.kind}-${deadline.documentId}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="text-[15px] font-medium text-[var(--ink)]">{deadline.supplier}</p>
                            <p className="mt-0.5 text-[14px] text-[var(--muted)]">
                              {DEADLINE_LABEL[deadline.kind] ?? deadline.kind} · <Money value={deadline.amount} />
                            </p>
                          </div>
                          <p className="shrink-0 text-right text-[14px]">
                            <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: tone }}>
                              <Clock size={14} aria-hidden="true" /> {daysLeftText(deadline.daysLeft)}
                            </span>
                            <span className="block text-[var(--muted)]"><DateText value={deadline.dueDate} /></span>
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[15px] text-[var(--muted)]">No legal deadlines in the next 30 days.</p>
                )}
                <Link href="/app/compliance" className="mt-5 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                  All compliance deadlines <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </Card>
            </section>

            <section aria-label="Payments not yet matched" className="lg:col-span-2">
              <Card className="h-full">
                <CardTitle icon={Wallet} description="Money that left your bank but isn’t linked to a bill yet.">
                  Payments not yet matched
                </CardTitle>
                {summary ? <UnallocatedList summary={summary} /> : <Skeleton className="h-20 w-full" />}
                {summary && summary.unallocatedPayments.length > 0 && (
                  <Link href="/app/payments" className="mt-4 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                    Match them in Payments <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                )}
              </Card>
            </section>
          </div>

          {/* ---- 4. compliance ---- */}
          <section aria-labelledby="compliance-title">
            <SectionHeader
              id="compliance-title"
              title="Tax and compliance"
              description="Where GST credit or MSME rules could cost you money."
              action={
                <Link href="/app/compliance" className="inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                  Open Compliance <ArrowRight size={15} aria-hidden="true" />
                </Link>
              }
            />
            {compliance ? <ComplianceStrip summary={compliance} /> : <Skeleton className="h-28 w-full" />}
          </section>

          {/* ---- 5. activity ---- */}
          <section aria-label="Recent activity">
            <Card>
              <CardTitle icon={Activity} description="What Satya found and what your team decided, newest first.">Recent activity</CardTitle>
              {isLoading ? (
                <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {(data?.activity ?? []).slice(0, 6).map((item) => {
                    const sevTone: Record<string, string> = { critical: "var(--sev-critical)", high: "var(--sev-high)", medium: "var(--sev-medium)", low: "var(--sev-low)", info: "var(--sev-info)" };
                    const tone = sevTone[(item as { severity?: string }).severity ?? "info"];
                    const docRef = (item as { docRef?: string | null }).docRef;
                    const row = (
                      <>
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          {docRef && <span className="mr-2 font-code text-[13px] text-[var(--muted)]">{docRef}</span>}
                          <span className="text-[15px] text-[var(--ink-2)]">{item.text}</span>
                        </span>
                        <span className="shrink-0 text-[14px] text-[var(--muted)]"><DateText value={item.at} /></span>
                      </>
                    );
                    return (
                      <li key={item.id}>
                        {"href" in item && item.href ? (
                          <Link href={item.href} className="flex items-start gap-3 py-3 transition-colors hover:text-[var(--ink)]">{row}</Link>
                        ) : (
                          <div className="flex items-start gap-3 py-3">{row}</div>
                        )}
                      </li>
                    );
                  })}
                  {data && !data.activity?.length && <li className="py-2 text-[15px] text-[var(--muted)]">Nothing recorded yet.</li>}
                </ul>
              )}
              <Link href="/app/audit" className="mt-3 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                Full activity log <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </Card>
          </section>
        </>
      )}

      {/* ---- drill-downs ---- */}
      {drill === "supported" && summary && (
        <KpiDrillDown title={`${BALANCE_TERMS.evidenceSupportedPayable.label}: the breakdown`} onClose={() => setDrill(null)}>
          <p className="mb-3 text-[15px] leading-relaxed text-[var(--muted)]">{BALANCE_TERMS.evidenceSupportedPayable.tip}</p>
          <DrillRow label="Open value across checked orders" value={<Money value={summary.openValue} />} />
          <DrillRow label="Orders with an open check" value={summary.openInvestigations} />
          <DrillRow label="Suppliers you owe money to" value={summary.spendBySupplier.length} />
          <div className="mt-4">
            <p className="mb-1 text-[13px] font-semibold text-[var(--muted)]">Largest balances</p>
            {summary.spendBySupplier.slice(0, 5).map((s) => (
              <HBar key={s.supplierId} label={supplierName(s.supplierId)} value={Number(s.value)} max={maxSpend} display={formatMoney(s.value)} href={`/app/suppliers/${s.supplierId}`} />
            ))}
          </div>
          <Link href="/app/investigations" className="mt-4 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
            Open To review <ArrowUpRight size={15} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "disputed" && summary && (
        <KpiDrillDown title={`${BALANCE_TERMS.disputedExposure.label}: what the issues are`} onClose={() => setDrill(null)}>
          <IssueBreakdown summary={summary} />
          <Link href="/app/investigations" className="mt-5 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
            Open To review <ArrowUpRight size={15} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "itc" && compliance && (
        <KpiDrillDown title={`${BALANCE_TERMS.itcAtRisk.label}: where your credit stands`} onClose={() => setDrill(null)}>
          <DrillRow label={<>Total <Term of="ITC">GST credit</Term> claimed</>} value={<Money value={compliance.itcSummary.total} />} />
          <DrillRow label="Blocked or at risk" value={<Money value={compliance.itcSummary.blockedOrAtRisk} />} note="Unpaid for 180 days, or missing from GSTR-2B" />
          <DrillRow label="Bills nearing the 180-day mark" value={compliance.rule37.count} />
          <DrillRow label="Invoices with an e-invoice number" value={`${compliance.einvoiceCoverage.pct}%`} note={`${compliance.einvoiceCoverage.withIrn} of ${compliance.einvoiceCoverage.invoices} invoices carry an IRN`} />
          <DrillRow label="Credit notes not yet applied" value={compliance.creditNotesUnapplied.count} />
          <Link href="/app/compliance" className="mt-4 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
            Open Compliance <ArrowUpRight size={15} />
          </Link>
        </KpiDrillDown>
      )}
      {drill === "payments" && summary && (
        <KpiDrillDown title="Payments: what still needs matching" onClose={() => setDrill(null)}>
          <UnallocatedList summary={summary} />
          <Link href="/app/payments" className={cn("mt-4 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]")}>
            Open Payments <ArrowUpRight size={15} />
          </Link>
        </KpiDrillDown>
      )}
    </FadeIn>
  );
}
