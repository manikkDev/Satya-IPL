"""Calibration (Platt / isotonic), decision thresholds and their guarantees.

Auto-link threshold: Learn-then-Test (Angelopoulos, Bates, Candes, Jordan &
Lei 2021) - a conformal risk-control procedure. For a fixed, label-free
sequence of candidate thresholds lambda_1 > lambda_2 > ..., test
H0_j: FDR(lambda_j) > alpha with the exact binomial p-value
P(Bin(n_j, alpha) <= k_j) (n_j auto-decisions, k_j wrong) and walk down the
sequence (fixed-sequence testing, FWER <= delta) while H0 is rejected. The
smallest rejected lambda is deployed. With probability >= 1 - delta over the
calibration draw, precision of the auto set >= 1 - alpha - *if deployment
data are exchangeable with calibration data* (they are not when calibration
is synthetic / BPI-derived; see model card limitations).

Review threshold: split-conformal quantile of the calibrated scores of true
links, so that >= 1 - alpha_review of true links score at or above it
(marginal guarantee, same exchangeability caveat).
"""
import math

import numpy as np


def platt_fit(margin, y):
    from sklearn.linear_model import LogisticRegression
    lr = LogisticRegression(C=1e6, max_iter=1000)
    lr.fit(np.asarray(margin).reshape(-1, 1), np.asarray(y))
    return {"method": "platt", "a": float(lr.coef_[0][0]), "b": float(lr.intercept_[0])}


def isotonic_fit(margin, y):
    from sklearn.isotonic import IsotonicRegression
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(np.asarray(margin), np.asarray(y))
    return {"method": "isotonic", "x": [float(v) for v in iso.X_thresholds_],
            "y": [float(v) for v in iso.y_thresholds_]}


def apply(calibrator, margin):
    margin = np.asarray(margin, dtype=float)
    if calibrator["method"] == "platt":
        z = calibrator["a"] * margin + calibrator["b"]
        return 1.0 / (1.0 + np.exp(-z))
    return np.interp(margin, calibrator["x"], calibrator["y"])


def brier(p, y):
    p, y = np.asarray(p, float), np.asarray(y, float)
    return float(np.mean((p - y) ** 2)) if len(p) else None


def log_loss(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def choose_calibrator(margin, y, groups, folds=5, seed=0):
    """Group-k-fold CV on the calibration-selection split: Platt vs isotonic by
    out-of-fold Brier (log-loss tie-break). Isotonic usually wins past ~1k
    labels (Niculescu-Mizil & Caruana 2005); Platt is safer when small."""
    margin, y, groups = np.asarray(margin), np.asarray(y), np.asarray(groups)
    uniq = np.unique(groups)
    rng = np.random.default_rng(seed)
    rng.shuffle(uniq)
    fold_of = {g: i % folds for i, g in enumerate(uniq)}
    fid = np.array([fold_of[g] for g in groups])
    scores = {}
    for name, fit in (("platt", platt_fit), ("isotonic", isotonic_fit)):
        oof = np.zeros(len(y))
        for k in range(folds):
            tr, te = fid != k, fid == k
            if te.sum() == 0 or len(np.unique(y[tr])) < 2:
                oof[te] = y[tr].mean() if tr.any() else 0.5
                continue
            oof[te] = apply(fit(margin[tr], y[tr]), margin[te])
        scores[name] = {"brier": brier(oof, y), "logLoss": log_loss(oof, y)}
    best = min(scores, key=lambda k: (round(scores[k]["brier"], 5), scores[k]["logLoss"]))
    fitted = (platt_fit if best == "platt" else isotonic_fit)(margin, y)
    return fitted, scores


def binom_cdf(k, n, p):
    from scipy.stats import binom
    return float(binom.cdf(k, n, p))


def min_n_for(alpha, delta):
    """Smallest n with zero errors that can certify precision >= 1-alpha."""
    return int(math.ceil(math.log(delta) / math.log(1 - alpha)))


def ltt_threshold(scores, wrong, alpha=0.01, delta=0.05, grid=60, min_threshold=0.5):
    """Learn-then-Test fixed-sequence threshold.

    scores: calibrated probability of each auto-decision candidate;
    wrong: 1 when accepting that candidate would be a false link.
    Returns dict with threshold (None if nothing certifiable) and the trace.
    """
    scores, wrong = np.asarray(scores, float), np.asarray(wrong, int)
    order = np.argsort(-scores)
    s_sorted, w_sorted = scores[order], wrong[order]
    n_min = min_n_for(alpha, delta)
    if len(scores) < n_min:
        return {"threshold": None, "reason": f"need >= {n_min} calibration decisions, have {len(scores)}",
                "alpha": alpha, "delta": delta, "trace": []}
    # label-free candidate grid: thresholds at accept-counts n_min .. N
    # restricted to lambda >= min_threshold (policy: never auto-link a pair the
    # calibrated model thinks is more likely wrong than right); the sequence
    # is still fixed before looking at labels, so validity is unchanged.
    eligible = int((s_sorted >= min_threshold).sum())
    if eligible < n_min:
        return {"threshold": None, "reason": f"only {eligible} calibration decisions score >= {min_threshold}; need {n_min}",
                "alpha": alpha, "delta": delta, "trace": []}
    counts = np.unique(np.linspace(n_min, eligible, grid).astype(int))
    trace, chosen = [], None
    for n in counts:
        lam = float(s_sorted[n - 1])
        accepted = scores >= lam
        n_acc, k = int(accepted.sum()), int(wrong[accepted].sum())
        pval = binom_cdf(k, n_acc, alpha)
        trace.append({"threshold": round(lam, 6), "accepted": n_acc, "wrong": k, "pValue": pval})
        if pval > delta:
            break
        chosen = {"threshold": lam, "accepted": n_acc, "wrong": k, "pValue": pval}
    return {"threshold": None if chosen is None else chosen["threshold"], "certified": chosen,
            "alpha": alpha, "delta": delta, "nMin": n_min, "trace": trace[-12:],
            "method": "Learn-then-Test (conformal risk control), fixed-sequence binomial test"}


def conformal_review_threshold(pos_scores, alpha_review=0.01):
    """Split-conformal lower quantile of true-link scores (>= 1-alpha kept)."""
    s = np.sort(np.asarray(pos_scores, float))
    n = len(s)
    if not n:
        return 0.5
    k = int(math.floor(alpha_review * (n + 1)))
    return float(s[max(k - 1, 0)]) if k >= 1 else float(s[0])
