"""Evaluation metrics: ranking, calibration, decision-level and group bootstrap."""
import numpy as np

from .calibration import brier


def ece(p, y, bins=15, equal_mass=False):
    p, y = np.asarray(p, float), np.asarray(y, float)
    if not len(p):
        return None, []
    if equal_mass:
        edges = np.quantile(p, np.linspace(0, 1, bins + 1))
        edges[0], edges[-1] = 0.0, 1.0
    else:
        edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, bins - 1)
    total, rows = 0.0, []
    for b in range(bins):
        mask = idx == b
        if not mask.any():
            continue
        pred, obs = float(p[mask].mean()), float(y[mask].mean())
        total += mask.sum() / len(p) * abs(pred - obs)
        rows.append({"binLow": round(float(edges[b]), 4), "binHigh": round(float(edges[b + 1]), 4),
                     "predicted": round(pred, 4), "observed": round(obs, 4), "count": int(mask.sum())})
    return float(total), rows


def ranking(p, y):
    from sklearn.metrics import average_precision_score, roc_auc_score
    y = np.asarray(y)
    if len(np.unique(y)) < 2:
        return {"prAuc": None, "rocAuc": None}
    return {"prAuc": float(average_precision_score(y, p)), "rocAuc": float(roc_auc_score(y, p))}


def prf(tp, fp, fn):
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    f1 = (2 * precision * recall / (precision + recall)) if precision and recall else (0.0 if precision is not None and recall is not None else None)
    return precision, recall, f1


def wilson(k, n, z=1.96):
    if not n:
        return [None, None]
    phat = k / n
    denom = 1 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    half = z * np.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n)) / denom
    return [round(float(center - half), 4), round(float(center + half), 4)]


def group_bootstrap(groups, stat_fn, reps=1000, seed=0):
    """95% percentile CI resampling whole groups (worlds / vendors)."""
    uniq = sorted(set(groups))
    if len(uniq) < 2:
        return [None, None]
    rng = np.random.default_rng(seed)
    by_group = {}
    for i, g in enumerate(groups):
        by_group.setdefault(g, []).append(i)
    values = []
    for _ in range(reps):
        sample = rng.choice(len(uniq), size=len(uniq), replace=True)
        idx = np.concatenate([by_group[uniq[s]] for s in sample])
        v = stat_fn(idx)
        if v is not None and not np.isnan(v):
            values.append(v)
    if not values:
        return [None, None]
    return [round(float(np.percentile(values, 2.5)), 4), round(float(np.percentile(values, 97.5)), 4)]


def summarize_probs(p, y):
    out = ranking(p, y)
    out["brier"] = brier(p, y)
    e, rel = ece(p, y, 15)
    e_mass, _ = ece(p, y, 15, equal_mass=True)
    out["ece"] = e
    out["eceEqualMass"] = e_mass
    return out, rel
