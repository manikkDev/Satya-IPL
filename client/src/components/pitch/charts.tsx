"use client";

// Hand-built, responsive SVG charts for the model card. No chart library.
// Colours come only from theme tokens so light and dark both work. Every
// chart has an accessible name, a hover read-out, and a data table (via
// <details>) so nothing depends on colour or hover alone.

import { useId, useState } from "react";
import type { ReliabilityBin, CoveragePoint, Confusion } from "@/content/pitch/model-card";
import { cn } from "@/lib/utils";

export const pct = (v: number | undefined, dp = 1) => (v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);
export const dec = (v: number | undefined, dp = 3) => (v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(dp));
const int = (v: number) => v.toLocaleString("en-IN");

const AXIS = { stroke: "var(--line-strong)", strokeWidth: 1 } as const;
const GRID = { stroke: "var(--line)", strokeWidth: 1 } as const;
const TEXT = { fill: "var(--muted)", fontSize: 11 } as const;

function ChartFrame({ title, desc, children, table, readout }: { title: string; desc: string; children: React.ReactNode; table: React.ReactNode; readout: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold text-[var(--ink)]">{title}</figcaption>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{desc}</p>
      <div className="mt-3">{children}</div>
      <p className="mt-1 min-h-5 text-[12.5px] text-[var(--ink-2)] tnum" aria-live="polite">{readout}</p>
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer text-[var(--accent)]">Show data table</summary>
        <div className="relative mt-2 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full min-w-[320px] border-collapse text-left tnum">
      <thead>
        <tr className="border-b border-[var(--line)]">
          {head.map((h) => <th key={h} scope="col" className="px-2 py-1.5 font-medium text-[var(--muted)]">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-[var(--line)] last:border-0">
            {r.map((c, j) => <td key={j} className="px-2 py-1.5 text-[var(--ink-2)]">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- reliability diagram ---------------- */

export function ReliabilityDiagram({ bins }: { bins: ReliabilityBin[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 340, H = 300, L = 44, R = 12, T = 12, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const x = (v: number) => L + Math.max(0, Math.min(1, v)) * pw;
  const y = (v: number) => T + (1 - Math.max(0, Math.min(1, v))) * ph;
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  const sorted = [...bins].sort((a, b) => a.predicted - b.predicted);
  const path = sorted.map((b, i) => `${i ? "L" : "M"}${x(b.predicted).toFixed(1)},${y(b.observed).toFixed(1)}`).join(" ");
  const h = hover !== null ? sorted[hover] : null;
  const readout = h
    ? `Scores ${dec(h.binLow, 2)}–${dec(h.binHigh, 2)}: predicted ${pct(h.predicted)}, observed ${pct(h.observed)}, ${int(h.count)} pairs`
    : "Hover or focus a point for its values.";
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <ChartFrame
      title="Reliability diagram"
      desc="Each point is a score bin: how often a link was really correct (observed) against what the model said (predicted). On the dashed diagonal means well calibrated; below it means over-confident. Bigger points hold more pairs."
      readout={readout}
      table={<MiniTable head={["Bin", "Predicted", "Observed", "Pairs"]} rows={sorted.map((b) => [`${dec(b.binLow, 2)}–${dec(b.binHigh, 2)}`, pct(b.predicted), pct(b.observed), int(b.count)])} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[420px]" role="img" aria-labelledby={titleId}>
        <title id={titleId}>Reliability diagram: observed accuracy versus predicted confidence for {sorted.length} bins</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={GRID} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={TEXT}>{Math.round(t * 100)}%</text>
            <text x={x(t)} y={H - B + 15} textAnchor="middle" style={TEXT}>{Math.round(t * 100)}%</text>
          </g>
        ))}
        <line x1={L} y1={T} x2={L} y2={H - B} style={AXIS} />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} style={AXIS} />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} style={{ stroke: "var(--muted)", strokeWidth: 1.25, strokeDasharray: "4 4" }} />
        <text x={x(1) - 4} y={y(0) - 8} textAnchor="end" style={{ ...TEXT, fontSize: 10 }}>dashed line = perfect calibration</text>
        <path d={path} fill="none" style={{ stroke: "var(--accent)", strokeWidth: 2 }} strokeLinejoin="round" />
        {sorted.map((b, i) => {
          const r = 4 + 5 * Math.sqrt(b.count / maxCount);
          return (
            <g key={i}>
              <line x1={x(b.predicted)} x2={x(b.predicted)} y1={y(b.predicted)} y2={y(b.observed)} style={{ stroke: "var(--accent)", strokeWidth: 1, opacity: 0.35 }} />
              <circle
                cx={x(b.predicted)}
                cy={y(b.observed)}
                r={r}
                tabIndex={0}
                aria-label={`Bin ${dec(b.binLow, 2)} to ${dec(b.binHigh, 2)}: predicted ${pct(b.predicted)}, observed ${pct(b.observed)}, ${b.count} pairs`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2, opacity: hover === null || hover === i ? 1 : 0.55, cursor: "default", outline: "none" }}
              />
            </g>
          );
        })}
        <text x={L + pw / 2} y={H - 6} textAnchor="middle" style={{ ...TEXT, fill: "var(--ink-2)" }}>Predicted probability</text>
        <text transform={`translate(11 ${T + ph / 2}) rotate(-90)`} textAnchor="middle" style={{ ...TEXT, fill: "var(--ink-2)" }}>Observed share correct</text>
      </svg>
    </ChartFrame>
  );
}

/* ---------------- coverage vs precision ---------------- */

export function CoverageCurve({ points, threshold }: { points: CoveragePoint[]; threshold?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();
  const W = 340, H = 300, L = 48, R = 14, T = 12, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const sorted = [...points].sort((a, b) => a.coverage - b.coverage);
  const minP = Math.min(...sorted.map((p) => p.precision));
  const yLo = Math.max(0, Math.floor((minP - 0.02) * 20) / 20);
  const x = (v: number) => L + Math.max(0, Math.min(1, v)) * pw;
  const y = (v: number) => T + (1 - (Math.max(yLo, Math.min(1, v)) - yLo) / (1 - yLo || 1)) * ph;
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.coverage).toFixed(1)},${y(p.precision).toFixed(1)}`).join(" ");
  const op = threshold !== undefined ? sorted.reduce<CoveragePoint | null>((best, p) => (!best || Math.abs(p.threshold - threshold) < Math.abs(best.threshold - threshold) ? p : best), null) : null;
  const h = hover !== null ? sorted[hover] : null;
  const readout = h
    ? `Threshold ${dec(h.threshold, 2)}: auto-handles ${pct(h.coverage)} of pairs at ${pct(h.precision)} precision`
    : op ? `Operating point: threshold ${dec(op.threshold, 2)} → ${pct(op.coverage)} coverage at ${pct(op.precision)} precision` : "Hover or focus a point for its values.";
  const span = 1 - yLo;
  const step = span > 0.3 ? 0.1 : span > 0.12 ? 0.05 : 0.025;
  const yTicks: number[] = [];
  for (let t = 1; t >= yLo - 1e-9; t -= step) yTicks.push(Math.round(t * 1000) / 1000);
  return (
    <ChartFrame
      title="Coverage vs precision"
      desc="Raising the threshold makes the model handle fewer pairs on its own (coverage) but get more of them right (precision). Everything below the threshold goes to a person."
      readout={readout}
      table={<MiniTable head={["Threshold", "Coverage", "Precision"]} rows={sorted.map((p) => [dec(p.threshold, 2), pct(p.coverage), pct(p.precision)])} />}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[420px]" role="img" aria-labelledby={titleId}>
        <title id={titleId}>Precision against coverage for {sorted.length} thresholds{op ? `; operating point at ${pct(op.coverage)} coverage, ${pct(op.precision)} precision` : ""}</title>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={GRID} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" style={TEXT}>{Number((t * 100).toFixed(1))}%</text>
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <text key={t} x={x(t)} y={H - B + 15} textAnchor="middle" style={TEXT}>{Math.round(t * 100)}%</text>
        ))}
        <line x1={L} y1={T} x2={L} y2={H - B} style={AXIS} />
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} style={AXIS} />
        <path d={path} fill="none" style={{ stroke: "var(--accent)", strokeWidth: 2 }} strokeLinejoin="round" />
        {op ? (
          <g>
            <line x1={x(op.coverage)} x2={x(op.coverage)} y1={T} y2={H - B} style={{ stroke: "var(--ink-2)", strokeWidth: 1, strokeDasharray: "3 3" }} />
            <text x={x(op.coverage) + (op.coverage > 0.6 ? -6 : 6)} y={T + 10} textAnchor={op.coverage > 0.6 ? "end" : "start"} style={{ ...TEXT, fill: "var(--ink)" }}>
              operating point
            </text>
          </g>
        ) : null}
        {sorted.map((p, i) => {
          const isOp = op === p;
          return (
            <circle
              key={i}
              cx={x(p.coverage)}
              cy={y(p.precision)}
              r={isOp ? 6 : 4}
              tabIndex={0}
              aria-label={`Threshold ${dec(p.threshold, 2)}: coverage ${pct(p.coverage)}, precision ${pct(p.precision)}${isOp ? " (operating point)" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ fill: isOp ? "var(--ink)" : "var(--accent)", stroke: "var(--surface)", strokeWidth: 2, outline: "none" }}
            />
          );
        })}
        <text x={L + pw / 2} y={H - 6} textAnchor="middle" style={{ ...TEXT, fill: "var(--ink-2)" }}>Coverage (share auto-handled)</text>
        <text transform={`translate(11 ${T + ph / 2}) rotate(-90)`} textAnchor="middle" style={{ ...TEXT, fill: "var(--ink-2)" }}>Precision</text>
      </svg>
    </ChartFrame>
  );
}

