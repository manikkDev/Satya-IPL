"use client";

// Home (/app) answers one question: "What needs me today?" (UI_SPEC §7).
//   1. Greeting + one status sentence.
//   2. Needs you today — top 5 ranked items, one action each, "Show all".
//   3. Three KPIs — Safe to pay · On hold · Due this week — each with "See why".
//   4. This week (a 7-day strip, not a long list) beside Unmatched money.
//   5. Recent activity as five plain sentences.
// Every fact appears once. Compliance detail lives on /app/compliance.
// A disputed bill is never "pay": it becomes "resolve before paying" or
// "pay only the undisputed ₹X" (dispute data from the payables computation).
// A brand-new workspace is sent to /app/setup once per session.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight, OctagonAlert, TriangleAlert, CircleAlert, CheckCircle2, Plus, Upload, PauseCircle, Wallet, type LucideIcon,
} from "lucide-react";
import { v2, type DashboardSummary } from "@/lib/api/v2";
import type { Finding, Deadline } from "@/lib/api/types";
import { mocksEnabled } from "@/lib/flags";
import { useSession } from "@/components/v2/session";
import { onboarding, setupDismissKey } from "@/lib/api/onboarding";
import {
  Money, StatCard, StatCardSkeleton, ErrorState, Card, FadeIn, BtnLink, SectionHeader, TextLink, RelativeDue,
  StatusChip, ListSkeleton, InfoTip,
} from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiDrillDown, DrillRow, HBar, UnallocatedList, WeekStrip, ActivityList, type ActivityItem } from "@/components/v2/today-insights";
import { fetchPayables, effectiveDue, type PayableRow } from "@/components/pages/compliance/api";
import { formatMoney, formatMoneyCompact, toPaise, fromPaise, isoDateIst } from "@/lib/format";
import { findingTitle, plural, sanitizeEngineText, relativeDue } from "@/lib/humanize";

const MOCK_SUMMARY: DashboardSummary = {
  openValue: "145000.00", casesByStatus: { open: 2, in_review: 1 }, issuesBySeverity: { critical: 1, high: 3, medium: 2, low: 1 },
  findingsByCertainty: { CONFIRMED: 4, PROBABLE: 2, POSSIBLE: 1 }, openInvestigations: 3,
  aging: { "0-30": 2, "31-60": 1, "61-90": 0, "90+": 0 },
  spendBySupplier: [],
  monthlySeries: [],
  unallocatedPayments: [{ documentId: "doc_pay3", amount: "15000.00", allocated: "0" }],
  recentDecisions: [],
};

type Drill = "safe" | "hold" | "week" | null;

/* ---------------- needs you today ---------------- */

