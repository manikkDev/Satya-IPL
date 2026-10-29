"""Anchor → prediction-set candidate matcher.

Heuristic scorer until per-task XGBoost models land (needs A9 labelled data);
output already follows the conformal prediction-set contract so B/C integrate
once.
"""
from .blocking import block
from .features import contributions, features


def _score(f):
    """Heuristic probability — deterministic, explainable, conservative."""
    if f.get("explicit_ref"):
        return 0.98
    score = 0.0
    score += 0.35 * f.get("ref_similarity", 0)
    score += 0.15 * (f.get("ref_exact") or f.get("ref_prefix") or 0)
    score += 0.10 * f.get("party_same", 0)
    score += 0.30 * f.get("amount_ratio", 0)
    score += 0.10 * f.get("hsn_agree", 0)
    score += 0.05 * f.get("desc_token_set", 0)
    if f.get("spec_conflict"):
        score *= 0.2
    return round(min(score, 0.97), 4)


def _certainty(probability, set_size):
    if set_size == 0:
        return "INSUFFICIENT_EVIDENCE"
    if set_size == 1:
        return "PROBABLE" if probability >= 0.9 else "POSSIBLE"
    return "AMBIGUOUS"


def candidates(request, alpha=0.05, threshold=0.4):
    """Return {anchorId → predictionSet, certainty, abstainReason}."""
    results = []
    for anchor in request.anchors:
        scored = []
        for candidate, _reasons in block(anchor, request.pool):
            f = features(anchor, candidate, request.task)
            p = _score(f)
            if p >= threshold:
                scored.append({
                    "candidateId": candidate.id,
                    "probability": str(p),
                    "contributions": contributions(f),
                })
        scored.sort(key=lambda s: -float(s["probability"]))
        set_size = len(scored)
        top_p = float(scored[0]["probability"]) if scored else 0.0
        results.append({
            "anchorId": anchor.id,
            "predictionSet": scored,
            "certainty": _certainty(top_p, set_size),
            **({"abstainReason": "no candidate above threshold"} if set_size == 0 else {}),
        })
    return {"results": results, "modelVersion": "heuristic-v2",
            "method": "deterministic_features+heuristic_score (conformal-set shape)"}