/* ---------------- confusion matrix ---------------- */

export function ConfusionMatrix({ c, threshold }: { c: Confusion; threshold?: number }) {
  const total = c.tp + c.fp + c.fn + c.tn || 1;
  const cell = (label: string, value: number, plain: string, good: boolean) => (
    <div
      className={cn("rounded-[var(--radius-sm)] border p-3 sm:p-4", good ? "border-[var(--line)] bg-[var(--surface-2)]" : "border-dashed border-[var(--line-strong)] bg-[var(--surface)]")}
    >
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <p className="tnum mt-1 text-xl font-semibold text-[var(--ink)]">{int(value)}</p>
      <p className="tnum text-xs text-[var(--muted)]">{pct(value / total)} of test pairs</p>
      <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--ink-2)]">{plain}</p>
    </div>
  );
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold text-[var(--ink)]">Confusion matrix{threshold !== undefined ? ` at threshold ${dec(threshold, 2)}` : ""}</figcaption>
      <p className="mt-1 text-[13px] text-[var(--muted)]">Rows: what was true. Columns: what the model said. Dashed boxes are mistakes.</p>
      <div className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-2 text-sm" role="table" aria-label="Confusion matrix">
        <div role="row" className="contents">
          <span role="columnheader" />
          <span role="columnheader" className="px-1 text-xs font-medium text-[var(--muted)]">Said “link”</span>
          <span role="columnheader" className="px-1 text-xs font-medium text-[var(--muted)]">Said “no link”</span>
        </div>
        <div role="row" className="contents">
          <span role="rowheader" className="self-center pr-1 text-xs font-medium text-[var(--muted)] [writing-mode:vertical-rl] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0">Truly linked</span>
          <div role="cell">{cell("True positive", c.tp, "Correct auto-links", true)}</div>
          <div role="cell">{cell("False negative", c.fn, "Real links sent to review instead", false)}</div>
        </div>
        <div role="row" className="contents">
          <span role="rowheader" className="self-center pr-1 text-xs font-medium text-[var(--muted)] [writing-mode:vertical-rl] rotate-180 sm:[writing-mode:horizontal-tb] sm:rotate-0">Not linked</span>
          <div role="cell">{cell("False positive", c.fp, "Wrong links: the costly error", false)}</div>
          <div role="cell">{cell("True negative", c.tn, "Correctly kept apart", true)}</div>
        </div>
      </div>
    </figure>
  );
}

