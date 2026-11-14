// Types + a defensive normaliser for the public model card served at
// GET {NEXT_PUBLIC_GRAPH_API_URL}/api/v2/meta/model-card. The endpoint is
// built by a separate service and may be partial, so every field is optional
// here and the normaliser drops anything that is not the expected shape
// instead of throwing. Nothing on the page is ever invented to fill a gap.

export type Provenance = "synthetic" | "bpi2019" | "demo" | "public_benchmark" | "backtest" | "shadow" | "live" | "unknown";

export type Interval = [number, number];

export type SourceRow = {
  name: string;
  provenance: Provenance;
  provenanceRaw?: string;
  pairs?: number;
  groups?: number;
};

export type Metrics = {
  precision?: number;
  recall?: number;
  f1?: number;
  prAuc?: number;
  rocAuc?: number;
  brier?: number;
  ece?: number;
  ci?: { precision?: Interval; recall?: Interval; f1?: Interval };
};

export type ReliabilityBin = { binLow: number; binHigh: number; predicted: number; observed: number; count: number };
export type CoveragePoint = { threshold: number; coverage: number; precision: number };
export type Confusion = { tp: number; fp: number; fn: number; tn: number };

export type BySourceRow = {
  name: string;
  provenance: Provenance;
  provenanceRaw?: string;
  n?: number;
  metrics: Metrics;
};

export type MatchModel = {
  id: string;
  task?: string;
  title: string;
  version?: string;
  trainedAt?: string;
  algorithm?: string;
  baseline?: { algorithm?: string; metrics: Metrics };
  sources: SourceRow[];
  splits?: string;
  operatingPoint?: { threshold?: number; targetPrecision?: number; method?: string };
  metrics: Metrics;
  reliability: ReliabilityBin[];
  coverageCurve: CoveragePoint[];
  confusion?: Confusion;
  bySource: BySourceRow[];
  explanations?: string;
  limitations: string[];
  intendedUse?: string;
};

export type ExtractionField = { field: string; exactMatch: number; n?: number };

export type CopilotMetrics = {
  toolSelectionAccuracy?: number;
  numericGroundingRate?: number;
  citationValidity?: number;
  refusalCorrectness?: number;
  injectionResistance?: number;
  answerRate?: number;
  p50LatencyMs?: number;
  p95LatencyMs?: number;
};

export type CopilotCard = {
  generatedAt?: string;
  mode?: string;
  llm?: string;
  cases?: number;
  metrics: CopilotMetrics;
  byCategory: { category: string; n?: number; passRate?: number; metrics: Record<string, number> }[];
};

export type CardReference = { title: string; authors?: string; venue?: string; year?: string; url?: string };

export type ModelCard = {
  generatedAt?: string;
  models: MatchModel[];
  allocation?: Record<string, unknown>;
  extraction?: { fields: ExtractionField[]; overall?: number; dataset?: string; provenance?: Provenance; provenanceRaw?: string };
  anomaly?: Record<string, unknown>;
  copilot: CopilotCard | null;
  references: CardReference[];
};

