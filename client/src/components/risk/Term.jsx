"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Plain-language glossary for the fintech-risk jargon used across the app.
// Keep entries short — one sentence of "what it is" + one of "why it matters".
export const GLOSSARY = {
  "pr-auc":
    "Precision–recall area under curve. On rare-event fraud data (~0.1% positive) it is far more honest than accuracy — a model that never flags anything can still score 99.9% accuracy.",
  "roc-auc":
    "Probability that a random fraudulent transaction ranks above a random legitimate one. Optimistic on imbalanced data — read alongside PR-AUC.",
  "recall@p90":
    "Fraction of fraud caught while keeping precision at ≥90% — i.e. at most 1 in 10 alerts is a false alarm. This is what an operations team actually feels.",
  ece: "Expected calibration error — how far predicted probabilities drift from observed frequencies. Lower is better; <0.01 is well calibrated.",
  secagg:
    "Secure aggregation (SecAgg+). Each bank masks its update with pairwise secret shares; the coordinator can only reconstruct the sum, never an individual bank's update.",
  fedprox:
    "Federated averaging with a proximal term that keeps each bank's local update near the global model — stabilises training when banks have non-IID data.",
  fedadam: "Server-side adaptive optimizer for federated averaging. Disabled under SecAgg+ here because secure aggregation already returns the weighted mean.",
  "non-iid":
    "Non-independent, identically-distributed data — each bank sees a different customer mix, so local datasets are statistically different. The core FL challenge.",
  "dp-epsilon":
    "Differential-privacy budget ε. Smaller = stronger privacy, noisier model. Here: client-side clipping + Gaussian noise, accounted per run (RDP estimate).",
  pseudonymous:
    "Accounts are shown as hashed identifiers (acct_…) — analysts can trace patterns without ever seeing customer names or raw account numbers.",
  "split-nn":
    "Split neural network for vertical FL: each institution trains the 'bottom' of the network on its own features; only embeddings and gradients cross the boundary.",
  psi: "Private set intersection — a cryptographic protocol that finds which customers two institutions share without either revealing its full customer list.",
  pagerank:
    "Graph centrality score computed in Neo4j. Accounts receiving funds from many high-traffic accounts score higher — a fraud-ring signal.",
  snapshot:
    "An immutable, versioned copy of the risk graph tied to a model run. Lets analysts ask 'what did the graph look like when this score was produced?'",
  "in-process":
    "All simulated banks run in one Python process — fast for experiments, but not a privacy boundary. Use the Flower engine for real isolation.",
  "natural-prevalence":
    "Evaluation on the untouched test distribution (~0.13% fraud). Metrics measured here transfer to production; oversampled test metrics do not.",
};

export function Term({ id, children, className = "" }) {
  const text = GLOSSARY[id];
  if (!text) return children || id;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 ${className}`}>
          {children || id}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}