/* ---------------- interval bar (value + 95% CI) ---------------- */

export function IntervalRow({ label, value, ci, hint }: { label: string; value?: number; ci?: [number, number]; hint?: string }) {
  const w = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[9rem_1fr_9.5rem]">
      <span className="text-sm text-[var(--ink-2)]">{label}{hint ? <span className="block text-xs text-[var(--muted)]">{hint}</span> : null}</span>
      <div className="relative h-5" aria-hidden="true">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--surface-3)]" />
        {value !== undefined ? <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ width: w(value) }} /> : null}
        {ci ? (
          <div className="absolute top-1/2 h-3 -translate-y-1/2 border-x-2 border-[var(--ink)]" style={{ left: w(ci[0]), width: `calc(${w(ci[1])} - ${w(ci[0])})` }} />
        ) : null}
        {value !== undefined ? <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" style={{ left: w(value) }} /> : null}
      </div>
      <span className="tnum col-start-2 text-sm text-[var(--ink)] sm:col-start-auto sm:text-right">
        {pct(value)}
        {ci ? <span className="ml-1.5 text-xs text-[var(--muted)]">[{pct(ci[0])}–{pct(ci[1])}]</span> : null}
      </span>
    </div>
  );
}

/* ---------------- model vs baseline (dot plot) ---------------- */