type Todo = {
  id: string;
  rank: number;
  tone: "bad" | "warn" | "info";
  title: string;
  /** One short line under the title (rule name or what was found). */
  detail?: string;
  /** Plain explanation behind the (i), for rules. */
  tip?: string;
  amount?: string | null;
  amountLabel?: string;
  hold?: "full" | "partial";
  due?: { daysLeft: number; date: string };
  href: string;
  action: string;
  caseId?: string | null;
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

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Ranked to-do list: overdue legal deadlines first, then disputes, then the
 *  issues with the most at stake. One item per case — a deadline on a case
 *  already covers that case's findings. MSME deadline findings are skipped
 *  (the deadline itself is the item). */
function buildTodos(findings: Finding[], deadlines: Deadline[]): Todo[] {
  const todos: Todo[] = [];
  const coveredCases = new Set<string>();
  for (const d of deadlines) {
    if (d.daysLeft > 14) continue;
    const overdue = d.daysLeft < 0;
    const base = { id: `dl-${d.kind}-${d.documentId}`, due: { daysLeft: d.daysLeft, date: d.dueDate }, caseId: d.caseId ?? null };
    if (d.caseId) coveredCases.add(d.caseId);
    const heldPaise = toPaise(d.disputed?.amount ?? "0");
    if (d.kind === "MSME_45" && heldPaise > BigInt(0)) {
      const payable = d.payable?.amount ?? "0";
      const fullyHeld = toPaise(payable) === BigInt(0);
      const duplicate = (d.disputeCodes ?? []).some((c) => c.startsWith("DUP"));
      todos.push({
        ...base, rank: overdue ? 1 : 3, tone: "bad", hold: fullyHeld ? "full" : "partial",
        title: fullyHeld
          ? `${duplicate ? "Likely duplicate bill" : "Disputed bill"} from ${d.supplier} — resolve before paying`
          : `Pay ${d.supplier} only the undisputed ${formatMoney(payable)}`,
        detail: fullyHeld
          ? `${formatMoney(d.disputed?.amount)} on hold · MSME clock still running`
          : `${formatMoney(d.disputed?.amount)} of ${formatMoney(d.amount?.amount)} is on hold`,
        tip: `${duplicate ? "It looks like a duplicate posting." : "It doesn’t match what was received, accepted or agreed."} The MSME 45-day clock keeps running, so settle the dispute with the supplier quickly.`,
        amount: fullyHeld ? d.disputed?.amount ?? null : payable, amountLabel: fullyHeld ? "On hold" : "Payable",
        href: d.caseId ? `/app/investigations/${d.caseId}` : "/app/investigations", action: "Review issue",
      });
      continue;
    }
    if (d.kind === "MSME_45") {
      todos.push({
        ...base, rank: overdue ? 0 : d.daysLeft <= 7 ? 2 : 4, tone: overdue || d.daysLeft <= 3 ? "bad" : "warn",
        title: `Pay ${d.supplier}`,
        detail: "MSME 45-day limit",
        tip: "Paying a micro or small supplier late costs interest at 3× the RBI rate, and the expense can’t be deducted from income tax this year.",
        amount: d.amount?.amount ?? null, amountLabel: "Due",
        href: "/app/compliance?tab=msme", action: "Plan payment",
      });
    } else if (d.kind === "RULE_37_180") {
      todos.push({
        ...base, rank: overdue ? 0 : 3, tone: overdue ? "bad" : "warn",
        title: `Pay ${d.supplier} or reverse the GST credit`, detail: "180-day GST credit rule",
        tip: "Bills unpaid for 180 days force you to give back the GST credit you claimed, with interest.",
        amount: d.amount?.amount ?? null, href: "/app/compliance?tab=rule37", action: "Review",
      });
    } else if (d.kind === "EINVOICE_30") {
      todos.push({ ...base, rank: 5, tone: "info", title: `Check the e-invoice from ${d.supplier}`, detail: "e-invoice check", amount: d.amount?.amount ?? null, href: "/app/compliance?tab=eway", action: "Check" });
    } else {
      todos.push({ ...base, rank: 6, tone: "info", title: `Delivery due from ${d.supplier}`, amount: d.amount?.amount ?? null, href: `/app/orders/${d.documentId}`, action: "Open order" });
    }
  }

  // one item per case: the most severe finding, then the largest amount
  const byCase = new Map<string, Finding>();
  for (const f of findings) {
    const sev = String(f.severity);
    if (sev === "info" || sev === "low" || f.code === "MSME_43BH_DEADLINE") continue;
    const caseId = (f as Finding & { caseId?: string }).caseId ?? f.id;
    if (coveredCases.has(caseId)) continue;
    const best = byCase.get(caseId);
    const better = !best
      || (SEV_RANK[sev] ?? 9) < (SEV_RANK[String(best.severity)] ?? 9)
      || ((SEV_RANK[sev] ?? 9) === (SEV_RANK[String(best.severity)] ?? 9) && toPaise(exposureOf(f)) > toPaise(exposureOf(best)));
    if (better) byCase.set(caseId, f);
  }
  for (const [caseId, f] of byCase) {
    const sev = String(f.severity);
    todos.push({
      id: `f-${f.id}`, rank: sev === "critical" ? 1 : sev === "high" ? 3 : 5, tone: sev === "critical" ? "bad" : sev === "high" ? "warn" : "info",
      title: findingTitle(f.code), detail: sanitizeEngineText(f.title).split(/;\s|\s—\s/)[0],
      amount: exposureOf(f), amountLabel: "At stake",
      href: caseId.startsWith("case") ? `/app/investigations/${caseId}` : "/app/investigations", action: "Review issue",
    });
  }
  const byAmountDesc = (a: Todo, b: Todo) => {
    const diff = toPaise(b.amount) - toPaise(a.amount);
    return diff > BigInt(0) ? 1 : diff < BigInt(0) ? -1 : 0;
  };
  return todos.sort((a, b) => a.rank - b.rank || (a.due?.daysLeft ?? 99) - (b.due?.daysLeft ?? 99) || byAmountDesc(a, b));
}

function TodoRow({ todo }: { todo: Todo }) {
  const tone = TONE_ICON[todo.tone];
  const Icon = todo.hold ? PauseCircle : tone.icon;
  const color = todo.hold ? "var(--sev-medium)" : tone.color;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon size={20} className="mt-0.5 shrink-0" style={{ color }} aria-label={todo.hold ? "On hold" : tone.word} role="img" />
        <div className="min-w-0">
          <p className="text-base font-medium leading-snug text-[var(--ink)]">{todo.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-[var(--muted)]">
            {todo.detail ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <span className="line-clamp-1">{todo.detail}</span>
                {todo.tip ? <InfoTip label={`About: ${todo.detail}`}>{todo.tip}</InfoTip> : null}
              </span>
            ) : null}
            {todo.due ? <RelativeDue daysLeft={todo.due.daysLeft} date={todo.due.date} layout="inline" showDate={false} /> : null}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 pl-8 sm:justify-end sm:pl-0">
        {todo.amount ? (
          <span className="text-right">
            <span className="block text-[13px] text-[var(--muted)]">{todo.amountLabel ?? "Amount"}</span>
            <span className="tnum block text-[15px] font-semibold text-[var(--ink)]">{formatMoney(todo.amount)}</span>
          </span>
        ) : null}
        <BtnLink href={todo.href} variant="secondary" size="sm" className="w-[136px]">
          {todo.action}
        </BtnLink>
      </div>
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

/* ---------------- drill-down lists ---------------- */

function BillList({ rows, mode }: { rows: PayableRow[]; mode: "hold" | "due" }) {
  if (!rows.length) return <p className="py-2 text-[15px] text-[var(--muted)]">Nothing here right now.</p>;
  return (
    <ul className="divide-y divide-[var(--line)]">
      {rows.map((r) => {
        const held = toPaise(r.disputed.amount) > BigInt(0);
        const caseId = r.caseId ?? r.findings.find((f) => f.caseId)?.caseId ?? null;
        const reason = r.findings.find((f) => f.amount && toPaise(f.amount) > BigInt(0))?.code ?? r.findings[0]?.code;
        const days = Math.round((Date.parse(`${effectiveDue(r)}T00:00:00Z`) - Date.parse(`${isoDateIst()}T00:00:00Z`)) / 86_400_000);
        return (
          <li key={r.documentId} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-[var(--ink)]">{r.supplier}</p>
              <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">
                <span className="font-code">{r.invoice}</span>
                {mode === "hold" && reason ? ` · ${findingTitle(reason)}` : ` · ${relativeDue(days)}`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <Money value={mode === "hold" ? r.disputed : held ? r.payable : r.outstanding} className="text-[15px] font-medium text-[var(--ink)]" />
              {mode === "hold" || held ? (
                caseId ? (
                  <Link href={`/app/investigations/${caseId}`} className="text-[14px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Review issue</Link>
                ) : (
                  <StatusChip tone="warn" icon={PauseCircle}>On hold</StatusChip>
                )
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- page ---------------- */

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
  const { data: payables, isLoading: payablesLoading } = useQuery({
    queryKey: ["payables", "open", activeEntity?.id],
    queryFn: () => fetchPayables({ entityId: activeEntity?.id, status: "open", sort: "due", limit: 200 }),
    retry: 1,
  });

  const todos = useMemo(() => buildTodos(data?.topFindings ?? [], data?.deadlines ?? []), [data]);
  const visibleTodos = showAll ? todos : todos.slice(0, 5);
  const urgent = todos.filter((t) => t.tone === "bad").length;
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const isEmptyWorkspace = setup && setup.isNew;

  const rows = useMemo(() => payables?.items ?? [], [payables]);
  const heldRows = useMemo(() => rows.filter((r) => toPaise(r.disputed.amount) > BigInt(0)).sort((a, b) => (toPaise(b.disputed.amount) > toPaise(a.disputed.amount) ? 1 : -1)), [rows]);
  const today = isoDateIst();
  const weekEnd = useMemo(() => new Date(Date.parse(`${today}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10), [today]);
  const dueRows = useMemo(() => rows.filter((r) => effectiveDue(r) <= weekEnd).sort((a, b) => effectiveDue(a).localeCompare(effectiveDue(b))), [rows, weekEnd]);
  const overdueRows = dueRows.filter((r) => effectiveDue(r) < today);
  const weekRows = dueRows.filter((r) => effectiveDue(r) >= today);
  const sumPaise = (list: PayableRow[], key: "payable" | "outstanding" | "disputed") => fromPaise(list.reduce((s, r) => s + toPaise(r[key].amount), BigInt(0)));

  // KPI values: the payables computation when available (same source as
  // Compliance and the assistant), else the dashboard's own figures.
  const safeToPay = payables ? payables.totals.payable.amount : data?.supportedOutstanding?.amount ?? null;
  const onHold = payables ? payables.totals.disputed.amount : data?.moneyAtRisk?.amount ?? null;
  const dueWeek = payables ? sumPaise(weekRows, "payable") : data?.paymentsDueWeek?.amount ?? null;
  const kpiLoading = isLoading || (payablesLoading && !data);

  const statusLine = (() => {
    if (isLoading) return null;
    const first = urgent
      ? `${plural(urgent, "item")} need${urgent === 1 ? "s" : ""} a decision today`
      : todos.length ? "Nothing is urgent today" : "You’re all caught up";
    const second = safeToPay && toPaise(safeToPay) > BigInt(0) ? `${formatMoneyCompact(safeToPay)} is safe to pay` : null;
    return second ? `${first}; ${second}.` : `${first}.`;
  })();

  const supplierPayables = useMemo(() => {
    const map = new Map<string, { name: string; id: string | null; paise: bigint }>();
    for (const r of rows) {
      const k = r.supplierId ?? r.supplier;
      const cur = map.get(k) ?? { name: r.supplier, id: r.supplierId, paise: BigInt(0) };
      cur.paise += toPaise(r.payable.amount);
      map.set(k, cur);
    }
    return [...map.values()].filter((x) => x.paise > BigInt(0)).sort((a, b) => (b.paise > a.paise ? 1 : -1));
  }, [rows]);
  const maxSupplier = supplierPayables.length ? Number(supplierPayables[0].paise) : 1;

  const activity = (data?.activity ?? []) as ActivityItem[];

  return (
    <FadeIn className="page-stack">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="type-page-title">{greeting()}, {firstName}</h1>
          {statusLine ? (
            <p className="mt-2 text-base text-[var(--ink-2)]">{statusLine}</p>
          ) : (
            <Skeleton className="mt-3 h-5 w-80 max-w-full" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <BtnLink href="/app/documents" variant="secondary" icon={Upload}>Upload invoice</BtnLink>
          <BtnLink href="/app/orders/new" variant="ghost" icon={Plus}>New order</BtnLink>
        </div>
      </header>

      {error ? (
        <ErrorState message={error instanceof Error ? error.message : "Something went wrong."} onRetry={() => refetch()} />
      ) : (
        <>
          {/* ---- 1. needs you today ---- */}
          <Card as="section" aria-labelledby="todo-title">
            <SectionHeader
              id="todo-title"
              title="Needs you today"
              description={todos.length ? "Most urgent first — one action each." : undefined}
              action={todos.length ? <span className="tnum text-[14px] text-[var(--muted)]">{plural(todos.length, "item")}</span> : undefined}
            />
            {isLoading ? (
              <ListSkeleton rows={4} />
            ) : todos.length ? (
              <>
                <ul className="divide-y divide-[var(--line)]">
                  {visibleTodos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[var(--line)] pt-4">
                  {todos.length > 5 ? (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      aria-expanded={showAll}
                      className="text-[15px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]"
                    >
                      {showAll ? "Show top 5" : `Show all ${todos.length}`}
                    </button>
                  ) : null}
                  <TextLink href="/app/investigations">Open To review</TextLink>
                </div>
              </>
            ) : isEmptyWorkspace ? (
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-base text-[var(--ink-2)]">Nothing to review yet — Satya needs your orders, invoices and payments first.</p>
                <BtnLink href="/app/setup">Continue setup</BtnLink>
              </div>
            ) : (
              <p className="flex items-center gap-2.5 py-2 text-base text-[var(--ink-2)]">
                <CheckCircle2 size={20} className="text-[var(--confirmed)]" aria-hidden="true" />
                You’re all caught up. Nothing is overdue and no open issue needs a decision.
              </p>
            )}
          </Card>

          {/* ---- 2. three numbers ---- */}
          <section aria-labelledby="numbers-title">
            <h2 id="numbers-title" className="sr-only">Your payables at a glance</h2>
            <div className="rise-stagger grid grid-cols-1 gap-4 md:grid-cols-3">
              {kpiLoading ? (
                <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
              ) : (
                <>
                  <StatCard
                    label="Safe to pay"
                    tip="Unpaid bills with nothing disputed against them — what you can pay without waiting on a supplier."
                    value={<Money value={safeToPay} />}
                    delta={payables ? `Across ${plural(supplierPayables.length, "supplier")}` : "Delivered and accepted goods, net of payments"}
                    seeWhy="See why" onSeeWhy={() => setDrill("safe")} tone="good"
                  />
                  <StatCard
                    label="On hold"
                    tip="Money tied to a dispute — a likely duplicate, billing above what arrived, or wrong tax. Resolve these before paying."
                    value={<Money value={onHold} />}
                    delta={payables ? `${plural(heldRows.length, "bill")} waiting on a dispute` : "Possible duplicates or over-billing"}
                    seeWhy="See why" onSeeWhy={() => setDrill("hold")} tone="warn"
                  />
                  <StatCard
                    label="Due this week"
                    tip="Undisputed amounts that fall due in the next 7 days, by agreed terms or the MSME 45-day limit — whichever is earlier."
                    value={<Money value={dueWeek} />}
                    delta={payables ? (overdueRows.length ? `${plural(weekRows.length, "bill")} · plus ${plural(overdueRows.length, "bill")} already overdue` : plural(weekRows.length, "bill")) : "Includes MSME 45-day deadlines"}
                    seeWhy="See why" onSeeWhy={() => setDrill("week")}
                  />
                </>
              )}
            </div>
          </section>

          {/* ---- 3. this week + unmatched money ---- */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <Card as="section" aria-labelledby="week-title" className="lg:col-span-3">
              <SectionHeader id="week-title" title="This week" description="What falls due each day — tap a day to see its bills." />
              {payablesLoading ? (
                <Skeleton className="h-[220px] w-full" />
              ) : payables ? (
                <WeekStrip rows={rows} onShowOverdue={() => setDrill("week")} />
              ) : (
                <p className="text-[15px] text-[var(--muted)]">The payment calendar couldn’t be loaded right now.</p>
              )}
              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <TextLink href="/app/compliance">Legal deadlines in Compliance</TextLink>
              </div>
            </Card>

            <Card as="section" aria-labelledby="unmatched-title" className="lg:col-span-2">
              <SectionHeader id="unmatched-title" title="Unmatched money" description="Payments that left your bank without a bill linked." />
              {summary ? <UnallocatedList summary={summary} /> : <Skeleton className="h-28 w-full" />}
              {summary && summary.unallocatedPayments.length > 0 ? (
                <div className="mt-4 border-t border-[var(--line)] pt-4">
                  <TextLink href="/app/payments">Match them in Payments</TextLink>
                </div>
              ) : null}
            </Card>
          </div>

          {/* ---- 4. recent activity ---- */}
          <Card as="section" aria-labelledby="activity-title">
            <SectionHeader id="activity-title" title="Recent activity" link={{ href: "/app/audit", label: "Activity log" }} />
            {isLoading ? <ListSkeleton rows={3} /> : <ActivityList items={activity} />}
          </Card>
        </>
      )}

      {/* ---- drill-downs ---- */}
      {drill === "safe" ? (
        <KpiDrillDown
          title="Safe to pay: where it sits"
          description="Unpaid bills minus anything under dispute. Largest supplier balances first."
          onClose={() => setDrill(null)}
        >
          {payables ? (
            <>
              <DrillRow label="Unpaid on open bills" value={<Money value={payables.totals.outstanding} />} />
              <DrillRow label="Minus amounts on hold" value={<Money value={payables.totals.disputed} />} note="Disputes to resolve first" />
              <DrillRow label="Safe to pay" value={<Money value={payables.totals.payable} className="font-semibold" />} />
              <p className="mb-1 mt-5 text-[13px] font-semibold text-[var(--muted)]">By supplier</p>
              {supplierPayables.slice(0, 6).map((s) => (
                <HBar key={s.name} label={s.name} value={Number(s.paise)} max={maxSupplier} display={formatMoney(fromPaise(s.paise))} href={s.id ? `/app/suppliers/${s.id}` : undefined} />
              ))}
            </>
          ) : (
            <p className="text-[15px] text-[var(--muted)]">The breakdown isn’t available right now.</p>
          )}
        </KpiDrillDown>
      ) : null}
      {drill === "hold" ? (
        <KpiDrillDown
          title="On hold: bills waiting on a dispute"
          description="Don’t pay these amounts until the issue is settled with the supplier."
          onClose={() => setDrill(null)}
        >
          {payables ? <BillList rows={heldRows} mode="hold" /> : <p className="text-[15px] text-[var(--muted)]">The list isn’t available right now.</p>}
          <div className="mt-4 border-t border-[var(--line)] pt-4"><TextLink href="/app/investigations">Open To review</TextLink></div>
        </KpiDrillDown>
      ) : null}
      {drill === "week" ? (
        <KpiDrillDown
          title="Due this week"
          description="By agreed terms or the MSME 45-day limit, whichever is earlier. Amounts on hold are excluded."
          onClose={() => setDrill(null)}
        >
          {payables ? (
            <>
              {overdueRows.length ? (
                <>
                  <p className="mb-1 text-[13px] font-semibold text-[var(--sev-critical)]">Already overdue · {formatMoney(sumPaise(overdueRows, "payable"))}</p>
                  <BillList rows={overdueRows} mode="due" />
                  <p className="mb-1 mt-5 text-[13px] font-semibold text-[var(--muted)]">Next 7 days · {formatMoney(sumPaise(weekRows, "payable"))}</p>
                </>
              ) : null}
              <BillList rows={weekRows} mode="due" />
            </>
          ) : (
            <p className="text-[15px] text-[var(--muted)]">The list isn’t available right now.</p>
          )}
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <Link href="/app/payments" className="inline-flex items-center gap-1 text-[15px] font-medium text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
              <Wallet size={15} aria-hidden="true" /> Record payments <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </KpiDrillDown>
      ) : null}
    </FadeIn>
  );
}
