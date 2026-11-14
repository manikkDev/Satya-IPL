# Satya model artifacts and the public model card

Everything under `models/` is committed and copied into the engine image
(`COPY models ./models` in the Dockerfile). The runtime never trains. To
retrain, run the commands below and commit the regenerated files.

| Directory | Files | Producer |
|---|---|---|
| `link_invoice_po/` | `model.json` (XGBoost), `model_card.json`, `evaluation.json` | `python -m satya_engine.linking.train` |
| `link_grn_po/` | same | same |
| `link_payment_invoice/` | same | same |
| `allocation/` | `evaluation.json` | `python -m satya_engine.recon.allocation_eval` |
| `anomaly/` | `evaluation.json` | `python -m satya_engine.screening_eval` |
| `supplier_dedupe/` | `evaluation.json` | `python -m satya_engine.screening_eval` |
| `extraction/` | `evaluation.json` | `python -m satya_engine.data.einvoice_eval all` |

Run training in the engine image with offline extras. Use `PYTHONHASHSEED=0` so runs are reproducible.

```sh
docker build -t satya-engine-test:local --target test ml-fl-service
# plus requirements-train.txt (reportlab, qrcode) for the extraction eval set
docker run --rm -e PYTHONHASHSEED=0 -v "$PWD/ml-fl-service":/app -w /app <image> python -m satya_engine.linking.train
```

The training data is either committed or regenerated from a seed:

- `data/linking/bpi2019_p2p_events.json.gz` is a compact extract of the real BPI Challenge 2019 log (CC BY 4.0). Regenerate it with `satya_engine.linking.datasets.bpi.extract()` from `data/raw/bpi2019-random.xml`.
- `data/linking/demo_holdout.json` is the curated demo dataset. It is a held-out set and is never used for fitting.
- The synthetic worlds are regenerated from a seed.

## Provenance labels (used everywhere)

- **synthetic**: seeded generator. Use it as an upper bound or regression test only.
- **BPI-2019 derived**: the transaction structure is real. That covers which items belong to which purchase orders, goods-receipt and invoice-receipt counts and timing, and which invoices were cleared together. Identities, document numbers, GST/TDS and quantities are synthetic.
- **demo**: the curated demo world. It is held out and used as a sanity check only.

None of these figures is a real-company accuracy claim.

## Methods

- **Linking**
  - **Candidate blocking:** union of blocks on party key (GSTIN/PAN/supplierId/phonetic name), printed reference, and amount or TDS window (Christen 2012). Pair completeness and reduction ratio are reported.
  - **Model selection:** logistic regression, XGBoost (monotone constraints) and HistGradientBoosting are compared on a group-disjoint validation split. The rule is the best validation PR-AUC among the deployable models. Logistic regression and XGBoost are deployable because they have exact per-decision attributions; HistGB is a challenger only.
  - **Calibration:** Platt vs isotonic, chosen by grouped CV Brier on the validation split.
  - **Thresholds:** see the next section.
  - **Explanations:** TreeSHAP (`pred_contribs`) mapped to plain-English reasons.
- **Thresholds**
  - The **auto** threshold comes from Learn-then-Test (conformal risk control; Angelopoulos et al. 2021). On the calibration split, fixed-sequence exact binomial tests certify auto-decision precision ≥ 0.99 with δ = 0.05.
  - The thresholds certify the *deployed decision rule*:
    - invoices and GRNs: top-1 candidate plus an ambiguity margin of 0.10;
    - payments: the smallest amount-consistent invoice set.
  - The guarantee needs exchangeability, so it must be re-certified on each tenant's reviewed links.
  - The **review** threshold is the split-conformal 2% quantile of true-link scores, floored at 0.05.
- **Allocation:** score-then-solve.
  - Exact paise subset search with these modes: exact, policy TDS, 0.1/1/2% TDS on taxable value, and bank charges up to a configurable limit.
  - Ambiguity margin: when the runner-up is too close, the result goes to review.
  - Batch endpoint: Hungarian matching for 1:1, then a MILP (HiGHS) for N:M.
