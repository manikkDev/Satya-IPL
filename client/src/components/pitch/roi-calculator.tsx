"use client";

// Interactive ROI calculator for /roi. State lives in the URL query string
// so any scenario can be shared or printed. All arithmetic happens in
// content/pitch/roi.ts with exact scaled-BigInt decimals.

import { useEffect, useMemo, useState } from "react";
import { Link2, Printer, RotateCcw, Check } from "lucide-react";
import { INPUTS, GROUPS, compute, defaultInputs, toQuery, fromQuery, fmtScaled, toPaise, D, div, type Inputs, type Scenario, type InputSpec } from "@/content/pitch/roi";
import { REFERENCES } from "@/content/pitch/references";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

const rupees = (scaled: bigint) => {
  const paise = toPaise(scaled);
  const whole = (paise + BigInt(50)) / BigInt(100); // half-up to the rupee for display
  return formatMoney(`${whole}`).replace(/\.00$/, "");
};
const num = (scaled: bigint, dp = 0) => Number(fmtScaled(scaled, dp)).toLocaleString("en-IN", { maximumFractionDigits: dp });

function SourceNote({ spec }: { spec: InputSpec }) {
  const s = spec.source;
  const tag =
    s.kind === "benchmark" ? "Benchmark" : s.kind === "statutory" ? "Statutory" : s.kind === "assumption" ? "Assumption" : "Placeholder";
  const refs = "refs" in s ? s.refs.map((n) => REFERENCES.find((r) => r.n === n)).filter(Boolean) : [];
  return (
    <p className="mt-1 text-[12.5px] leading-snug text-[var(--muted)]">
      <span
        className={cn(
          "mr-1.5 inline-flex rounded-full border px-1.5 text-[11px] font-medium",
          s.kind === "benchmark" || s.kind === "statutory" ? "border-[var(--line-strong)] text-[var(--ink-2)]" : "border-dashed border-[var(--line-strong)]",
        )}
      >
        {tag}
      </span>
      {s.note}
      {refs.map((r) =>
        r && r.url ? (
          <a key={r.n} href={r.url} target="_blank" rel="noopener noreferrer" className="ml-1 text-[var(--accent)] underline underline-offset-2 print:no-underline">
            [{r.n}]<span className="sr-only"> source (opens in a new tab)</span>
          </a>
        ) : null,
      )}
    </p>
  );
}

const UNIT_PREFIX: Partial<Record<InputSpec["unit"], string>> = { inr: "₹" };
const UNIT_SUFFIX: Partial<Record<InputSpec["unit"], string>> = { pct: "%", min: "min", days: "days", hours: "h" };

