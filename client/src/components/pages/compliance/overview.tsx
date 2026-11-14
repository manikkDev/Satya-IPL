"use client";

// The six compliance checks as an overview of cards (UI_SPEC §7): each card
// shows a status chip (All clear / Needs attention / Action needed), how many
// items, the money at stake and the next deadline. Cards act as tabs — the
// selected one drives the detail panel below (and ?tab= in the URL).

import { useRef } from "react";
import { Clock3, Landmark, RotateCcw, Scale, Truck, FileSearch, type LucideIcon } from "lucide-react";
import { StatusChip, type StatusTone } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoneyCompact, formatDate, toPaise, fromPaise, daysFromTodayIst } from "@/lib/format";
import { plural, relativeDue } from "@/lib/humanize";
import { cn } from "@/lib/utils";
import { nextGstr3bDue, nextTdsDeposit, type SectionKey } from "./shared";

export type CheckMeta = { id: SectionKey; name: string; question: string; icon: LucideIcon };

export const CHECKS: CheckMeta[] = [
  { id: "msme", name: "MSME 45-day", question: "Are micro and small suppliers paid within 45 days?", icon: Clock3 },
  { id: "gstr2b", name: "GSTR-2B match", question: "Did suppliers report your bills, so you can claim the GST credit?", icon: FileSearch },
  { id: "rule37", name: "180-day GST credit", question: "Is any bill unpaid long enough that the GST credit must be reversed?", icon: RotateCcw },
  { id: "tds", name: "TDS 194Q / 194C", question: "Which payments need tax deducted at source?", icon: Scale },
  { id: "eway", name: "e-invoice & e-way bill", question: "Do bills carry the e-invoice number and e-way bill the law needs?", icon: Truck },
  { id: "lut", name: "LUT for exports", question: "Is every export without IGST covered by a Letter of Undertaking?", icon: Landmark },
];

/** Accepts `?tab=` ids, including older/alias names used in links. */
export function normaliseTab(raw: string | null | undefined): SectionKey | null {
  const v = String(raw ?? "").toLowerCase();
  const alias: Record<string, SectionKey> = {
    msme: "msme", msme45: "msme", msme_45: "msme", "43bh": "msme",
    gstr2b: "gstr2b", "2b": "gstr2b", itc: "gstr2b", gst: "gstr2b",
    rule37: "rule37", rule_37: "rule37", "180": "rule37", "180-day": "rule37",
    tds: "tds", "194q": "tds", "194c": "tds",
    eway: "eway", einvoice: "eway", "e-invoice": "eway", irn: "eway", ewb: "eway",
    lut: "lut", exports: "lut",
  };
  return alias[v] ?? null;
}

export type CheckState = "clear" | "attention" | "action";

export type CheckSummary = {
  state: CheckState;
  count: number;
  countLabel: string;
  atStake: string | null;
  atStakeLabel: string;
  next: string | null;
};

const STATE_CHIP: Record<CheckState, { tone: StatusTone; label: string }> = {
  clear: { tone: "ok", label: "All clear" },
  attention: { tone: "warn", label: "Needs attention" },
  action: { tone: "critical", label: "Action needed" },
};

const sum = (values: (string | { amount?: string } | null | undefined)[]) =>
  fromPaise(values.reduce<bigint>((s, v) => s + toPaise(typeof v === "string" ? v : v?.amount ?? null), BigInt(0)));

