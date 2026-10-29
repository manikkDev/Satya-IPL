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
