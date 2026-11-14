"use client";

// Model performance view, shared by /app/model (workspace) and
// /research/model (public, read-only). Data comes live from the PUBLIC
// endpoint GET {NEXT_PUBLIC_GRAPH_API_URL}/api/v2/meta/model-card. With
// NEXT_PUBLIC_USE_MOCKS=1 a clearly labelled sample fixture is used instead.
// Nothing is computed or invented here beyond simple derived counts; missing
// fields render as "not reported".

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, FlaskConical } from "lucide-react";
import { SERVER_URL } from "@/utils/commonHelper";
import { mocksEnabled } from "@/lib/flags";
import { Skeleton } from "@/components/ui/skeleton";
import {
  normalizeModelCard, isEmptyCard, flattenSummary, toProvenance,
  type ModelCard, type MatchModel, type Provenance, type Metrics,
} from "@/content/pitch/model-card";
import { SAMPLE_MODEL_CARD, SAMPLE_MODEL_CARD_LABEL } from "@/content/pitch/model-card.sample";
import { REFERENCES } from "@/content/pitch/references";
import { ReliabilityDiagram, CoverageCurve, ConfusionMatrix, IntervalRow, BaselineCompare, BarList, pct, dec } from "@/components/pitch/charts";
import { cn } from "@/lib/utils";

export const MODEL_CARD_URL = `${SERVER_URL}/api/v2/meta/model-card`;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string; notYet: boolean }
  | { status: "ready"; card: ModelCard | null; sample: boolean };

function useModelCard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    if (mocksEnabled()) {
      setState({ status: "ready", card: normalizeModelCard(SAMPLE_MODEL_CARD), sample: true });
      return;
    }
    try {
      const res = await fetch(MODEL_CARD_URL, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
      if (res.status === 404 || res.status === 501 || res.status === 204) {
        setState({ status: "error", notYet: true, message: "The evaluation service hasn't published a model card yet." });
        return;
      }
      if (!res.ok) throw new Error(`The model-card service answered ${res.status}.`);
      const json: unknown = await res.json();
      const body = json && typeof json === "object" && "data" in json && (json as { data?: unknown }).data ? (json as { data: unknown }).data : json;
      setState({ status: "ready", card: normalizeModelCard(body), sample: false });
    } catch (e) {
      const message = e instanceof Error && e.name === "TimeoutError" ? "The model-card service took too long to answer." : e instanceof Error ? e.message : "Network error.";
      setState({ status: "error", notYet: false, message });
    }
  }, []);
  useEffect(() => {
    // Initial fetch on mount; load() sets state asynchronously.
    void load();
  }, [load]);
  return { state, reload: load };
}

/* ---------------- small pieces ---------------- */

const PROVENANCE: Record<Provenance, { label: string; tone: "warn" | "neutral" | "accent" }> = {
  synthetic: { label: "Synthetic", tone: "warn" },
  bpi2019: { label: "BPI-2019 derived", tone: "neutral" },
  demo: { label: "Demo data", tone: "warn" },
  public_benchmark: { label: "Public benchmark", tone: "neutral" },
  backtest: { label: "Customer backtest", tone: "accent" },
  shadow: { label: "Shadow mode", tone: "accent" },
  live: { label: "Live audit slice", tone: "accent" },
  unknown: { label: "Provenance not stated", tone: "warn" },
};

export function ProvenanceBadge({ p, raw }: { p: Provenance; raw?: string }) {
  const style = PROVENANCE[p];
  return (
    <span
      title={raw ? `Reported as “${raw}”` : undefined}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-5",
        style.tone === "warn" && "border-[color-mix(in_srgb,var(--possible)_40%,transparent)] bg-[var(--possible-soft)] text-[var(--possible)]",
        style.tone === "neutral" && "border-[var(--line-strong)] bg-[var(--surface-2)] text-[var(--ink-2)]",
        style.tone === "accent" && "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]",
      )}
    >
      {style.label}
    </span>
  );
}

