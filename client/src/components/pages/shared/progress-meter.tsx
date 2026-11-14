"use client";

// Compact percentage meter for "how far has this order got" columns.
// Tone "ahead" flags billing that has run ahead of delivery.

import { cn } from "@/lib/utils";

export function PercentMeter({ pct, tone = "default", label }: { pct: string | number | null | undefined; tone?: "default" | "done" | "ahead"; label?: string }) {
  const value = Math.min(100, Math.max(0, Number(pct ?? 0) || 0));
  const color = tone === "ahead" ? "var(--sev-high)" : value >= 100 ? "var(--confirmed)" : "var(--accent)";
  return (
    <span className="inline-flex items-center gap-2" title={label}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </span>
      <span className={cn("tnum w-10 text-right text-[14px]", value === 0 ? "text-[var(--muted)]" : tone === "ahead" ? "font-medium text-[var(--sev-high)]" : "text-[var(--ink-2)]")}>
        {Math.round(value)}%
      </span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Delivered / Billed / Paid as three tiny labelled bars in one cell. */
export function ProgressStack({ rows }: { rows: { label: string; pct: string | number | null | undefined; warn?: boolean }[] }) {
  return (
    <div className="grid w-[168px] grid-cols-[58px_1fr_38px] items-center gap-x-2 gap-y-1 text-[13px] leading-4">
      {rows.map((r) => {
        const value = Math.min(100, Math.max(0, Number(r.pct ?? 0) || 0));
        const color = r.warn ? "var(--sev-high)" : value >= 100 ? "var(--confirmed)" : "var(--accent)";
        return (
          <div key={r.label} className="contents">
            <span className="text-[var(--muted)]">{r.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]" aria-hidden="true">
              <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
            </span>
            <span className={cn("tnum text-right", r.warn ? "font-semibold text-[var(--sev-high)]" : value === 0 ? "text-[var(--muted)]" : "text-[var(--ink-2)]")}>
              {Math.round(value)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Three-step lifecycle strip: Delivered → Billed → Paid. */
export function LifecycleStrip({
  steps,
  className,
}: {
  steps: { label: string; pct: number; detail?: React.ReactNode; warn?: boolean }[];
  className?: string;
}) {
  return (
    <ol className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {steps.map((s) => {
        const value = Math.min(100, Math.max(0, s.pct));
        const color = s.warn ? "var(--sev-high)" : value >= 100 ? "var(--confirmed)" : "var(--accent)";
        return (
          <li key={s.label} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-medium text-[var(--ink-2)]">{s.label}</span>
              <span className={cn("tnum text-[17px] font-semibold", s.warn ? "text-[var(--sev-high)]" : "text-[var(--ink)]")}>{Math.round(value)}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={s.label}>
              <div className="bar-anim h-full rounded-full" style={{ width: `${value}%`, background: color }} />
            </div>
            {s.detail ? <p className="mt-2 text-[13px] leading-snug text-[var(--muted)]">{s.detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
