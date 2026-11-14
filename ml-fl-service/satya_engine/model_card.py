"""Aggregate committed evaluation artifacts into the public model-card payload.

Reads only files under models/ (never retrains). Shape documented in
models/README.md and served by GET /v2/models/card (server proxies it as the
public GET /api/v2/meta/model-card).
"""
import json
from datetime import datetime, timezone
from functools import lru_cache

from .linking.model import MODELS_DIR

LINK_TASKS = ("link_invoice_po", "link_grn_po", "link_payment_invoice")
REFERENCES = [
    {"title": "A Theory for Record Linkage", "authors": "Fellegi, I. P.; Sunter, A. B.", "venue": "Journal of the American Statistical Association", "year": 1969, "url": "https://doi.org/10.1080/01621459.1969.10501049"},
    {"title": "A Survey of Indexing Techniques for Scalable Record Linkage and Deduplication", "authors": "Christen, P.", "venue": "IEEE TKDE", "year": 2012, "url": "https://doi.org/10.1109/TKDE.2011.127"},
    {"title": "XGBoost: A Scalable Tree Boosting System", "authors": "Chen, T.; Guestrin, C.", "venue": "KDD", "year": 2016, "url": "https://doi.org/10.1145/2939672.2939785"},
    {"title": "From local explanations to global understanding with explainable AI for trees", "authors": "Lundberg, S. M. et al.", "venue": "Nature Machine Intelligence", "year": 2020, "url": "https://doi.org/10.1038/s42256-019-0138-9"},
    {"title": "Predicting Good Probabilities with Supervised Learning", "authors": "Niculescu-Mizil, A.; Caruana, R.", "venue": "ICML", "year": 2005, "url": "https://doi.org/10.1145/1102351.1102430"},
    {"title": "Learn then Test: Calibrating Predictive Algorithms to Achieve Risk Control", "authors": "Angelopoulos, A. N.; Bates, S.; Candès, E. J.; Jordan, M. I.; Lei, L.", "venue": "arXiv:2110.01052", "year": 2021, "url": "https://arxiv.org/abs/2110.01052"},
    {"title": "Conformal Risk Control", "authors": "Angelopoulos, A. N.; Bates, S.; Fisch, A.; Lei, L.; Schuster, T.", "venue": "ICLR", "year": 2024, "url": "https://arxiv.org/abs/2208.02814"},
    {"title": "The Hungarian Method for the Assignment Problem", "authors": "Kuhn, H. W.", "venue": "Naval Research Logistics Quarterly", "year": 1955, "url": "https://doi.org/10.1002/nav.3800020109"},
    {"title": "Subset Sum Matching Problem for financial reconciliation", "authors": "Wu et al. (J.P. Morgan AI Research)", "venue": "ECAI", "year": 2025, "url": "https://arxiv.org/abs/2508.19218"},
    {"title": "Isolation Forest", "authors": "Liu, F. T.; Ting, K. M.; Zhou, Z.-H.", "venue": "ICDM", "year": 2008, "url": "https://doi.org/10.1109/ICDM.2008.17"},
    {"title": "How to Detect and Handle Outliers (modified z-score)", "authors": "Iglewicz, B.; Hoaglin, D. C.", "venue": "ASQC Quality Press", "year": 1993, "url": "https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm"},
    {"title": "Benford's Law and digital analysis for fraud detection (ACFE presentation)", "authors": "Nigrini, M. J.", "venue": "ACFE Global Fraud Conference", "year": 2012, "url": "https://www.fraudconference.com/uploadedFiles/Fraud_Conference/Content/Course-Materials/presentations/23rd/ppt/12E-Mark-Nigrini.pdf"},
    {"title": "BPI Challenge 2019 (event log)", "authors": "van Dongen, B. F.", "venue": "4TU.ResearchData, CC BY 4.0", "year": 2019, "url": "https://research.tue.nl/en/datasets/bpi-challenge-2019/"},
    {"title": "Model Cards for Model Reporting", "authors": "Mitchell, M. et al.", "venue": "FAT*", "year": 2019, "url": "https://arxiv.org/abs/1810.03993"},
    {"title": "Decomposed field confidence for document extraction (business-rule validators)", "authors": "Jin et al.", "venue": "arXiv:2609.20110", "year": 2026, "url": "https://arxiv.org/abs/2609.20110"},
    {"title": "Deep Learning for Entity Matching: A Design Space Exploration", "authors": "Mudgal, S. et al.", "venue": "SIGMOD", "year": 2018, "url": "https://doi.org/10.1145/3183713.3196926"},
]