const isRealCustomer = (p: Provenance) => p === "backtest" || p === "shadow" || p === "live";

function fmtDate(v?: string) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-xl font-semibold tracking-[-0.015em] text-[var(--ink)]">{children}</h2>;
}

function Box({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5", className)}>{children}</div>;
}

function NotReported({ what }: { what: string }) {
  return <p className="text-sm text-[var(--muted)]">{what}: not reported in this model card.</p>;
}

const DIAGNOSTICS: { key: keyof Metrics; label: string; plain: string; lowerIsBetter?: boolean }[] = [
  { key: "prAuc", label: "PR-AUC", plain: "Ranking quality across all thresholds, focused on the rare positive class. Preferred over ROC-AUC when true links are a minority." },
  { key: "rocAuc", label: "ROC-AUC", plain: "Chance a random true link scores above a random non-link. Flatters models when positives are rare." },
  { key: "brier", label: "Brier score", plain: "Mean squared error of the probabilities. 0 is perfect.", lowerIsBetter: true },
  { key: "ece", label: "ECE", plain: "Expected calibration error: the average gap between stated confidence and observed accuracy.", lowerIsBetter: true },
];

/* ---------------- one matching model ---------------- */

function ModelSection({ m }: { m: MatchModel }) {
  const c = m.confusion;
  const testPairs = c ? c.tp + c.fp + c.fn + c.tn : m.bySource.reduce((s, r) => s + (r.n ?? 0), 0) || undefined;
  const autoLinked = c ? c.tp + c.fp : undefined;
  const provs = Array.from(new Set(m.sources.map((s) => s.provenance)));
  const anyReal = provs.some(isRealCustomer);
  const opT = m.operatingPoint?.threshold;
  const sectionId = `model-${m.id}`;

  return (
    <section aria-labelledby={sectionId} className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <H2 id={sectionId}>{m.title}</H2>
          {provs.map((p) => <ProvenanceBadge key={p} p={p} />)}
        </div>
        <p className="mt-1.5 text-sm text-[var(--muted)]">
          {[m.algorithm, m.version ? `version ${m.version}` : null, m.trainedAt ? `trained ${fmtDate(m.trainedAt)}` : null].filter(Boolean).join(" · ") || "Algorithm and version not reported"}
        </p>
      </div>

      {/* plain-English summary */}
      <Box className="border-l-[3px] border-l-[var(--accent)]">
        {m.metrics.precision !== undefined ? (
          <p className="max-w-[72ch] text-[17px] leading-[1.6] text-[var(--ink)]">
            When Satya auto-links ({m.task ? m.task.replaceAll("_", " ") : "this task"}), it was right{" "}
            <strong className="font-semibold">{pct(m.metrics.precision)}</strong> of the time
            {m.metrics.ci?.precision ? <> (95% CI {pct(m.metrics.ci.precision[0])}–{pct(m.metrics.ci.precision[1])})</> : null}
            {testPairs ? <> on {testPairs.toLocaleString("en-IN")} held-out test pairs</> : null}
            {autoLinked !== undefined ? <>, of which it auto-linked {autoLinked.toLocaleString("en-IN")}</> : null}.
            {m.metrics.recall !== undefined ? <> It found {pct(m.metrics.recall)} of the true links; the rest went to a person.</> : null}
          </p>
        ) : (
          <p className="text-[15px] text-[var(--muted)]">Precision at the operating point is not reported for this model.</p>
        )}
        {!anyReal ? (
          <p className="mt-3 max-w-[72ch] text-sm leading-relaxed text-[var(--possible)]">
            Measured on {provs.map((p) => PROVENANCE[p].label.toLowerCase()).join(" and ") || "unlabelled"} data only. This is not real-customer
            accuracy. Real-world performance is unknown until a pilot backtest.
          </p>
        ) : null}
      </Box>

      {/* operating point + headline metrics */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Box>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Operating point</h3>
          {m.operatingPoint ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-[var(--muted)]">Threshold</dt><dd className="tnum text-[var(--ink)]">{dec(opT, 3)}</dd>
              <dt className="text-[var(--muted)]">Target precision</dt><dd className="tnum text-[var(--ink)]">{pct(m.operatingPoint.targetPrecision)}</dd>
              <dt className="text-[var(--muted)]">How it was set</dt><dd className="text-[var(--ink-2)]">{m.operatingPoint.method ?? "not reported"}</dd>
            </dl>
          ) : <NotReported what="Operating point" />}
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--muted)]">
            Scores at or above the threshold become suggested links; everything else goes to review. A person still confirms before any money decision.
          </p>
        </Box>
        <Box>
          <h3 className="text-sm font-semibold text-[var(--ink)]">At the operating point (95% confidence intervals)</h3>
          <div className="mt-4 space-y-3">
            <IntervalRow label="Precision" hint="right when it links" value={m.metrics.precision} ci={m.metrics.ci?.precision} />
            <IntervalRow label="Recall" hint="share of links found" value={m.metrics.recall} ci={m.metrics.ci?.recall} />
            <IntervalRow label="F1" value={m.metrics.f1} ci={m.metrics.ci?.f1} />
          </div>
          {!m.metrics.ci?.precision ? <p className="mt-3 text-xs text-[var(--muted)]">Confidence intervals not reported.</p> : null}
        </Box>
      </div>

      <Box>
        <h3 className="text-sm font-semibold text-[var(--ink)]">Threshold-free diagnostics</h3>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          {DIAGNOSTICS.map((d) => (
            <div key={d.key}>
              <dt className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-[var(--ink-2)]">{d.label}</span>
                <span className="tnum text-base font-semibold text-[var(--ink)]">{dec(m.metrics[d.key] as number | undefined)}</span>
              </dt>
              <dd className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">{d.plain}</dd>
            </div>
          ))}
        </dl>
      </Box>

      <div className="grid gap-4 lg:grid-cols-2">
        <Box>{m.reliability.length ? <ReliabilityDiagram bins={m.reliability} /> : <NotReported what="Reliability diagram" />}</Box>
        <Box>{m.coverageCurve.length ? <CoverageCurve points={m.coverageCurve} threshold={opT} /> : <NotReported what="Coverage curve" />}</Box>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Box>{c ? <ConfusionMatrix c={c} threshold={opT} /> : <NotReported what="Confusion matrix" />}</Box>
        <Box>
          {m.baseline ? (
            <>
              <BaselineCompare
                modelLabel={m.algorithm?.split(/[ (+]/)[0] || "Model"}
                baselineLabel={m.baseline.algorithm?.split(/[ (]/)[0] || "Baseline"}
                rows={[
                  { label: "Precision", model: m.metrics.precision, baseline: m.baseline.metrics.precision },
                  { label: "Recall", model: m.metrics.recall, baseline: m.baseline.metrics.recall },
                  { label: "F1", model: m.metrics.f1, baseline: m.baseline.metrics.f1 },
                  { label: "PR-AUC", model: m.metrics.prAuc, baseline: m.baseline.metrics.prAuc },
                  { label: "Brier", model: m.metrics.brier, baseline: m.baseline.metrics.brier, lowerIsBetter: true },
                  { label: "ECE", model: m.metrics.ece, baseline: m.baseline.metrics.ece, lowerIsBetter: true },
                ]}
              />
              <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
                A simple baseline is kept as a challenger. If it ties the main model, the data or features, not the algorithm, are the limit.
              </p>
            </>
          ) : <NotReported what="Baseline comparison" />}
        </Box>
      </div>

      {/* data */}
      <Box>
        <h3 className="text-sm font-semibold text-[var(--ink)]">Data sources and splits</h3>
        {m.sources.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] border-collapse text-left text-sm">
              <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]"><th scope="col" className="py-2 pr-3 font-medium">Source</th><th scope="col" className="py-2 pr-3 font-medium">Provenance</th><th scope="col" className="py-2 pr-3 text-right font-medium">Pairs</th><th scope="col" className="py-2 text-right font-medium">Groups</th></tr></thead>
              <tbody>
                {m.sources.map((s) => (
                  <tr key={s.name} className="border-b border-[var(--line)] last:border-0">
                    <th scope="row" className="py-2.5 pr-3 font-normal text-[var(--ink)]">{s.name}</th>
                    <td className="py-2.5 pr-3"><ProvenanceBadge p={s.provenance} raw={s.provenanceRaw} /></td>
                    <td className="tnum py-2.5 pr-3 text-right text-[var(--ink-2)]">{s.pairs?.toLocaleString("en-IN") ?? "—"}</td>
                    <td className="tnum py-2.5 text-right text-[var(--ink-2)]">{s.groups?.toLocaleString("en-IN") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <NotReported what="Data sources" />}
        {m.splits ? <p className="mt-3 text-[13px] text-[var(--muted)]">Splits: {m.splits}</p> : null}
      </Box>

      {m.bySource.length ? (
        <Box>
          <h3 className="text-sm font-semibold text-[var(--ink)]">By data source</h3>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Blended numbers hide the hard cases, so each source is reported separately.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm tnum">
              <thead><tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">{["Source", "Provenance", "n", "Precision", "Recall", "F1", "PR-AUC"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {m.bySource.map((s) => (
                  <tr key={s.name} className="border-b border-[var(--line)] last:border-0">
                    <th scope="row" className="py-2.5 pr-3 font-normal text-[var(--ink)]">{s.name}</th>
                    <td className="py-2.5 pr-3"><ProvenanceBadge p={s.provenance} raw={s.provenanceRaw} /></td>
                    <td className="py-2.5 pr-3 text-[var(--ink-2)]">{s.n?.toLocaleString("en-IN") ?? "—"}</td>
                    <td className="py-2.5 pr-3 text-[var(--ink-2)]">{pct(s.metrics.precision)}</td>
                    <td className="py-2.5 pr-3 text-[var(--ink-2)]">{pct(s.metrics.recall)}</td>
                    <td className="py-2.5 pr-3 text-[var(--ink-2)]">{pct(s.metrics.f1)}</td>
                    <td className="py-2.5 text-[var(--ink-2)]">{dec(s.metrics.prAuc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Box>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Intended use</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{m.intendedUse ?? "Not reported."}</p>
          {m.explanations ? <p className="mt-3 text-[13px] text-[var(--muted)]">Explanations: {m.explanations}</p> : null}
        </Box>
        <Box>
          <h3 className="text-sm font-semibold text-[var(--ink)]">Limitations</h3>
          {m.limitations.length ? (
            <ul className="mt-2 space-y-2">
              {m.limitations.map((l) => (
                <li key={l} className="flex gap-2.5 text-[15px] leading-relaxed text-[var(--ink-2)]">
                  <span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-2)]" aria-hidden="true" />{l}
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-[var(--muted)]">No limitations listed. Treat that as a gap in the card, not as an absence of limitations.</p>}
        </Box>
      </div>
    </section>
  );
}

/* ---------------- other components ---------------- */

function KeyValueSummary({ id, title, data, intro }: { id: string; title: string; data: Record<string, unknown>; intro: string }) {
  const rows = flattenSummary(data);
  const prov = typeof data.provenance === "string" ? data.provenance : undefined;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <H2 id={id}>{title}</H2>
        {prov ? <ProvenanceBadge p={toProvenance(prov)} raw={prov} /> : null}
      </div>
      <p className="max-w-[72ch] text-[15px] text-[var(--muted)]">{intro}</p>
      <Box>
        {rows.length ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows.filter((r) => r.key !== "provenance").map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5">
                <dt className="text-[var(--ink-2)]">{r.key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}</dt>
                <dd className="tnum text-right text-[var(--ink)]">{typeof r.value === "number" ? (r.value > 0 && r.value <= 1 && !Number.isInteger(r.value) ? pct(r.value) : r.value.toLocaleString("en-IN")) : r.value}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="text-sm text-[var(--muted)]">No figures reported yet.</p>}
      </Box>
    </section>
  );
}

const COPILOT_METRICS: { key: keyof NonNullable<ModelCard["copilot"]>["metrics"]; label: string }[] = [
  { key: "toolSelectionAccuracy", label: "Tool selection" },
  { key: "numericGroundingRate", label: "Numbers grounded" },
  { key: "citationValidity", label: "Valid citations" },
  { key: "refusalCorrectness", label: "Correct refusals" },
  { key: "injectionResistance", label: "Injection resisted" },
  { key: "answerRate", label: "Answered" },
];

function CopilotSection({ card }: { card: NonNullable<ModelCard["copilot"]> }) {
  const noLlm = /none|deterministic|no llm|template/i.test(`${card.mode ?? ""} ${card.llm ?? ""}`);
  return (
    <section aria-labelledby="copilot" className="space-y-3">
      <H2 id="copilot">Copilot (Ask Satya)</H2>
      <p className="max-w-[72ch] text-[15px] text-[var(--muted)]">
        Scored on a golden question set{card.cases !== undefined ? ` of ${card.cases.toLocaleString("en-IN")} cases` : ""}
        {card.mode ? `, mode: ${card.mode}` : ""}{card.llm ? `, model: ${card.llm}` : ""}
        {card.generatedAt ? `, run ${fmtDate(card.generatedAt)}` : ""}.
        {noLlm ? " This run used the deterministic template pipeline, not a language model, so it says nothing about LLM answer quality." : ""}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Box>
          <BarList title="Evaluation metrics" rows={COPILOT_METRICS.map((m) => ({ label: m.label, value: card.metrics[m.key] }))} />
          <p className="mt-4 text-sm text-[var(--ink-2)] tnum">
            Latency: p50 {card.metrics.p50LatencyMs !== undefined ? `${Math.round(card.metrics.p50LatencyMs)} ms` : "—"} · p95{" "}
            {card.metrics.p95LatencyMs !== undefined ? `${Math.round(card.metrics.p95LatencyMs)} ms` : "—"}
          </p>
        </Box>
        <Box>
          {card.byCategory.length ? (
            <BarList
              title="By question category"
              rows={card.byCategory.map((c) => {
                const v = c.passRate ?? Object.values(c.metrics)[0];
                return { label: c.category.replaceAll("_", " "), value: v, n: c.n };
              })}
            />
          ) : <NotReported what="Per-category results" />}
        </Box>
      </div>
    </section>
  );
}

/* ---------------- page body ---------------- */

const METHOD_REFS = [154, 155, 148, 149, 150, 151, 138, 145, 157];

export function ModelCardView({ variant }: { variant: "app" | "public" }) {
  const { state, reload } = useModelCard();

  if (state.status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="space-y-4">
        <span className="sr-only">Loading model card…</span>
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72 w-full" /><Skeleton className="h-72 w-full" /></div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (state.status === "error" || (state.status === "ready" && isEmptyCard(state.card))) {
    const notYet = state.status === "ready" || state.notYet;
    return (
      <div role={notYet ? "status" : "alert"} className="rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center">
        <FlaskConical size={22} className="mx-auto text-[var(--muted)]" aria-hidden="true" />
        <p className="mt-3 text-[16px] font-medium text-[var(--ink)]">{notYet ? "Model card not available yet" : "We couldn’t load the model card"}</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-[var(--muted)]">
          {state.status === "error" ? state.message : "The evaluation service returned no models."} We only show numbers produced by an evaluation run, so
          this page stays empty rather than showing placeholders.
        </p>
        <button type="button" onClick={() => void reload()} className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-1.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]">
          <RotateCcw size={14} aria-hidden="true" /> Try again
        </button>
        <p className="mt-4 text-xs text-[var(--muted)]">
          Methodology: <Link href="/research#methods" className="text-[var(--accent)] underline">how we evaluate</Link>
        </p>
      </div>
    );
  }

  const card = state.card as ModelCard;
  const refs = card.references.length ? null : REFERENCES.filter((r) => METHOD_REFS.includes(r.n));

  return (
    <div className="space-y-14">
      {state.sample ? (
        <div role="note" className="rounded-[var(--radius-md)] border-2 border-dashed border-[var(--possible)] bg-[var(--possible-soft)] px-5 py-4 text-sm font-medium text-[var(--possible)]">
          Sample data. {SAMPLE_MODEL_CARD_LABEL}. Shown because NEXT_PUBLIC_USE_MOCKS=1.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--muted)]">
        <span>Card generated {fmtDate(card.generatedAt) ?? "(date not reported)"}</span>
        <span>{card.models.length} matching model{card.models.length === 1 ? "" : "s"}</span>
        {variant === "public" ? <span>Read-only public view</span> : null}
        <a href={MODEL_CARD_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-[3px]">Raw JSON</a>
      </div>

      {card.models.map((m) => <ModelSection key={m.id} m={m} />)}

      {card.allocation ? (
        <KeyValueSummary id="allocation" title="Payment allocation" data={card.allocation} intro="Which invoices a payment settles, including TDS-shaped short payments. Reported per payment; ambiguous cases are meant to abstain rather than guess." />
      ) : null}

      {card.extraction && card.extraction.fields.length ? (
        <section aria-labelledby="extraction" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <H2 id="extraction">Document extraction</H2>
            {card.extraction.provenance ? <ProvenanceBadge p={card.extraction.provenance} raw={card.extraction.provenanceRaw} /> : null}
          </div>
          <p className="max-w-[72ch] text-[15px] text-[var(--muted)]">
            Field-level exact match: the extracted value must equal the labelled value exactly. Close is not counted.
            {card.extraction.dataset ? ` Dataset: ${card.extraction.dataset}.` : ""}
          </p>
          <Box>
            <BarList
              title="Exact match by field"
              note={card.extraction.overall !== undefined ? `Overall: ${pct(card.extraction.overall)}` : undefined}
              rows={card.extraction.fields.map((f) => ({ label: f.field, value: f.exactMatch, n: f.n }))}
            />
          </Box>
        </section>
      ) : null}

      {card.anomaly ? (
        <KeyValueSummary id="anomaly" title="Anomaly signals" data={card.anomaly} intro="Anomaly scores rank records for a person to check. They are never shown as proof and never block a payment on their own." />
      ) : null}

      {card.copilot ? <CopilotSection card={card.copilot} /> : (
        <section aria-labelledby="copilot" className="space-y-2">
          <H2 id="copilot">Copilot (Ask Satya)</H2>
          <p className="text-sm text-[var(--muted)]">No copilot evaluation report has been published in this card yet.</p>
        </section>
      )}

      <section aria-labelledby="mc-refs" className="space-y-3">
        <H2 id="mc-refs">References</H2>
        <ol className="space-y-2 text-[14.5px] leading-relaxed text-[var(--ink-2)]">
          {card.references.length
            ? card.references.map((r, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {[r.authors, r.year ? `(${r.year})` : null, r.title, r.venue].filter(Boolean).join(". ")}{" "}
                  {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">Link</a> : null}
                </li>
              ))
            : refs?.map((r) => (
                <li key={r.n} className="[overflow-wrap:anywhere]">
                  {r.text} {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline">Link</a> : null}
                  {r.notReverified ? <span className="ml-2 text-xs text-[var(--muted)]">(not re-verified)</span> : null}
                </li>
              ))}
        </ol>
      </section>
    </div>
  );
}
