"""Evaluation report — real metrics on generated labelled pairs.

Computed on demand from a fixed seed so the /research page always reflects
the current code + generator, never a stale hand-run.
"""
import numpy as np

from .data.generator import generate
from .match.blocking import block
from .match.features import features
from .match.pairs import LINK_TO_TASK, _record, build_pairs


def _records(docs):
    return {d["id"]: _record(d) for d in docs}


def blocking_recall(docs, links, task="invoice_po_line"):
    """Fraction of true CONFIRMED links admitted by the blocker."""
    by_id = _records(docs)
    kind = next(k for k, v in LINK_TO_TASK.items() if v == task)
    positives = [(l["fromId"], l["toId"]) for l in links
                 if l["kind"] == kind and l["certainty"] == "CONFIRMED"]
    if not positives:
        return {"recall": None, "positives": 0, "note": "no positives in split"}
    pool = list(by_id.values())
    hit = 0
    for from_id, to_id in positives:
        anchor, candidate = by_id.get(from_id), by_id.get(to_id)
        if anchor is None or candidate is None:
            continue
        kept = {c.id for c, _ in block(anchor, pool)}
        hit += candidate.id in kept
    total = len(positives)
    return {"recall": round(hit / total, 4) if total else None,
            "positives": total, "admitted": hit}


def model_metrics(task="invoice_po_line", seed=42, n_pos=60):
    """PR-AUC, conformal coverage + set size on a holdout of generated pairs."""
    import xgboost as xgb
    from sklearn.metrics import average_precision_score

    docs, links, _ = generate(seed=seed, n_pos=n_pos, suppliers=max(6, n_pos // 5))
    X_dicts, y, meta = build_pairs(docs, links, task)
    if len(set(y)) < 2 or sum(y) < 5:
        return {"note": "insufficient labelled pairs for metric", "pairs": len(y)}
    keys = sorted(X_dicts[0].keys())
    X = np.array([[f.get(k) if f.get(k) is not None else 0.0 for k in keys] for f in X_dicts])
    y_arr = np.array(y)
    split = max(1, int(len(y_arr) * 0.8))
    X_tr, X_te, y_tr, y_te = X[:split], X[split:], y_arr[:split], y_arr[split:]
    model = xgb.XGBClassifier(max_depth=4, n_estimators=150, nthread=2,
                              learning_rate=0.1, eval_metric="logloss",
                              random_state=seed)
    model.fit(X_tr, y_tr)
    probs = model.predict_proba(X_te)[:, 1]
    pr_auc = round(float(average_precision_score(y_te, probs)), 4) if len(set(y_te)) > 1 else None
    true_scores = 1 - probs[y_te == 1]
    q_hat = float(np.quantile(true_scores, 0.95)) if len(true_scores) else 0.5
    set_sizes = [int((1 - probs <= q_hat).astype(int)[i]) for i in range(len(probs))]
    coverage = float(np.mean([1 - p <= q_hat for i, p in enumerate(probs) if y_te[i] == 1])) if (y_te == 1).any() else None
    return {"task": task, "pairs": len(y), "holdout": len(y_te),
            "prAuc": pr_auc, "conformalQHat": round(q_hat, 4),
            "conformalCoverage": round(coverage, 4) if coverage is not None else None,
            "avgSetSize": round(float(np.mean(set_sizes)), 3),
            "abstentionRate": round(float(np.mean([s == 0 for s in set_sizes])), 4)}


def report(task="invoice_po_line", seed=42):
    docs, links, labels = generate(seed=seed, n_pos=60, suppliers=12)
    return {
        "generatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "seed": seed,
        "documents": len(docs), "links": len(links), "labels": len(labels),
        "provenance": "CONSTRUCTED_DEMO — synthetic only, not real-world validated",
        "blocking": blocking_recall(docs, links, task),
        "model": model_metrics(task, seed),
        "limitations": [
            "All metrics on generator output — not validated on real data",
            "BPI-2019 lag distributions pending (download blocked)",
            "PR-AUC/splits are group-by-supplier only",
        ],
    }