/* ---------------- guards ---------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function interval(v: unknown): Interval | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const lo = num(v[0]);
  const hi = num(v[1]);
  return lo !== undefined && hi !== undefined ? [lo, hi] : undefined;
}

/** Map whatever label the service sends to one of our honest badges. */
export function toProvenance(raw: unknown): Provenance {
  const s = String(raw ?? "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("bpi")) return "bpi2019";
  if (s.includes("synth") || s.includes("constructed") || s.includes("generated")) return "synthetic";
  if (s.includes("demo") || s.includes("seed") || s.includes("fixture")) return "demo";
  if (s.includes("backtest") || s.includes("historical")) return "backtest";
  if (s.includes("shadow")) return "shadow";
  if (s.includes("live") || s.includes("audit")) return "live";
  if (s.includes("benchmark") || s.includes("public")) return "public_benchmark";
  return "unknown";
}

function metrics(v: unknown): Metrics {
  if (!isObj(v)) return {};
  const ci = isObj(v.ci) ? { precision: interval(v.ci.precision), recall: interval(v.ci.recall), f1: interval(v.ci.f1) } : undefined;
  return {
    precision: num(v.precision),
    recall: num(v.recall),
    f1: num(v.f1),
    prAuc: num(v.prAuc ?? v.pr_auc),
    rocAuc: num(v.rocAuc ?? v.roc_auc),
    brier: num(v.brier),
    ece: num(v.ece),
    ci,
  };
}

function model(v: unknown, index: number): MatchModel | null {
  if (!isObj(v)) return null;
  const data = isObj(v.data) ? v.data : {};
  const op = isObj(v.operatingPoint) ? v.operatingPoint : undefined;
  const conf = isObj(v.confusion) ? v.confusion : undefined;
  const confusion =
    conf && [conf.tp, conf.fp, conf.fn, conf.tn].every((x) => num(x) !== undefined)
      ? { tp: conf.tp as number, fp: conf.fp as number, fn: conf.fn as number, tn: conf.tn as number }
      : undefined;
  return {
    id: str(v.id) ?? `model-${index}`,
    task: str(v.task),
    title: str(v.title) ?? str(v.task) ?? `Model ${index + 1}`,
    version: str(v.version),
    trainedAt: str(v.trainedAt),
    algorithm: str(v.algorithm),
    baseline: isObj(v.baseline) ? { algorithm: str(v.baseline.algorithm), metrics: metrics(v.baseline.metrics) } : undefined,
    sources: arr(data.sources)
      .filter(isObj)
      .map((s) => ({ name: str(s.name) ?? "Unnamed source", provenance: toProvenance(s.provenance ?? s.name), provenanceRaw: str(s.provenance), pairs: num(s.pairs), groups: num(s.groups) })),
    splits: isObj(data.splits) ? Object.entries(data.splits).map(([k, val]) => `${k} ${typeof val === "object" ? JSON.stringify(val) : String(val)}`).join(" · ") : str(data.splits),
    operatingPoint: op ? { threshold: num(op.threshold), targetPrecision: num(op.targetPrecision), method: str(op.method) } : undefined,
    metrics: metrics(v.metrics),
    reliability: arr(v.reliability)
      .filter(isObj)
      .map((b) => ({ binLow: num(b.binLow), binHigh: num(b.binHigh), predicted: num(b.predicted), observed: num(b.observed), count: num(b.count) ?? 0 }))
      .filter((b): b is ReliabilityBin => b.binLow !== undefined && b.binHigh !== undefined && b.predicted !== undefined && b.observed !== undefined),
    coverageCurve: arr(v.coverageCurve)
      .filter(isObj)
      .map((p) => ({ threshold: num(p.threshold), coverage: num(p.coverage), precision: num(p.precision) }))
      .filter((p): p is CoveragePoint => p.threshold !== undefined && p.coverage !== undefined && p.precision !== undefined),
    confusion,
    bySource: arr(v.bySource)
      .filter(isObj)
      .map((s) => ({
        name: str(s.name ?? s.source) ?? "Unnamed",
        provenance: toProvenance(s.provenance ?? s.name ?? s.source),
        provenanceRaw: str(s.provenance),
        n: num(s.n ?? s.pairs),
        metrics: metrics(isObj(s.metrics) ? s.metrics : s),
      })),
    explanations: typeof v.explanations === "string" ? v.explanations : isObj(v.explanations) ? str(v.explanations.method) ?? str(v.explanations.summary) : undefined,
    limitations: arr(v.limitations).map(str).filter((x): x is string => Boolean(x)),
    intendedUse: str(v.intendedUse),
  };
}

function copilot(v: unknown): CopilotCard | null {
  if (!isObj(v)) return null;
  const m = isObj(v.metrics) ? v.metrics : {};
  const byCat = isObj(v.byCategory)
    ? Object.entries(v.byCategory).map(([category, val]) => ({ category, ...catRow(val) }))
    : arr(v.byCategory).filter(isObj).map((row) => ({ category: str(row.category ?? row.name) ?? "Other", ...catRow(row) }));
  return {
    generatedAt: str(v.generatedAt),
    mode: str(v.mode),
    llm: str(v.llm),
    cases: num(v.cases) ?? (Array.isArray(v.cases) ? v.cases.length : undefined),
    metrics: {
      toolSelectionAccuracy: num(m.toolSelectionAccuracy),
      numericGroundingRate: num(m.numericGroundingRate),
      citationValidity: num(m.citationValidity),
      refusalCorrectness: num(m.refusalCorrectness),
      injectionResistance: num(m.injectionResistance),
      answerRate: num(m.answerRate),
      p50LatencyMs: num(m.p50LatencyMs),
      p95LatencyMs: num(m.p95LatencyMs),
    },
    byCategory: byCat,
  };
}

function catRow(val: unknown): { n?: number; passRate?: number; metrics: Record<string, number> } {
  if (typeof val === "number") return { passRate: val, metrics: {} };
  if (!isObj(val)) return { metrics: {} };
  const metricsOut: Record<string, number> = {};
  for (const [k, x] of Object.entries(val)) {
    if (k === "n" || k === "cases" || k === "passRate") continue;
    const value = num(x);
    if (value !== undefined) metricsOut[k] = value;
  }
  return { n: num(val.n ?? val.cases), passRate: num(val.passRate), metrics: metricsOut };
}

export function normalizeModelCard(raw: unknown): ModelCard | null {
  if (!isObj(raw)) return null;
  const extraction = isObj(raw.extraction)
    ? {
        fields: arr(raw.extraction.fields)
          .filter(isObj)
          .map((f) => ({ field: str(f.field) ?? "field", exactMatch: num(f.exactMatch) ?? NaN, n: num(f.n) }))
          .filter((f) => Number.isFinite(f.exactMatch)),
        overall: num(raw.extraction.overall) ?? (isObj(raw.extraction.overall) ? num(raw.extraction.overall.exactMatch) : undefined),
        dataset: str(raw.extraction.dataset) ?? (isObj(raw.extraction.dataset) ? str(raw.extraction.dataset.name) : undefined),
        provenance: toProvenance(raw.extraction.provenance ?? (isObj(raw.extraction.dataset) ? raw.extraction.dataset.provenance : raw.extraction.dataset)),
        provenanceRaw: str(raw.extraction.provenance),
      }
    : undefined;
  return {
    generatedAt: str(raw.generatedAt),
    models: arr(raw.models).map(model).filter((m): m is MatchModel => m !== null),
    allocation: isObj(raw.allocation) ? raw.allocation : undefined,
    extraction,
    anomaly: isObj(raw.anomaly) ? raw.anomaly : undefined,
    copilot: copilot(raw.copilot),
    references: arr(raw.references)
      .filter(isObj)
      .map((r) => ({ title: str(r.title) ?? "Untitled", authors: str(r.authors), venue: str(r.venue), year: str(r.year), url: str(r.url) })),
  };
}

export function isEmptyCard(card: ModelCard | null): boolean {
  if (!card) return true;
  return card.models.length === 0 && !card.extraction?.fields.length && !card.copilot && !card.allocation && !card.anomaly;
}

/** Flatten an unknown summary object (allocation/anomaly) into label/value rows. */
export function flattenSummary(v: Record<string, unknown> | undefined, prefix = ""): { key: string; value: string | number }[] {
  if (!v) return [];
  const rows: { key: string; value: string | number }[] = [];
  for (const [k, val] of Object.entries(v)) {
    const key = prefix ? `${prefix} · ${k}` : k;
    if (typeof val === "number" && Number.isFinite(val)) rows.push({ key, value: val });
    else if (typeof val === "string") rows.push({ key, value: val });
    else if (isObj(val) && prefix.split(" · ").length < 2) rows.push(...flattenSummary(val, key));
  }
  return rows.slice(0, 40);
}
