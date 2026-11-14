"use client";

// Empty state: greeting, today's briefing as 3–4 calm cards, suggested
// prompts grouped by job as large rows, and recent conversations.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, CalendarClock, FileWarning, Landmark, MessagesSquare, Receipt, RefreshCw, Search, Truck, Users, Wallet } from "lucide-react";
import type { Briefing, BriefingSection, CopilotConversation } from "@/lib/api/copilot";
import { getBriefing } from "@/lib/api/copilot";
import { formatCell, inr, relativeTime, shortDate } from "./format";
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

function BriefingCard({ section, onAsk, disabled, index }: { section: BriefingSection; onAsk: (q: string) => void; disabled?: boolean; index: number }) {
  const Icon = SECTION_ICON[section.id] ?? FileWarning;
  const top = section.items[0];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAsk(section.ask)}
      style={{ animationDelay: `${index * 70}ms` }}
      className="sx-rise group flex flex-col rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)] disabled:opacity-60"
    >
      <span className="flex items-center gap-2">
        <span className={cn("grid h-7 w-7 place-items-center rounded-[8px]", TONE[section.tone])}><Icon size={15} aria-hidden="true" /></span>
        <span className="text-[14px] font-medium text-[var(--ink-2)]">{section.title}</span>
      </span>
      <span className="tnum mt-3 text-[26px] font-semibold leading-none tracking-tight text-[var(--ink)]">{formatCell(section.metric.value, section.metric.format)}</span>
      <span className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-[var(--muted)]">
        {section.metric.caption || (top ? `${top.label}${top.amount ? ` · ${inr(top.amount)}` : ""}` : "Nothing needs you here")}
      </span>
      <span className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-medium text-[var(--accent-strong)]">
        Ask about this <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  );
}

export function StartScreen({ entityId, onAsk, disabled, name, recent = [], onOpenConversation, greetingText }: {
  entityId?: string;
  onAsk: (q: string) => void;
  disabled?: boolean;
  name?: string | null;
  recent?: CopilotConversation[];
  onOpenConversation?: (c: CopilotConversation) => void;
  greetingText: string;
}) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Briefing>({
    queryKey: ["copilot-briefing", entityId ?? "all"],
    queryFn: () => getBriefing(entityId),
    staleTime: 120_000,
    retry: 1,
  });
  const [group, setGroup] = useState<(typeof QUESTION_GROUPS)[number]["id"]>("payables");
  const active = QUESTION_GROUPS.find((g) => g.id === group) ?? QUESTION_GROUPS[0];
  // calm: at most 4 cards, the ones that need attention first
  const cards = [...(data?.sections ?? [])].sort((a, b) => ({ critical: 0, warn: 1, ok: 2 }[a.tone] - { critical: 0, warn: 1, ok: 2 }[b.tone])).slice(0, 4);
  void name;

  return (
    <div className="space-y-10 pb-4 pt-2 sm:pt-6">
      <header className="sx-fade">
        <h2 className="text-[28px] font-semibold leading-tight tracking-tight text-[var(--ink)] sm:text-[32px]">{greetingText}</h2>
        <p className="mt-2 max-w-[60ch] text-[16px] leading-relaxed text-[var(--ink-2)]">
          {isLoading ? "Looking at today’s position…" : data?.headline?.value
            ? <>You need <strong className="tnum font-semibold text-[var(--ink)]">{inr(data.headline.value)}</strong> to clear what’s overdue and due this week{data.cash && (Number(data.cash.disputed) > 0) ? <> — <span className="tnum">{inr(data.cash.disputed)}</span> of it is disputed and can be held back</> : null}.</>
            : data?.headline?.text ? `${data.headline.text}.` : "Ask anything about your payables, suppliers, invoices or GST and MSME deadlines."}
        </p>
      </header>

      <section aria-labelledby="sx-brief">
        <div className="mb-3 flex items-center gap-2">
          <h3 id="sx-brief" className="text-[15px] font-semibold text-[var(--ink)]">Today{data?.asOf ? <span className="font-normal text-[var(--muted)]"> · {shortDate(data.asOf)}</span> : null}</h3>
          <button type="button" onClick={() => refetch()} className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" aria-label="Refresh briefing">
            <RefreshCw size={12} className={cn(isFetching && "sx-spin")} aria-hidden="true" /> Refresh
          </button>
        </div>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-5">
                <div className="flex items-center gap-2"><div className="h-7 w-7 animate-pulse rounded-[8px] bg-[var(--surface-2)]" /><div className="h-4 w-24 animate-pulse rounded bg-[var(--surface-2)]" /></div>
                <div className="mt-4 h-7 w-36 animate-pulse rounded bg-[var(--surface-2)]" />
                <div className="mt-2 h-4 w-48 animate-pulse rounded bg-[var(--surface-2)]" />
                <div className="mt-5 h-4 w-28 animate-pulse rounded bg-[var(--surface-2)]" />
              </div>
            ))}
          </div>
        ) : isError || !cards.length ? (
          <p className="rounded-[16px] border border-dashed border-[var(--line-strong)] px-5 py-4 text-[14.5px] text-[var(--muted)]">
            {isError ? "Today’s briefing couldn’t load — you can still ask anything below." : "Nothing needs your attention right now."}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((s, i) => <BriefingCard key={s.id} section={s} onAsk={onAsk} disabled={disabled} index={i} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="sx-suggest">
        <h3 id="sx-suggest" className="mb-3 text-[15px] font-semibold text-[var(--ink)]">Try asking</h3>
        <div role="tablist" aria-label="Question topics" className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1 sx-scroll">
          {QUESTION_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={group === g.id}
              onClick={() => setGroup(g.id)}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors", group === g.id ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}
            >
              <g.icon size={14} aria-hidden="true" /> {g.title}
            </button>
          ))}
        </div>
        <ul role="tabpanel" aria-label={active.title} className="divide-y divide-[var(--line)] overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)]">
          {active.questions.map((q, i) => (
            <li key={q} className="sx-fade" style={{ animationDelay: `${i * 40}ms` }}>
              <button type="button" disabled={disabled} onClick={() => onAsk(q)} className="group flex min-h-[56px] w-full items-center gap-3 px-5 py-3 text-left text-[15.5px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]/70 hover:text-[var(--ink)] disabled:opacity-50">
                <span className="flex-1">{q}</span>
                <ArrowRight size={16} className="shrink-0 text-[var(--muted)] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {recent.length > 0 && onOpenConversation && (
        <section aria-labelledby="sx-recent">
          <h3 id="sx-recent" className="mb-3 text-[15px] font-semibold text-[var(--ink)]">Pick up where you left off</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.slice(0, 4).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenConversation(c)} className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50">
                  <MessagesSquare size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-[var(--ink)]">{c.title || "Conversation"}</span>
                    <span className="block text-[12.5px] text-[var(--muted)]">{relativeTime(c.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
