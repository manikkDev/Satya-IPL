"use client";

// Building blocks for Home (/app), per docs/design/UI_SPEC.md §7:
//   KpiDrillDown   — "See why" dialog behind a KPI (focus-trapped, Esc closes)
//   DrillRow/HBar  — label/value rows and a proportional bar for drill-downs
//   WeekStrip      — "This week": a 7-day strip of what falls due, not a list
//   UnallocatedList— payments that left the bank without a bill
//   ActivityList   — recent activity as five plain sentences
// Money is exact (integer paise); dates are IST business dates.

import Link from "next/link";
import { useMemo, useState } from "react";
import { PauseCircle } from "lucide-react";
import { Money, StatusChip } from "@/components/ui/v2";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { DashboardSummary } from "@/lib/api/v2";
import { formatMoney, formatMoneyCompact, fromPaise, toPaise, isoDateIst, formatDate } from "@/lib/format";
import { plural, sanitizeEngineText, timeAgo } from "@/lib/humanize";
import type { PayableRow } from "@/components/pages/compliance/api";
import { effectiveDue } from "@/components/pages/compliance/api";
import { cn } from "@/lib/utils";

/** "See why" drill-down: a calm dialog with the numbers behind a number. */
export function KpiDrillDown({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        {...(description ? {} : { "aria-describedby": undefined })}
        className="max-h-[85vh] gap-0 overflow-y-auto rounded-[var(--radius-lg)] border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--ink)] shadow-[var(--shadow-3)] sm:max-w-xl"
      >
        <DialogTitle className="type-section-title pr-8">{title}</DialogTitle>
        {description ? <DialogDescription className="mt-1.5 text-[15px] leading-relaxed text-[var(--muted)]">{description}</DialogDescription> : null}
        <div className="mt-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function DrillRow({ label, value, note }: { label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-[15px] text-[var(--ink-2)]">{label}</p>
        {note ? <p className="mt-0.5 text-[13px] text-[var(--muted)]">{note}</p> : null}
      </div>
      <div className="tnum shrink-0 text-right text-[15px] font-medium text-[var(--ink)]">{value}</div>
    </div>
  );
}

/** Horizontal bar — label left, value right, bar underneath. */
export function HBar({ label, value, max, display, href }: { label: string; value: number; max: number; display: string; href?: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3 text-[15px]">
        <span className="min-w-0 truncate text-[var(--ink-2)]">{label}</span>
        <span className="tnum shrink-0 font-medium text-[var(--ink)]">{display}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="bar-anim h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-[6px] py-2 transition-opacity hover:opacity-80">{inner}</Link>
  ) : (
    <div className="py-2">{inner}</div>
  );
}

/* ---------------- This week ---------------- */

type Day = { iso: string; label: string; dayNum: string; rows: PayableRow[]; payable: bigint; held: number };

const addDaysIso = (iso: string, n: number) => {
  const t = Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/** Builds overdue + 7 day buckets from open payables (deadline = the earlier
 *  of the terms due date and the MSME legal date). */
export function weekBuckets(rows: PayableRow[], today = isoDateIst()) {
  const days: Day[] = Array.from({ length: 7 }, (_, i) => {
    const iso = addDaysIso(today, i);
    const d = new Date(`${iso}T00:00:00+05:30`);
    return {
      iso,
      label: i === 0 ? "Today" : d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }),
      dayNum: d.toLocaleDateString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }),
      rows: [],
      payable: BigInt(0),
      held: 0,
    };
  });
  const overdue: PayableRow[] = [];
  for (const row of rows) {
    const due = effectiveDue(row);
    if (!due) continue;
    if (due < today) {
      overdue.push(row);
      continue;
    }
    const day = days.find((d) => d.iso === due);
    if (!day) continue;
    day.rows.push(row);
    day.payable += toPaise(row.payable.amount);
    if (toPaise(row.disputed.amount) > BigInt(0)) day.held += 1;
  }
  const overduePayable = overdue.reduce((s, r) => s + toPaise(r.payable.amount), BigInt(0));
  const overdueHeld = overdue.filter((r) => toPaise(r.disputed.amount) > BigInt(0)).length;
  return { days, overdue, overduePayable: fromPaise(overduePayable), overdueHeld };
}

