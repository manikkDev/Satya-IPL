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

/** Aging buckets "0-30/31-60/61-90/90+" — severity rises with age. */
export function AgingBars({ aging }: { aging: DashboardSummary["aging"] }) {
  const entries = Object.entries(aging);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const tones = ["var(--confirmed)", "var(--sev-low)", "var(--sev-medium)", "var(--sev-critical)"];
  return (
    <div className="flex h-28 items-end gap-4">
      {entries.map(([bucket, n], i) => (
        <div key={bucket} className="flex flex-1 flex-col items-center gap-1.5">
          <span className="tnum text-sm font-semibold text-[var(--ink)]">{n}</span>
          <div className="w-full rounded-t-md" style={{ height: `${Math.max(4, (n / max) * 64)}px`, background: tones[i], opacity: n ? 1 : 0.25 }} />
          <span className="text-[10px] text-[var(--muted)]">{bucket}d</span>
        </div>
      ))}
    </div>
  );
}

/** Monthly document-value series — vertical bars, last ≤8 months. */
export function SeriesBars({ series }: { series: DashboardSummary["monthlySeries"] }) {
  const items = series.slice(-8);
  const max = Math.max(1, ...items.map((m) => Number(m.value)));
  return (
    <div>
      <div className="flex h-28 items-end gap-2">
        {items.map((m) => {
          const h = Math.max(3, (Number(m.value) / max) * 80);
          return (
            <div key={m.month} className="group flex flex-1 flex-col items-center justify-end gap-1.5" title={`${m.month}: ${fmt(m.value)} across ${m.docs} docs`}>
              <span className="tnum text-[10px] font-medium text-[var(--muted)] opacity-0 transition-opacity group-hover:opacity-100">{fmt(m.value)}</span>
              <div className="w-full rounded-t-md bg-[var(--accent)]/80 transition-colors group-hover:bg-[var(--accent)]" style={{ height: `${h}px` }} />
              <span className="text-[10px] text-[var(--muted)]">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
            </div>
          );
        })}
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
  return (
    <ul className="divide-y divide-[var(--line)]">
      {summary.unallocatedPayments.slice(0, 8).map((p) => (
        <li key={p.documentId} className="flex items-center justify-between gap-3 py-2">
          <span className="font-code text-xs text-[var(--ink-2)]">{p.documentId}</span>
          <span className="tnum text-sm"><Money value={{ amount: p.amount, currency: "INR" }} /></span>
        </li>
      ))}
    </ul>
  );
}

export function ComplianceStrip({ summary }: { summary: ComplianceSummary }) {
  const items = [
    { label: "MSME 45-day", value: summary.msme45.count, note: "supplier payments due", tone: summary.msme45.count ? "var(--sev-high)" : "var(--confirmed)", href: "/app/compliance" },
    { label: "Rule 37 risk", value: summary.rule37.count, note: `${fmt(summary.rule37.itcAtRisk)} credit at risk`, tone: summary.rule37.count ? "var(--sev-medium)" : "var(--confirmed)", href: "/app/compliance" },
    { label: "e-invoice coverage", value: `${summary.einvoiceCoverage.pct}%`, note: `${summary.einvoiceCoverage.withIrn} of ${summary.einvoiceCoverage.invoices} invoices`, tone: "var(--ink)", href: "/app/compliance" },
    { label: "Credit notes pending", value: summary.creditNotesUnapplied.count, note: "not yet applied", tone: summary.creditNotesUnapplied.count ? "var(--possible)" : "var(--confirmed)", href: "/app/compliance" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <Link key={item.label} href={item.href} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--accent)]/50">
          <p className="text-[11px] text-[var(--muted)]">{item.label}</p>
          <p className="tnum mt-1.5 text-xl font-semibold tracking-tight" style={{ color: item.tone }}>{item.value}</p>
          <p className="mt-0.5 text-[10px] text-[var(--muted)]">{item.note}</p>
        </Link>
      ))}
    </div>
  );
}
