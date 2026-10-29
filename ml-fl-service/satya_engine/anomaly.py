"""Price/amount anomaly scoring — robust z-score against a history baseline.

Baseline: median ± MAD on the same item/hsn cohort. A score >3 is unusual;
history of <4 observations returns an honest 'insufficient_baseline' instead
of an invented z.
"""
from decimal import Decimal
from statistics import median

D = Decimal
MIN_BASELINE = 4


def _key(record):
    return record.hsn or (record.specs or {}).get("sku") or record.description


def _rate(record):
    if record.amount is not None and record.qty is not None and D(record.qty) != 0:
        return D(record.amount.amount) / D(record.qty)
    return None


def _cohort(history):
    groups = {}
    for record in history:
        rate = _rate(record)
        if rate is None:
            continue
        groups.setdefault(_key(record), []).append(rate)
    return groups


def score(request):
    cohorts = _cohort(request.history)
    results = []
    for record in request.documents:
        rate = _rate(record)
        key = _key(record)
        baseline_rates = cohorts.get(key, [])
        entry = {"documentId": record.id, "lineNo": None,
                 "method": "robust_z", "baseline": None, "score": None, "explanation": None}
        if rate is None:
            entry["explanation"] = "no computable unit rate"
        elif len(baseline_rates) < MIN_BASELINE:
            entry["explanation"] = f"insufficient baseline ({len(baseline_rates)} observations for {key})"
        else:
            med = median(baseline_rates)
            mad = median([abs(r - med) for r in baseline_rates])
            if mad == 0:
                z = D("0") if rate == med else D("10")
            else:
                z = D(abs(rate - med) / (D("1.4826") * D(str(mad)))).quantize(D("0.01"))
            entry.update({"score": str(z), "baseline": str(D(str(med)).quantize(D("0.01"))),
                          "explanation": f"rate {rate:.4f} vs median {med:.4f} (MAD-scaled z={z}) for cohort {key}"})
        results.append(entry)
    return {"scores": results}


def isolation_forest_scores(request):
    """Invoice-level IsolationForest — needs ≥50 history records to fit."""
    import math
    import numpy as np
    from datetime import datetime
    from sklearn.ensemble import IsolationForest

    if len(request.history) < 50:
        return {"scores": [{"documentId": d.id, "lineNo": None, "method": "isolation_forest",
                            "baseline": None, "score": None,
                            "explanation": f"insufficient history ({len(request.history)} records, need 50)"}
                           for d in request.documents]}

    def vec(r):
        amount = float(r.amount.amount) if r.amount else 0.0
        qty = float(r.qty) if r.qty else 1.0
        rate = amount / qty if qty else 0.0
        try:
            dow = datetime.fromisoformat(r.date).weekday() if r.date else 0
        except (ValueError, TypeError):
            dow = 0
        return [math.log1p(amount), 1.0, 0.0, rate, 1.0 if amount == int(amount) else 0.0,
                1.0 if dow >= 5 else 0.0]

    model = IsolationForest(n_estimators=200, contamination="auto", n_jobs=2, random_state=42)
    model.fit(np.array([vec(r) for r in request.history]))
    return {"scores": [{"documentId": d.id, "lineNo": None, "method": "isolation_forest",
                        "baseline": f"trained on {len(request.history)} history records",
                        "score": str(round(float(-model.score_samples(np.array([vec(d)]))[0]), 4)),
                        "explanation": "higher = more anomalous vs fitted invoice population"}
                       for d in request.documents]}
