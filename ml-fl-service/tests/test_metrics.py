import numpy as np

from models.metrics import all_metrics, expected_calibration_error, recall_at_precision


def test_metrics_are_bounded_and_rank_good_predictions():
    labels = np.array([0, 0, 1, 1])
    probabilities = np.array([0.05, 0.2, 0.8, 0.95])
    metrics = all_metrics(labels, probabilities)
    assert metrics["roc_auc"] == 1.0
    assert metrics["pr_auc"] == 1.0
    assert 0 <= metrics["ece"] <= 1
    assert recall_at_precision(labels, probabilities, 0.9) == 1.0
    assert expected_calibration_error(labels, probabilities) >= 0
