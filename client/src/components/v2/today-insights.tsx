"use client";

// Drill-down + chart pieces for the Today page (06 §5.1).
// KpiDrillDown: per-card modal with the numbers behind the number.
// Bar components are pure CSS/SVG — no chart dependency, exact strings in.

import Link from "next/link";
import { useEffect } from "react";
import { X } from "lucide-react";
import { Money } from "@/components/ui/v2";
import type { DashboardSummary, ComplianceSummary } from "@/lib/api/v2";

const fmt = (v: string) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export function KpiDrillDown({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label={title}>
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--paper)] p-6 shadow-[var(--shadow-3)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight text-[var(--ink)]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DrillRow({ label, value, note }: { label: React.ReactNode; value: React.ReactNode; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-2.5 last:border-0">
      <div className="min-w-0"><p className="text-sm text-[var(--ink-2)]">{label}</p>{note && <p className="text-[11px] text-[var(--muted)]">{note}</p>}</div>
      <div className="tnum shrink-0 text-sm font-medium text-[var(--ink)]">{value}</div>
    </div>
  );
}

/** Horizontal bar — label left, bar middle, value right. */
export function HBar({ label, value, max, display, href }: { label: string; value: number; max: number; display: string; href?: string }) {
  const pct = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-[var(--ink-2)]">{label}</span>
        <span className="tnum shrink-0 text-xs font-medium text-[var(--ink)]">{display}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full bg-[var(--accent)] transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </>
  );
  return href ? <Link href={href} className="block py-1.5 hover:opacity-80">{inner}</Link> : <div className="py-1.5">{inner}</div>;
}

/** Aging buckets "0-30/31-60/61-90/90+" — severity rises with age; rows are
 *  more readable than bars when one bucket dwarfs the rest. Click-through
 *  lands on the investigations list. */
