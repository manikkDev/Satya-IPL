"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, CalendarClock, FileWarning, Landmark, RefreshCw, Receipt, Truck, Users, Search, Wallet } from "lucide-react";
import type { Briefing, BriefingSection } from "@/lib/api/copilot";
import { getBriefing } from "@/lib/api/copilot";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCell, inr, shortDate } from "./format";
import { cn } from "@/lib/utils";

export const QUESTION_GROUPS = [
  {
    id: "payables", title: "Payables", icon: Wallet,
    questions: ["What is due this week?", "We have ₹3 lakh this week — what should we pay first?", "Show me the ageing of our payables", "Which payments are unallocated?"],
  },
  {
    id: "suppliers", title: "Suppliers", icon: Users,
    questions: ["Which suppliers do we owe the most?", "How much do we owe Rathod Engineering and why?", "Draft a dispute email to the supplier we owe the most", "Show payments made to Deccan Valve Industries"],
  },
  {
    id: "gst", title: "GST & compliance", icon: Landmark,
    questions: ["Which MSME invoices are past the 45-day limit?", "What is our 43B(h) exposure at year end?", "What is our ITC at risk?", "Which invoices are missing from GSTR-2B?"],
  },
  {
    id: "investigations", title: "Investigations", icon: Search,
    questions: ["What are the critical issues I should review first?", "Any duplicate invoices?", "Put the case with the biggest issue on hold", "Compare purchases this month vs last month"],
  },
] as const;

const SECTION_ICON: Record<string, typeof Wallet> = { overdue: AlarmClock, due_week: CalendarClock, msme: Truck, issues: FileWarning, gst: Receipt };
const TONE: Record<BriefingSection["tone"], string> = {
  critical: "text-[var(--sev-critical)] bg-[var(--sev-critical-soft)]",
  warn: "text-[var(--possible)] bg-[var(--possible-soft)]",
  ok: "text-[var(--confirmed)] bg-[var(--confirmed-soft)]",
};

export function StartScreen({ entityId, onAsk, disabled }: { entityId?: string; onAsk: (q: string) => void; disabled?: boolean }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Briefing>({
    queryKey: ["copilot-briefing", entityId ?? "all"],
    queryFn: () => getBriefing(entityId),
    staleTime: 120_000,
    retry: 1,
  });

  return (
    <div className="space-y-6">
      <section aria-labelledby="briefing-title" className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
        <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] bg-gradient-to-br from-[var(--accent-soft)]/70 to-transparent px-5 py-4">
          <div className="min-w-0 flex-1">
            <p id="briefing-title" className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-strong)]">
              Today&apos;s briefing{data?.asOf ? ` · ${shortDate(data.asOf)}` : ""}
            </p>
            {isLoading ? (
              <Skeleton className="mt-2 h-7 w-72" />
            ) : data?.headline ? (
              <p className="mt-1 text-[22px] font-semibold leading-tight tracking-tight text-[var(--ink)]">
                {data.headline.value ? <span className="tnum">{inr(data.headline.value)}</span> : null}{" "}
                <span className="text-[15px] font-normal text-[var(--ink-2)]">{data.headline.text.toLowerCase()}</span>
              </p>
            ) : (
              <p className="mt-1 text-[15px] text-[var(--ink-2)]">{isError ? "The briefing couldn't load — you can still ask anything below." : "Ask about your payables, suppliers and compliance."}</p>
            )}
            {data?.cash && (
              <p className="mt-1 text-[13px] text-[var(--muted)]">
                {inr(data.cash.overdue)} overdue · {inr(data.cash.dueThisWeek)} due within 7 days · {inr(data.cash.disputed)} disputed (hold back)
              </p>
            )}
          </div>
          <button type="button" onClick={() => refetch()} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" aria-label="Refresh briefing">
            <RefreshCw size={12} className={cn(isFetching && "animate-spin")} aria-hidden="true" /> Refresh
          </button>
        </div>

        <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2 xl:grid-cols-3">
          {isLoading
            ? Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="space-y-2 bg-[var(--surface)] p-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-6 w-32" /><Skeleton className="h-4 w-full" /></div>
            ))
            : (data?.sections ?? []).map((s) => {
              const Icon = SECTION_ICON[s.id] ?? FileWarning;
              return (
                <div key={s.id} className="flex flex-col bg-[var(--surface)] p-4">
                  <div className="flex items-center gap-2">
                    <span className={cn("grid h-6 w-6 place-items-center rounded-md", TONE[s.tone])}><Icon size={13} aria-hidden="true" /></span>
                    <h3 className="text-[13px] font-semibold text-[var(--ink)]">{s.title}</h3>
                  </div>
                  <p className="tnum mt-2 text-xl font-semibold text-[var(--ink)]">{formatCell(s.metric.value, s.metric.format)}</p>
                  {s.metric.caption ? <p className="text-xs text-[var(--muted)]">{s.metric.caption}</p> : null}
                  <ul className="mt-2 flex-1 space-y-1">
                    {s.items.slice(0, 2).map((it, i) => (
                      <li key={i} className="text-[13px] leading-snug">
                        {it.href ? <Link href={it.href} className="font-medium text-[var(--ink-2)] hover:text-[var(--accent-strong)] hover:underline">{it.label}</Link> : <span className="font-medium text-[var(--ink-2)]">{it.label}</span>}
                        {it.amount ? <span className="tnum text-[var(--ink-2)]"> · {inr(it.amount)}</span> : null}
                        {it.detail ? <span className="block truncate text-xs text-[var(--muted)]">{it.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                  <button type="button" disabled={disabled} onClick={() => onAsk(s.ask)} className="mt-3 inline-flex items-center gap-1 self-start text-[13px] font-medium text-[var(--accent-strong)] hover:underline disabled:opacity-50">
                    {s.ask} <ArrowRight size={13} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
        </div>
      </section>

      <section aria-labelledby="suggested-title">
        <h2 id="suggested-title" className="mb-3 text-sm font-semibold text-[var(--ink)]">Ask about…</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {QUESTION_GROUPS.map((g) => (
            <div key={g.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3">
              <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <g.icon size={13} aria-hidden="true" /> {g.title}
              </p>
              <ul className="space-y-0.5">
                {g.questions.map((q) => (
                  <li key={q}>
                    <button type="button" disabled={disabled} onClick={() => onAsk(q)} className="group flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[14px] leading-snug text-[var(--ink-2)] hover:bg-[var(--accent-soft)]/60 hover:text-[var(--ink)] disabled:opacity-50">
                      <ArrowRight size={13} className="mt-1 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)]" aria-hidden="true" />
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Every figure comes from your records and is checked before you see it. I can draft payment runs, supplier emails and decisions — nothing is sent, paid or changed until you press Confirm.
        </p>
      </section>
    </div>
  );
}