const deadlineText = (label: string, date: string) => {
  const days = daysFromTodayIst(date);
  return `${label} ${formatDate(date)}${days !== null && days <= 14 ? ` (${relativeDue(days)})` : ""}`;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Pure summary of a section response → what its card shows. */
export function summarise(id: SectionKey, data: any): CheckSummary {
  switch (id) {
    case "msme": {
      const items = (data.items ?? []) as any[];
      const s = data.summary ?? {};
      const overdue = items.filter((r) => r.status === "overdue" && !r.onHold).length;
      const soon = items.filter((r) => r.status === "due_soon" && !r.onHold).length;
      const held = items.filter((r) => r.onHold).length;
      const upcoming = items.filter((r) => r.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft)[0];
      return {
        state: overdue ? "action" : soon || held ? "attention" : "clear",
        count: items.length,
        countLabel: items.length ? `${plural(items.length, "unpaid bill")}${overdue ? ` · ${overdue} overdue` : ""}` : "No unpaid MSME bills",
        atStake: items.length ? s.outstanding?.amount ?? sum(items.map((r) => r.outstanding)) : null,
        atStakeLabel: "unpaid",
        next: upcoming ? deadlineText("Next deadline", upcoming.dueDate) : overdue ? "Every open bill is past its deadline" : null,
      };
    }
    case "gstr2b": {
      const missing = (data.missingIn2B ?? []).length;
      const books = (data.missingInBooks ?? []).length;
      const diff = (data.mismatched ?? []).length;
      const total = missing + books + diff;
      return {
        state: data.estimated ? (missing ? "attention" : "clear") : books ? "action" : missing || diff ? "attention" : "clear",
        count: total,
        countLabel: data.estimated
          ? missing ? `${plural(missing, "bill")} may be missing` : "No suspected gaps"
          : total ? `${plural(total, "bill")} don’t match` : `Every bill matches (${data.period})`,
        atStake: total ? data.itcAtRisk?.amount ?? null : null,
        atStakeLabel: "GST credit at risk",
        next: data.estimated ? "No GSTR-2B imported yet" : deadlineText("GSTR-3B due", nextGstr3bDue()),
      };
    }
    case "rule37": {
      const items = (data.items ?? []) as any[];
      const s = data.summary ?? {};
      const breached = items.filter((r) => r.state === "breached").length;
      const approaching = items.filter((r) => r.state === "approaching").length;
      const open = breached + approaching;
      const nextRow = items.filter((r) => r.state === "approaching" && r.deadline).sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))[0];
      return {
        state: breached ? "action" : approaching ? "attention" : "clear",
        count: open,
        countLabel: open ? `${plural(open, "bill")} near or past day 180` : "No bill is near day 180",
        atStake: open ? s.itcAtRisk?.amount ?? null : null,
        atStakeLabel: "GST credit at risk",
        next: nextRow ? deadlineText("Day 180 on", nextRow.deadline) : breached ? "Reverse the credit in your next GSTR-3B" : null,
      };
    }
    case "tds": {
      const items = (data.items ?? []) as any[];
      const checks = items.filter((r) => r.status === "check");
      const est = sum(checks.map((r) => r.estimate?.amount ?? r.tdsEstimate ?? null));
      return {
        state: checks.length ? "attention" : "clear",
        count: checks.length,
        countLabel: checks.length ? `${plural(checks.length, "payment")} need${checks.length === 1 ? "s" : ""} a decision` : `${plural(data.summary?.paymentsScanned ?? 0, "payment")} checked`,
        atStake: checks.length && toPaise(est) > BigInt(0) ? est : null,
        atStakeLabel: "estimated TDS",
        next: checks.length ? deadlineText("Deposit by", nextTdsDeposit()) : null,
      };
    }
    case "eway": {
      const irn = (data.einvoice?.checks ?? []) as any[];
      const ewb = (data.eway?.checks ?? []) as any[];
      const total = irn.length + ewb.length;
      return {
        state: total ? "attention" : "clear",
        count: total,
        countLabel: total ? `${plural(total, "bill")} missing a number` : "Nothing missing",
        atStake: total ? sum([...irn, ...ewb].map((r) => r.amount)) : null,
        atStakeLabel: "in bill value",
        next: `${data.einvoice?.pct ?? 0}% of bills carry an IRN`,
      };
    }
    case "lut": {
      const entities = (data.entities ?? []) as any[];
      const exportsRows = (data.exportInvoices ?? []) as any[];
      const uncovered = exportsRows.filter((r) => !r.covered);
      const expiring = entities.some((e) => e.status === "expiring");
      const missingWithExports = exportsRows.length > 0 && entities.some((e) => e.status === "none");
      const renew = entities.filter((e) => e.validTo).sort((a, b) => String(a.validTo).localeCompare(String(b.validTo)))[0];
      return {
        state: uncovered.length ? "action" : expiring || missingWithExports ? "attention" : "clear",
        count: uncovered.length,
        countLabel: uncovered.length
          ? `${plural(uncovered.length, "export")} without cover`
          : `${data.summary?.covered ?? 0} of ${plural(entities.length, "company", "companies")} covered`,
        atStake: uncovered.length ? sum(uncovered.map((r) => r.amount)) : null,
        atStakeLabel: "billed without IGST",
        next: renew ? deadlineText("Renew by", renew.validTo) : null,
      };
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function CheckCards({
  selected,
  onSelect,
  summaries,
}: {
  selected: SectionKey;
  onSelect: (id: SectionKey) => void;
  summaries: Partial<Record<SectionKey, { summary?: CheckSummary; loading: boolean; error: boolean }>>;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? CHECKS.length - 1 : (i + delta + CHECKS.length) % CHECKS.length;
    refs.current[next]?.focus();
    onSelect(CHECKS[next].id);
  };
  return (
    <div role="tablist" aria-label="Compliance checks" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
      {CHECKS.map((check, i) => {
        const entry = summaries[check.id];
        const s = entry?.summary;
        const active = check.id === selected;
        const chip = s ? STATE_CHIP[s.state] : null;
        const Icon = check.icon;
        return (
          <button
            key={check.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`check-tab-${check.id}`}
            aria-selected={active}
            aria-controls="check-panel"
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(check.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "group flex min-w-0 flex-col rounded-[var(--radius-md)] border bg-[var(--surface)] p-4 text-left shadow-[var(--shadow-1)] transition-[border-color,box-shadow,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 sm:p-5",
              active
                ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
                : "border-[var(--line)] hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]",
            )}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <Icon size={17} className={cn("hidden shrink-0 sm:block", active ? "text-[var(--accent)]" : "text-[var(--muted)]")} aria-hidden="true" />
                <span className="text-[15px] font-semibold leading-snug text-[var(--ink)]">{check.name}</span>
              </span>
            </span>
            <span className="mt-2.5 min-h-[26px]">
              {entry?.loading ? (
                <Skeleton className="h-6 w-28 rounded-full" />
              ) : entry?.error ? (
                <StatusChip tone="neutral">Couldn’t load</StatusChip>
              ) : chip ? (
                <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
              ) : null}
            </span>
            {entry?.loading ? (
              <span className="mt-3 block space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
              </span>
            ) : s ? (
              <span className="mt-3 block space-y-1">
                <span className="block text-[14px] leading-snug text-[var(--ink-2)] sm:text-[15px]">{s.countLabel}</span>
                {s.atStake ? (
                  <span className="block text-[14px] leading-snug text-[var(--muted)]">
                    <span className="tnum font-semibold text-[var(--ink)]">{formatMoneyCompact(s.atStake)}</span> {s.atStakeLabel}
                  </span>
                ) : null}
                {s.next ? <span className="hidden text-[14px] leading-snug text-[var(--muted)] sm:block">{s.next}</span> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