export function RoiCalculator() {
  const [scenario, setScenario] = useState<Scenario>("expected");
  const [inputs, setInputs] = useState<Inputs>(() => defaultInputs("expected"));
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read shared state from the URL once on mount.
  useEffect(() => {
    const parsed = fromQuery(window.location.search);
    setScenario(parsed.scenario);
    setInputs(parsed.inputs);
    setHydrated(true);
  }, []);

  // Keep the URL in sync so the link is always shareable.
  useEffect(() => {
    if (!hydrated) return;
    const q = toQuery(scenario, inputs);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }, [scenario, inputs, hydrated]);

  const r = useMemo(() => compute(inputs), [inputs]);

  const switchScenario = (s: Scenario) => {
    // Scenario changes only the "what changes with Satya" assumptions; keep the customer's own figures.
    const next = { ...inputs };
    const base = defaultInputs(s);
    for (const spec of INPUTS) if (spec.group === "effect") next[spec.key] = base[spec.key];
    setScenario(s);
    setInputs(next);
  };

  const setOne = (key: keyof Inputs, value: string) => {
    if (!/^\d{0,12}(\.\d{0,6})?$/.test(value)) return;
    setInputs((prev) => ({ ...prev, [key]: value }));
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const v = inputs;
  const outputs = [
    { label: "AP hours freed per year", value: `${num(r.hoursSavedPerYear)} h`, sub: r.hoursCapped ? "Capped at your team's total hours." : `≈ ${fmtScaled(D(v.hoursPerFteYear) > BigInt(0) ? div(r.hoursSavedPerYear, D(v.hoursPerFteYear)) : BigInt(0), 2)} of one person's working year` },
    { label: "Labour cost freed per year", value: rupees(r.labourSavedPerYear), sub: `at ${rupees(r.hourlyCost)} an hour` },
    { label: "MSME interest avoided per year", value: rupees(r.interestAvoidedPerYear), sub: `of ${rupees(r.interestExposurePerYear)} statutory exposure` },
    { label: "Duplicate/erroneous payments stopped", value: rupees(r.duplicatesPreventedPerYear), sub: `of ${rupees(r.paymentsAtRiskPerYear)} at risk. Much would be recovered later.` },
    { label: "Input tax credit protected", value: rupees(r.itcProtectedPerYear), sub: "per year" },
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
      {/* ---------------- inputs ---------------- */}
      <div className="min-w-0 space-y-8">
        <fieldset className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5 print:hidden">
          <legend className="px-1 text-sm font-semibold text-[var(--ink)]">Scenario</legend>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Scenario">
            {(["conservative", "expected"] as const).map((s) => (
              <label
                key={s}
                className={cn(
                  "flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium capitalize transition-colors",
                  scenario === s ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line-strong)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]",
                )}
              >
                <input type="radio" name="scenario" value={s} checked={scenario === s} onChange={() => switchScenario(s)} className="sr-only" />
                {s}
              </label>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
            The toggle changes only the assumptions about what Satya changes. Your own figures stay as you entered them.
          </p>
        </fieldset>

        {GROUPS.map((g) => (
          <fieldset key={g.id} className="min-w-0">
            <legend className="text-base font-semibold text-[var(--ink)]">{g.title}</legend>
            <p className="mt-1 text-sm text-[var(--muted)]">{g.hint}</p>
            <div className="mt-4 space-y-4">
              {INPUTS.filter((i) => i.group === g.id).map((spec) => {
                const id = `roi-${spec.key}`;
                return (
                  <div key={spec.key}>
                    <label htmlFor={id} className="block text-[15px] text-[var(--ink)]">{spec.label}</label>
                    <div className="mt-1.5 flex max-w-xs items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/25">
                      {UNIT_PREFIX[spec.unit] ? <span className="pl-3 text-sm text-[var(--muted)]" aria-hidden="true">{UNIT_PREFIX[spec.unit]}</span> : null}
                      <input
                        id={id}
                        inputMode="decimal"
                        autoComplete="off"
                        value={v[spec.key]}
                        onChange={(e) => setOne(spec.key, e.target.value.replace(/[,\s₹]/g, ""))}
                        className="tnum h-10 w-full min-w-0 bg-transparent px-3 text-[15px] text-[var(--ink)] outline-none"
                        aria-describedby={`${id}-src`}
                      />
                      {UNIT_SUFFIX[spec.unit] ? <span className="pr-3 text-sm text-[var(--muted)]" aria-hidden="true">{UNIT_SUFFIX[spec.unit]}</span> : null}
                    </div>
                    <div id={`${id}-src`}><SourceNote spec={spec} /></div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {/* ---------------- outputs ---------------- */}
      <div className="min-w-0 lg:sticky lg:top-20">
        <section aria-labelledby="roi-out" className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="roi-out" className="text-base font-semibold text-[var(--ink)]">Estimated annual value</h2>
            <span className="text-xs capitalize text-[var(--muted)]">{scenario} scenario</span>
          </div>
          <p className="tnum mt-3 text-[34px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]" aria-live="polite">{rupees(r.totalPerYear)}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
            Labour + MSME interest avoided + payments stopped + ITC protected. An estimate from benchmarks and your
            inputs, not a promise. A pilot measures the real figures on your data.
          </p>
          <dl className="mt-5 divide-y divide-[var(--line)] border-t border-[var(--line)]">
            {outputs.map((o) => (
              <div key={o.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
                <dt className="text-sm text-[var(--ink-2)]">{o.label}<span className="block text-xs text-[var(--muted)]">{o.sub}</span></dt>
                <dd className="tnum text-base font-semibold text-[var(--ink)]">{o.value}</dd>
              </div>
            ))}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-3">
              <dt className="text-sm text-[var(--ink-2)]">
                43B(h) deduction kept in the year
                <span className="block text-xs text-[var(--muted)]">Tax timing worth {rupees(r.taxTimingBenefit)}. Not added to the total: it is deferred, not lost.</span>
              </dt>
              <dd className="tnum text-base font-semibold text-[var(--ink)]">{rupees(r.deductionProtected)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <button type="button" onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)]">
              {copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />} {copied ? "Link copied" : "Copy shareable link"}
            </button>
            <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]">
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <button type="button" onClick={() => { setScenario("expected"); setInputs(defaultInputs("expected")); }} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]">
              <RotateCcw size={14} aria-hidden="true" /> Reset
            </button>
          </div>
        </section>
      </div>

      {/* ---------------- formulas ---------------- */}
      <section aria-labelledby="roi-formulas" className="min-w-0 lg:col-span-2">
        <h2 id="roi-formulas" className="text-xl font-semibold text-[var(--ink)]">Every formula, with your numbers</h2>
        <p className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-[var(--muted)]">
          Money is computed exactly in decimal (no floating-point drift) and rounded to the rupee only for display.
          Percentages are divided by 100.
        </p>
        <ol className="mt-6 space-y-4">
          <Formula
            n={1}
            title="Hours freed"
            expr="12 × [invoices × touchless × min/invoice + invoices × exception rate × exception reduction × min/exception] ÷ 60, capped at staff × hours/person"
            filled={`12 × [${v.invoicesPerMonth} × ${v.touchlessPct}% × ${v.minutesPerInvoice} + ${v.invoicesPerMonth} × ${v.exceptionRatePct}% × ${v.exceptionReductionPct}% × ${v.minutesPerException}] ÷ 60 = ${fmtScaled(r.hoursSavedPerYear, 2)} h`}
          />
          <Formula
            n={2}
            title="Labour cost freed"
            expr="hours freed × (loaded cost per person ÷ hours per person)"
            filled={`${fmtScaled(r.hoursSavedPerYear, 2)} × (${v.loadedCostPerFte} ÷ ${v.hoursPerFteYear}) = ${rupees(r.labourSavedPerYear)}`}
          />
          <Formula
            n={3}
            title="MSME interest exposure (MSMED s.16)"
            expr="late MSE payments a month × [(1 + 3 × bank rate ÷ 12)^whole months × (1 + 3 × bank rate ÷ 12 × part month) − 1] × 12; months late = days late × 12 ÷ 365"
            filled={`(${v.monthlyPayables} × ${v.msmeSharePct}% × ${v.latePaidSharePct}%) = ${rupees(r.lateMsePerMonth)} a month; ${fmtScaled(r.monthsLate, 4)} months late → factor ${fmtScaled(r.interestFactor, 6)}; × 12 = ${rupees(r.interestExposurePerYear)}. Avoided at ${v.latePreventedPct}% = ${rupees(r.interestAvoidedPerYear)}`}
            note="Compound interest with monthly rests at three times the RBI bank rate, counted from the acceptance date. The part-month uses simple interest."
          />
          <Formula
            n={4}
            title="s.43B(h) deduction kept in the year"
            expr="late MSE payments a month × min(months late, 12) × share prevented; tax timing = that × tax rate"
            filled={`${rupees(r.lateMsePerMonth)} × ${fmtScaled(r.monthsLate < D(12) ? r.monthsLate : D(12), 4)} × ${v.latePreventedPct}% = ${rupees(r.deductionProtected)}; × ${v.taxRatePct}% = ${rupees(r.taxTimingBenefit)}`}
            note="An approximation of late MSE dues outstanding at 31 March. The deduction moves to the year you pay; it is not lost, so it is shown separately and not added to the total."
          />
          <Formula
            n={5}
            title="Duplicate/erroneous payments stopped"
            expr="monthly payments × 12 × duplicate rate × share caught"
            filled={`${v.monthlyPayables} × 12 × ${v.duplicateRatePct}% × ${v.duplicateCatchPct}% = ${rupees(r.duplicatesPreventedPerYear)}`}
            note="APQC's rate covers duplicate and erroneous payments, much of which is recovered later. This is cash kept from leaving, not a loss estimate."
          />
          <Formula
            n={6}
            title="Input tax credit protected"
            expr="ITC at risk × share protected"
            filled={`${v.itcAtRiskPerYear} × ${v.itcProtectedPct}% = ${rupees(r.itcProtectedPerYear)}`}
          />
        </ol>
      </section>
    </div>
  );
}

function Formula({ n, title, expr, filled, note }: { n: number; title: string; expr: string; filled: string; note?: string }) {
  return (
    <li className="break-inside-avoid rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
      <p className="text-[15px] font-semibold text-[var(--ink)]"><span className="tnum mr-2 text-[var(--muted)]">{n}.</span>{title}</p>
      <p className="mt-2 font-code text-[13px] leading-relaxed text-[var(--ink-2)] [overflow-wrap:anywhere]">{expr}</p>
      <p className="tnum mt-2 font-code text-[13px] leading-relaxed text-[var(--ink)] [overflow-wrap:anywhere]">= {filled}</p>
      {note ? <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{note}</p> : null}
    </li>
  );
}