export function BaselineCompare({ rows, modelLabel, baselineLabel }: { rows: { label: string; model?: number; baseline?: number; lowerIsBetter?: boolean }[]; modelLabel: string; baselineLabel: string }) {
  const w = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  const shown = rows.filter((r) => r.model !== undefined || r.baseline !== undefined);
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold text-[var(--ink)]">Against the baseline</figcaption>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--ink-2)]">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-[var(--accent)]" aria-hidden="true" />{modelLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-[var(--saffron)] bg-[var(--surface)]" aria-hidden="true" />{baselineLabel}</span>
      </div>
      <div className="mt-3 space-y-3">
        {shown.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,6.5rem)_1fr] items-center gap-x-3 sm:grid-cols-[8rem_1fr_10rem]">
            <span className="text-sm text-[var(--ink-2)]">{r.label}{r.lowerIsBetter ? <span className="block text-[11px] text-[var(--muted)]">lower is better</span> : null}</span>
            <div className="relative h-5" aria-hidden="true">
              <div className="absolute inset-x-0 top-1/2 h-px bg-[var(--line-strong)]" />
              {r.baseline !== undefined ? <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--saffron)] bg-[var(--surface)]" style={{ left: w(r.baseline) }} /> : null}
              {r.model !== undefined ? <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)]" style={{ left: w(r.model) }} /> : null}
            </div>
            <span className="tnum col-start-2 text-xs text-[var(--ink-2)] sm:col-start-auto sm:text-right">
              {dec(r.model)} <span className="text-[var(--muted)]">vs</span> {dec(r.baseline)}
            </span>
          </div>
        ))}
      </div>
      <details className="mt-3 text-[13px]">
        <summary className="cursor-pointer text-[var(--accent)]">Show data table</summary>
        <div className="relative mt-2 overflow-x-auto">
          <MiniTable head={["Metric", modelLabel, baselineLabel]} rows={shown.map((r) => [r.label, dec(r.model), dec(r.baseline)])} />
        </div>
      </details>
    </figure>
  );
}

/* ---------------- simple horizontal bars (0..1) ---------------- */

export function BarList({ title, rows, note }: { title: string; rows: { label: string; value?: number; n?: number; text?: string }[]; note?: string }) {
  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-semibold text-[var(--ink)]">{title}</figcaption>
      {note ? <p className="mt-1 text-[13px] text-[var(--muted)]">{note}</p> : null}
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 sm:grid-cols-[11rem_1fr_7.5rem]">
            <span className="text-sm text-[var(--ink-2)]">{r.label}</span>
            <span className="relative h-2 rounded-[4px] bg-[var(--surface-3)]" aria-hidden="true">
              {r.value !== undefined ? <span className="absolute inset-y-0 left-0 rounded-[4px] bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(1, r.value)) * 100}%` }} /> : null}
            </span>
            <span className="tnum text-right text-sm text-[var(--ink)]">
              {r.text ?? pct(r.value)}
              {r.n !== undefined ? <span className="ml-1 text-xs text-[var(--muted)]">n={int(r.n)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