def _read(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _link_model(task):
    card, ev = _read(MODELS_DIR / task / "model_card.json"), _read(MODELS_DIR / task / "evaluation.json")
    if not card or not ev:
        return None
    test = ev["test"]
    by_source = []
    for s in ev.get("bySource", []):
        by_source.append({"source": s["source"], "provenance": {
            "synthetic": "synthetic", "bpi2019": "BPI-2019 derived", "demo": "demo"}.get(s["source"], s["source"]),
            **{k: s.get(k) for k in ("precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "autoRate",
                                     "suggestRecall", "confusion", "truthLinks")},
            **({"ci": s["ci"]} if s.get("ci") else {}), **({"note": s["note"]} if s.get("note") else {})})
    return {
        "id": card["id"], "task": card["task"], "kind": card.get("kind"), "title": card["title"],
        "version": card["version"], "trainedAt": card["trainedAt"], "algorithm": card["algorithm"],
        "calibration": card["calibrator"]["method"],
        "baseline": card["baseline"],
        "comparison": {k: {"validPrAuc": v["validPrAuc"], "validBrierCalibrated": v["validBrierCalibrated"],
                           "calibrator": v["calibrator"]} for k, v in ev.get("comparison", {}).items()},
        "data": {"sources": [{"name": s["name"], "provenance": s["provenance"], "pairs": s["pairs"], "groups": s["groups"]}
                             for s in card["data"]["sources"]], "splits": card["data"]["splits"],
                 "splitPolicy": card["data"].get("splitPolicy")},
        "operatingPoint": {"threshold": card["operatingPoint"]["threshold"],
                           "reviewThreshold": card["operatingPoint"].get("reviewThreshold"),
                           "targetPrecision": card["operatingPoint"]["targetPrecision"],
                           "delta": card["operatingPoint"].get("delta"),
                           "method": card["operatingPoint"]["method"]},
        "metrics": {k: test.get(k) for k in ("precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece")}
        | {"ci": {"precision": test["ci"]["precision"], "recall": test["ci"]["recall"]},
           "autoRate": test.get("autoRate"), "suggestRecall": test.get("suggestRecall")},
        "reliability": ev.get("reliability", []),
        "coverageCurve": [{"threshold": p["threshold"], "coverage": p["coverage"], "precision": p["precision"]}
                          for p in test.get("coverageCurve", [])],
        "confusion": test["confusion"], "bySource": by_source, "blocking": ev.get("blocking"),
        "featureImportance": ev.get("featureImportance"),
        "explanations": "TreeSHAP" if card["algorithm"] == "xgboost" else card.get("explanations"),
        "limitations": card["limitations"], "intendedUse": card["intendedUse"],
    }


@lru_cache(maxsize=1)
def build():
    copilot = None
    for candidate in (MODELS_DIR.parent.parent / "chatbot-backend" / "eval-report.json",):
        copilot = _read(candidate) if candidate.exists() else None
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "honesty": "All figures come from synthetic, BPI-2019-derived (real process structure, synthetic identities) or "
                   "curated demo data. None is a measurement on a real company's documents.",
        "models": [m for m in (_link_model(t) for t in LINK_TASKS) if m],
        "allocation": _read(MODELS_DIR / "allocation" / "evaluation.json"),
        "extraction": _read(MODELS_DIR / "extraction" / "evaluation.json"),
        "anomaly": _read(MODELS_DIR / "anomaly" / "evaluation.json"),
        "supplierDedupe": _read(MODELS_DIR / "supplier_dedupe" / "evaluation.json"),
        "copilot": copilot,
        "references": REFERENCES,
    }


def status():
    out = []
    for task in LINK_TASKS:
        card = _read(MODELS_DIR / task / "model_card.json")
        if card:
            out.append({"task": task, "version": card["version"], "trainedAt": card["trainedAt"],
                        "algorithm": card["algorithm"], "dataSources": [s["name"] for s in card["data"]["sources"]],
                        "metrics": card["metrics"], "operatingPoint": card["operatingPoint"],
                        "limitations": card["limitations"]})
    return out