/** "This week": seven compact day cells (amount that falls due each day);
 *  choosing a day lists its bills. Overdue bills collapse into one line. */
export function WeekStrip({ rows, onShowOverdue }: { rows: PayableRow[]; onShowOverdue?: () => void }) {
  const { days, overdue, overduePayable, overdueHeld } = useMemo(() => weekBuckets(rows), [rows]);
  const firstBusy = days.find((d) => d.rows.length)?.iso ?? days[0].iso;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = days.find((d) => d.iso === (picked ?? firstBusy)) ?? days[0];
  const weekTotal = days.reduce((s, d) => s + d.rows.length, 0);

  return (
    <div>
      {overdue.length ? (
        <button
          type="button"
          onClick={onShowOverdue}
          className="mb-4 flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] px-3.5 py-2.5 text-left text-[15px] transition-colors hover:bg-[var(--surface-2)]"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--sev-critical)]" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-[var(--ink)]">{plural(overdue.length, "bill")} already overdue</span>
            <span className="text-[var(--muted)]">
              {" "}· {formatMoneyCompact(overduePayable)} payable{overdueHeld ? ` · ${overdueHeld} on hold` : ""}
            </span>
          </span>
          <span className="shrink-0 text-[14px] font-medium text-[var(--accent-strong)] dark:text-[var(--accent)]">See list</span>
        </button>
      ) : null}

      <div role="group" aria-label="Next 7 days" className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const active = d.iso === selected.iso;
          const busy = d.rows.length > 0;
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => setPicked(d.iso)}
              aria-pressed={active}
              aria-label={`${formatDate(d.iso)}: ${busy ? `${plural(d.rows.length, "bill")} due, ${formatMoney(fromPaise(d.payable))} payable` : "nothing due"}`}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-[var(--radius-sm)] border px-1 pb-2 pt-1.5 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
                active ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)]" : "border-[var(--line)] hover:bg-[var(--surface-2)]",
              )}
            >
              <span className={cn("text-[13px]", active ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--muted)]")}>{d.label}</span>
              <span className="tnum text-[17px] font-semibold leading-6 text-[var(--ink)]">{d.dayNum}</span>
              <span className="mt-1 flex h-2 items-center gap-0.5" aria-hidden="true">
                {busy
                  ? Array.from({ length: Math.min(d.rows.length, 3) }, (_, i) => (
                    <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < d.held ? "bg-[var(--sev-medium)]" : "bg-[var(--accent)]")} />
                  ))
                  : <span className="h-px w-3 bg-[var(--line-strong)]" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 min-h-[124px]">
        <p className="text-[14px] font-medium text-[var(--muted)]">
          {formatDate(selected.iso)} · {selected.rows.length ? `${plural(selected.rows.length, "bill")} due` : "nothing due"}
        </p>
        {selected.rows.length ? (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {selected.rows.slice(0, 4).map((r) => {
              const held = toPaise(r.disputed.amount) > BigInt(0);
              return (
                <li key={r.documentId} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] text-[var(--ink)]">{r.supplier}</span>
                    <span className="block truncate font-code text-[13px] text-[var(--muted)]">{r.invoice}{r.msme ? " · MSME" : ""}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Money value={held ? r.payable : r.outstanding} className="text-[15px] font-medium text-[var(--ink)]" />
                    {held ? <StatusChip tone="warn" icon={PauseCircle}>{toPaise(r.payable.amount) > BigInt(0) ? "Part on hold" : "On hold"}</StatusChip> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-[15px] text-[var(--muted)]">
            {weekTotal ? "Pick a day with dots to see its bills." : "Nothing else falls due in the next 7 days."}
          </p>
        )}
        {selected.rows.length > 4 ? <p className="mt-1 text-[14px] text-[var(--muted)]">and {selected.rows.length - 4} more</p> : null}
      </div>
    </div>
  );
}

/* ---------------- unmatched money ---------------- */

export function UnallocatedList({ summary, limit = 4 }: { summary: DashboardSummary; limit?: number }) {
  if (!summary.unallocatedPayments.length) {
    return <p className="py-2 text-[15px] text-[var(--muted)]">Every payment is matched to a bill.</p>;
  }
  const waiting = fromPaise(summary.unallocatedPayments.reduce((s, p) => {
    const open = toPaise(p.amount) - toPaise(p.allocated);
    return open > BigInt(0) ? s + open : s;
  }, BigInt(0)));
  return (
    <div>
      <p className="text-[15px] text-[var(--ink-2)]">
        <span className="tnum text-[22px] font-semibold tracking-tight text-[var(--ink)]">{formatMoney(waiting)}</span>
        <span className="mt-0.5 block text-[14px] text-[var(--muted)]">across {plural(summary.unallocatedPayments.length, "payment")} with no bill linked</span>
      </p>
      <ul className="mt-3 divide-y divide-[var(--line)]">
        {summary.unallocatedPayments.slice(0, limit).map((p) => (
          <li key={p.documentId}>
            <Link href="/app/payments" className="flex items-center justify-between gap-3 py-2.5 transition-opacity hover:opacity-75">
              <span className="min-w-0">
                <span className="block truncate text-[15px] text-[var(--ink)]">{p.counterparty || "Unknown payee"}</span>
                <span className="mt-0.5 block truncate text-[13px] text-[var(--muted)]">
                  {p.date ? formatDate(p.date) : "Date not recorded"}
                  {p.utr ? ` · UTR ${p.utr}` : " · no bank reference"}
                </span>
              </span>
              <Money value={{ amount: fromPaise(toPaise(p.amount) - toPaise(p.allocated)), currency: "INR" }} className="shrink-0 text-[15px] font-medium text-[var(--ink)]" />
            </Link>
          </li>
        ))}
      </ul>
      {summary.unallocatedPayments.length > limit ? (
        <p className="mt-1 text-[14px] text-[var(--muted)]">and {summary.unallocatedPayments.length - limit} more</p>
      ) : null}
    </div>
  );
}

/* ---------------- recent activity ---------------- */

export type ActivityItem = { id: string; text: string; at: string; href?: string; severity?: string; code?: string; docRef?: string | null };

const SEV_DOT: Record<string, string> = {
  critical: "var(--sev-critical)", high: "var(--sev-high)", medium: "var(--sev-medium)", low: "var(--sev-low)", info: "var(--sev-info)",
};

/** First clause of an engine message, cleaned: one readable sentence. */
export function activitySentence(text: string): string {
  const clean = sanitizeEngineText(text);
  const first = clean.split(/;\s|\.\s(?=[A-Z])/)[0].replace(/[.;]\s*$/, "");
  return first.length > 150 ? `${first.slice(0, 147).trimEnd()}…` : first;
}

export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className="py-2 text-[15px] text-[var(--muted)]">Nothing recorded yet.</p>;
  return (
    <ul className="divide-y divide-[var(--line)]">
      {items.slice(0, 5).map((item) => {
        const row = (
          <>
            <span className="mt-[9px] h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_DOT[item.severity ?? "info"] ?? SEV_DOT.info }} aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-[var(--ink-2)]">{activitySentence(item.text)}</span>
            <span className="shrink-0 pt-0.5 text-[14px] text-[var(--muted)]">{timeAgo(item.at)}</span>
          </>
        );
        return (
          <li key={item.id}>
            {item.href ? (
              <Link href={item.href} className="flex items-start gap-3 py-3 transition-colors hover:text-[var(--ink)] [&:hover>span:nth-child(2)]:text-[var(--ink)]">{row}</Link>
            ) : (
              <div className="flex items-start gap-3 py-3">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
