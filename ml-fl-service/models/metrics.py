import numpy as np
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, precision_recall_curve, roc_auc_score


def expected_calibration_error(y, probabilities, bins=15):
    y = np.asarray(y, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float)
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lower, upper in zip(edges[:-1], edges[1:]):
        mask = (probabilities > lower) & (probabilities <= upper)
        if mask.any():
            total += mask.mean() * abs(y[mask].mean() - probabilities[mask].mean())
    return float(total)


def recall_at_precision(y, probabilities, target=0.90):
    precision, recall, _ = precision_recall_curve(y, probabilities)
    eligible = recall[precision >= target]
    return float(eligible.max()) if len(eligible) else 0.0


def all_metrics(y, probabilities, threshold=0.5):
    y = np.asarray(y, dtype=int)
    probabilities = np.asarray(probabilities, dtype=float).clip(1e-7, 1 - 1e-7)
    predicted = (probabilities >= threshold).astype(int)
    return {
        "roc_auc": float(roc_auc_score(y, probabilities)) if len(np.unique(y)) > 1 else None,
        "pr_auc": float(average_precision_score(y, probabilities)),
        "f1": float(f1_score(y, predicted, zero_division=0)),
        "recall_at_p90": recall_at_precision(y, probabilities),
        "brier": float(brier_score_loss(y, probabilities)),
        "ece": expected_calibration_error(y, probabilities),
        "positive_rate": float(y.mean()),
        "n": int(len(y)),
    }
