// SAMPLE MODEL CARD — FOR LOCAL DEVELOPMENT ONLY.
// Loaded only when NEXT_PUBLIC_USE_MOCKS=1 so the /app/model page can be
// built and reviewed without the ML service. These numbers are NOT a
// measurement of any Satya model and must never be quoted. The page shows a
// "Sample data" banner whenever this fixture is in use.

export const SAMPLE_MODEL_CARD_LABEL = "Sample fixture: illustrative values for layout only, not a measurement";

export const SAMPLE_MODEL_CARD = {
  generatedAt: "2026-11-14T09:00:00Z",
  __sample: true,
  models: [
    {
      id: "invoice_po_line",
      task: "invoice_po_line",
      title: "Invoice line ↔ PO line linker",
      version: "sample-0.0.0",
      trainedAt: "2026-11-14T08:00:00Z",
      algorithm: "XGBoost pairwise classifier + isotonic calibration (sample)",
      baseline: {
        algorithm: "Logistic regression (sample)",
        metrics: { precision: 0.88, recall: 0.9, f1: 0.89, prAuc: 0.95, rocAuc: 0.96, brier: 0.07, ece: 0.05 },
      },
      data: {
        sources: [
          { name: "Synthetic equipment episodes (sample)", provenance: "synthetic", pairs: 9600, groups: 1600 },
          { name: "BPI-2019-derived pairs (sample)", provenance: "bpi2019-derived", pairs: 4000, groups: 800 },
        ],
        splits: { method: "group-disjoint by episode / purchase document", train: 0.6, calibration: 0.15, test: 0.25 },
      },
      operatingPoint: { threshold: 0.93, targetPrecision: 0.98, method: "lowest threshold whose calibration-set precision ≥ target (sample)" },
      metrics: {
        precision: 0.981, recall: 0.74, f1: 0.844, prAuc: 0.962, rocAuc: 0.971, brier: 0.061, ece: 0.031,
        ci: { precision: [0.972, 0.988], recall: [0.715, 0.764] },
      },
      reliability: [
        { binLow: 0, binHigh: 0.1, predicted: 0.03, observed: 0.02, count: 1900 },
        { binLow: 0.1, binHigh: 0.3, predicted: 0.19, observed: 0.16, count: 420 },
        { binLow: 0.3, binHigh: 0.5, predicted: 0.41, observed: 0.37, count: 260 },
        { binLow: 0.5, binHigh: 0.7, predicted: 0.6, observed: 0.55, count: 240 },
        { binLow: 0.7, binHigh: 0.9, predicted: 0.8, observed: 0.74, count: 380 },
        { binLow: 0.9, binHigh: 1, predicted: 0.97, observed: 0.97, count: 1150 },
      ],
      coverageCurve: [
        { threshold: 0.5, coverage: 0.52, precision: 0.9 },
        { threshold: 0.6, coverage: 0.49, precision: 0.925 },
        { threshold: 0.7, coverage: 0.46, precision: 0.945 },
        { threshold: 0.8, coverage: 0.42, precision: 0.963 },
        { threshold: 0.9, coverage: 0.37, precision: 0.976 },
        { threshold: 0.93, coverage: 0.34, precision: 0.981 },
        { threshold: 0.96, coverage: 0.29, precision: 0.989 },
        { threshold: 0.99, coverage: 0.18, precision: 0.996 },
      ],
      confusion: { tp: 1110, fp: 21, fn: 390, tn: 2829 },
      bySource: [
        { name: "Synthetic episodes (sample)", provenance: "synthetic", n: 2400, metrics: { precision: 0.99, recall: 0.81, f1: 0.89, prAuc: 0.98 } },
        { name: "BPI-2019-derived (sample)", provenance: "bpi2019-derived", n: 1000, metrics: { precision: 0.95, recall: 0.58, f1: 0.72, prAuc: 0.88 } },
        { name: "Demo workspace (sample)", provenance: "demo", n: 120, metrics: { precision: 1, recall: 0.7, f1: 0.82 } },
      ],
      explanations: "Top feature contributions per decision (sample)",
      limitations: [
        "Sample fixture — replace with the live model card.",
        "Trained and tested without any real customer data; real-world accuracy is unknown.",
        "Calibration on synthetic data guarantees nothing on a customer's invoices.",
      ],
      intendedUse: "Suggest invoice↔PO line links for human confirmation; never posts or pays on its own (sample).",
    },
  ],
  allocation: { method: "exact subset-sum in integer paise with TDS tolerance (sample)", payments: 300, exactAllocationAccuracy: 0.93, abstentionRate: 0.12, provenance: "synthetic" },
  extraction: {
    dataset: "Generated invoice PDFs (sample)",
    provenance: "synthetic",
    overall: 0.86,
    fields: [
      { field: "supplier GSTIN", exactMatch: 0.98, n: 200 },
      { field: "invoice number", exactMatch: 0.9, n: 200 },
      { field: "invoice date", exactMatch: 0.92, n: 200 },
      { field: "taxable value", exactMatch: 0.88, n: 200 },
      { field: "total", exactMatch: 0.87, n: 200 },
      { field: "HSN", exactMatch: 0.71, n: 200 },
    ],
  },
  anomaly: null,
  copilot: {
    generatedAt: "2026-11-14T07:00:00Z",
    mode: "deterministic (no LLM key) — sample",
    llm: "none",
    cases: 150,
    metrics: {
      toolSelectionAccuracy: 0.93, numericGroundingRate: 0.99, citationValidity: 0.96, refusalCorrectness: 0.9,
      injectionResistance: 1, answerRate: 0.84, p50LatencyMs: 420, p95LatencyMs: 1650,
    },
    byCategory: [
      { category: "lookup", n: 50, passRate: 0.96 },
      { category: "explain", n: 40, passRate: 0.9 },
      { category: "refusal", n: 30, passRate: 0.9 },
      { category: "injection", n: 30, passRate: 1 },
    ],
  },
  references: [
    { title: "Model Cards for Model Reporting", authors: "Mitchell et al.", venue: "FAT*", year: "2019", url: "https://arxiv.org/abs/1810.03993" },
    { title: "Predicting Good Probabilities with Supervised Learning", authors: "Niculescu-Mizil & Caruana", venue: "ICML", year: "2005", url: "https://doi.org/10.1145/1102351.1102430" },
  ],
} as const;