export function AgingBars({ aging }: { aging: DashboardSummary["aging"] }) {
  const entries = Object.entries(aging);
  const total = Math.max(1, entries.reduce((s, [, n]) => s + n, 0));
  const tones = ["var(--confirmed)", "var(--sev-low)", "var(--sev-medium)", "var(--sev-critical)"];
  return (
    <div className="space-y-2">
      {entries.map(([bucket, n], i) => (
        <Link key={bucket} href="/app/investigations" className="block py-0.5 hover:opacity-80" title={`${n} investigation${n === 1 ? "" : "s"} open ${bucket} days`}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-[var(--ink-2)]">{bucket === "90+" ? "Over 90 days" : `${bucket} days`}</span>
            <span className="tnum text-xs font-semibold text-[var(--ink)]">{n}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(n ? 2 : 0, (n / total) * 100)}%`, background: tones[i] }} />
          </div>
        </Link>
      ))}
    </div>
  );
}

/** Monthly document-value series — vertical bars, last ≤8 months.
 *  min-w-0 + overflow-hidden keep wide values inside the card. */
export function SeriesBars({ series }: { series: DashboardSummary["monthlySeries"] }) {
  const items = series.slice(-8);
  const max = Math.max(1, ...items.map((m) => Number(m.value)));
  return (
    <div className="overflow-hidden">
      <div className="flex h-24 items-end gap-1.5">
        {items.map((m) => {
          const h = Math.max(4, (Number(m.value) / max) * 96);
          return (
            <div key={m.month} className="group flex min-w-0 flex-1 flex-col items-center justify-end" title={`${m.month}: ${fmt(m.value)} across ${m.docs} docs`}>
              <div className="w-full rounded-t bg-[var(--accent)]/70 transition-colors group-hover:bg-[var(--accent)]" style={{ height: `${h}px` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {items.map((m) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[9px] text-[var(--muted)]">
            {m.month.slice(5)}/{m.month.slice(2, 4)}
          </span>
        ))}
      </div>
      {!items.length && <p className="py-6 text-center text-xs text-[var(--muted)]">No document history yet.</p>}
    </div>
  );
}

/** Severity/certainty breakdown for the "under question" drill-down. */
export function IssueBreakdown({ summary }: { summary: DashboardSummary }) {
  const sevOrder = ["critical", "high", "medium", "low", "info"];
  const certOrder = ["CONFIRMED", "PROBABLE", "POSSIBLE", "AMBIGUOUS", "INSUFFICIENT_EVIDENCE"];
  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">By severity</p>
        {sevOrder.map((s) => (
          <DrillRow key={s} label={<span className="capitalize">{s}</span>} value={summary.issuesBySeverity[s] ?? 0} />
        ))}
      </div>
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">By certainty</p>
        {certOrder.map((c) => (
          <DrillRow key={c} label={c.toLowerCase().replaceAll("_", " ")} value={summary.findingsByCertainty[c] ?? 0} />
        ))}
      </div>
    </div>
  );
}

export function UnallocatedList({ summary }: { summary: DashboardSummary }) {
  if (!summary.unallocatedPayments.length)
    return <p className="py-3 text-sm text-[var(--muted)]">Every payment is allocated — nothing is waiting for a remittance reference.</p>;
  const waiting = summary.unallocatedPayments.reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.allocated)), 0);
  return (
    <div>
      <p className="mb-1 text-xs text-[var(--muted)]">
        <span className="tnum font-semibold text-[var(--ink)]">{fmt(String(waiting.toFixed(2)))}</span> is unlinked across{" "}
        {summary.unallocatedPayments.length} payment{summary.unallocatedPayments.length === 1 ? "" : "s"} — click one to allocate it.
      </p>
      <ul className="divide-y divide-[var(--line)]">
        {summary.unallocatedPayments.slice(0, 8).map((p) => (
          <li key={p.documentId}>
            <Link href="/app/payments" className="flex items-center justify-between gap-3 py-2 hover:opacity-75">
              <span className="font-code text-xs text-[var(--ink-2)]">{p.documentId}</span>
              <span className="tnum text-sm"><Money value={{ amount: p.amount, currency: "INR" }} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComplianceStrip({ summary }: { summary: ComplianceSummary }) {
  const items = [
    {
      label: "MSME 45-day", value: summary.msme45.count, detail: summary.msme45.count
        ? `${summary.msme45.count} payment${summary.msme45.count === 1 ? "" : "s"} approaching the 45-day limit — late MSME payments cost 3× interest and can't be deducted until paid.`
        : "No micro/small supplier payments are near the 45-day limit.",
      tone: summary.msme45.count ? "var(--sev-high)" : "var(--confirmed)",
    },
    {
      label: "Rule 37 risk", value: summary.rule37.count, detail: summary.rule37.count
        ? `${fmt(summary.rule37.itcAtRisk)} of GST credit reverses if these invoices stay unpaid past 180 days.`
        : "No invoices are close to the 180-day ITC-reversal window.",
      tone: summary.rule37.count ? "var(--sev-medium)" : "var(--confirmed)",
    },
    {
      label: "e-invoice coverage", value: `${summary.einvoiceCoverage.pct}%`, detail: `${summary.einvoiceCoverage.withIrn} of ${summary.einvoiceCoverage.invoices} recorded invoices carry an IRN — a missing IRN on an e-invoicing-registered seller's bill is a finding.`,
      tone: "var(--ink)",
    },
    {
      label: "Credit notes pending", value: summary.creditNotesUnapplied.count, detail: summary.creditNotesUnapplied.count
        ? "Issued credit notes that haven't been applied against an invoice yet — apply them before they lapse."
        : "All issued credit notes have been applied.",
      tone: summary.creditNotesUnapplied.count ? "var(--possible)" : "var(--confirmed)",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link key={item.label} href="/app/compliance" className="flex flex-col rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--surface-2)]/40">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-[var(--muted)]">{item.label}</p>
            <span className="tnum text-xl font-semibold tracking-tight" style={{ color: item.tone }}>{item.value}</span>
          </div>
          <p className="mt-2 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">{item.detail}</p>
        </Link>
      ))}
    </div>
  );
}
