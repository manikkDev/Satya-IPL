"""Uncertainty sampling — return the most informative open pairs for review.

Ranks scored candidate pairs by closeness to the 0.5 decision boundary; the
reviewer sees the pairs where a label changes the model most.
"""
from .blocking import block
from .candidates import _model_bundle, _score
from .features import features


def suggest_pairs(anchors, pool, task="invoice_po_line", limit=20):
    bundle = _model_bundle(task)
    scored = []
    for anchor in anchors:
        for candidate, _reasons in block(anchor, pool):
            f = features(anchor, candidate, task)
            if bundle:
                import numpy as np
                model, q_hat, keys, _ = bundle
                vec = np.array([[f.get(k) if f.get(k) is not None else 0.0 for k in keys]])
                p = float(model.predict_proba(vec)[0][1])
            else:
                p = _score(f)
            scored.append({"anchorId": anchor.id, "candidateId": candidate.id,
                           "probability": str(round(p, 4)),
                           "informativeness": str(round(1 - abs(p - 0.5) * 2, 4))})
    scored.sort(key=lambda s: -float(s["informativeness"]))
    return {"pairs": scored[:limit], "count": len(scored),
            "note": "Pairs nearest the decision boundary — labels here move the model most"}