- **Anomaly screening:**
  - modified z-score with an Isolation Forest above 50 observations (price);
  - just-below-approval-limit invoice series;
  - a Benford supplier-FY screen;
  - first payment to a new bank account.
  - All screening output is low/medium severity with POSSIBLE certainty, and it never drives the case recommendation.
- **Supplier dedupe:** Fellegi–Sunter weights from documented priors, then union-find.
  - Same PAN with GSTINs in other states is treated as a branch, not a duplicate.
  - EM re-estimation was measured. It is off by default because it converges to a "similar name" class.

## `GET /api/v2/meta/model-card` (public, read-only)

The server (`server/src/routes/v2/modelCard.js`) proxies the engine's `GET /v2/models/card` and caches it for 10 minutes. Treat this shape as stable; only add keys.

```jsonc
{
  "generatedAt": "ISO-8601",
  "honesty": "string — provenance disclaimer to show verbatim",
  "models": [{
    "id": "link_invoice_po", "task": "link_invoice_po", "kind": "BILLS",
    "title": "Invoice → PO linker", "version": "link_invoice_po-YYYYMMDD", "trainedAt": "ISO",
    "algorithm": "xgboost", "calibration": "platt|isotonic",
    "baseline": { "algorithm": "logistic_regression",
                  "metrics": { "precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "autoRate" } },
    "comparison": { "<algorithm>": { "validPrAuc", "validBrierCalibrated", "calibrator" } },
    "data": { "sources": [{ "name": "synthetic|bpi2019|demo", "provenance": "string", "pairs": 0, "groups": 0 }],
              "splits": { "train|valid|calib|test|holdout": { "pairs", "groups", "positives" } }, "splitPolicy": "string" },
    "operatingPoint": { "threshold": 0.0, "reviewThreshold": 0.0, "targetPrecision": 0.99, "delta": 0.05, "method": "string" },
    "metrics": { "precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece",
                 "ci": { "precision": [lo, hi], "recall": [lo, hi] }, "autoRate", "suggestRecall" },
    "reliability": [{ "binLow", "binHigh", "predicted", "observed", "count" }],   // 15 equal-width bins, test split
    "coverageCurve": [{ "threshold", "coverage", "precision" }],                    // coverage = auto-decided / linkable docs
    "confusion": { "tp", "fp", "fn", "tn" },                                        // pair level at the operating point
    "bySource": [{ "source", "provenance", "precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece",
                   "autoRate", "suggestRecall", "confusion", "truthLinks", "ci?", "note?" }],
    "blocking": { "<source>": { "pairCompleteness", "reductionRatio", "truePairs", "candidatePairs" } },
    "featureImportance": [{ "feature", "gainShare" }],
    "explanations": "TreeSHAP", "limitations": ["string"], "intendedUse": "string"
  }],
  "allocation": { "overall": { "exactAllocationAccuracy", "autoRate", "autoPrecision", "autoPrecisionWilson95",
                               "abstentionRate", "latencyMsP95", "legacy": {...} }, "bySource": [...], "protocol", "limitations" },
  "extraction": { "fields": [{ "field", "exactMatch", "n" }], "overall", "dataset": {...}, "byMethod": {...},
                  "documentAllCriticalCorrect", "confidence": {...}, "limitations": [...] },
  "anomaly": { "typologies": [{ "code", "recall", "precisionAtFlags", "precisionWilson95", "flags", "injected" }],
               "cleanWorldFlagsPer1000Docs", "policy", "limitations" },
  "supplierDedupe": { "duplicateZone": { "precision", "recall" }, "duplicateOrPossible": {...}, "branchDetection": {...}, "emVariant": {...} },
  "copilot": null,            // contents of chatbot-backend/eval-report.json when readable, else null
  "references": [{ "title", "authors", "venue", "year", "url" }]
}
```

Notes for the UI:

- Precision and recall are decision-level, at the auto threshold.
  - Recall = auto-linked true links / all true links in the test worlds.
  - Blocking misses count as false negatives.
- `confidence` values in allocation are relative plausibility among feasible allocations. They are not calibrated probabilities.
- On the demo source, `ci` is absent because it is a single world.
