import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from arth_fl.federated import run_federated
from models.common import MODEL_NUMERIC
from settings import settings

TYPE_VOCAB = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]


def _frame(rng, n, fraud_rate=0.1):
    fraud = rng.binomial(1, fraud_rate, n)
    data = {
        "amount": rng.lognormal(6, 1.2, n),
        "oldbalanceOrg": rng.lognormal(8, 1.0, n),
        "oldbalanceDest": rng.lognormal(7, 1.0, n),
        "amt_to_bal_ratio": rng.uniform(0, 1, n),
        "hour": rng.integers(0, 24, n).astype(float),
        "is_night": rng.binomial(1, 0.3, n).astype(float),
        "orig_tx_count_24": rng.poisson(3, n).astype(float),
        "orig_amt_sum_24": rng.lognormal(8, 1.0, n),
        "dest_in_degree": rng.poisson(2, n).astype(float),
        "dest_out_degree": rng.poisson(2, n).astype(float),
        "orig_pagerank": rng.uniform(0, 0.001, n),
        "type": rng.choice(TYPE_VOCAB, n),
        # Learnable signal: fraud correlates with high amount and TRANSFER type.
        "isFraud": fraud,
    }
    frame = pd.DataFrame(data)
    frame.loc[frame.isFraud == 1, "type"] = "TRANSFER"
    frame.loc[frame.isFraud == 1, "amount"] *= 5
    frame.loc[frame.isFraud == 1, "amt_to_bal_ratio"] = rng.uniform(0.8, 1.0, int(fraud.sum()))
    missing = [c for c in MODEL_NUMERIC if c not in frame.columns]
    for column in missing:
        frame[column] = 0.0
    return frame


@pytest.fixture()
def synthetic_partitions(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    root = tmp_path / "partitions" / "paysim_banks" / "hfl_2"
    for client in range(2):
        directory = root / "client_{}".format(client)
        directory.mkdir(parents=True)
        _frame(rng, 600).to_parquet(directory / "train.parquet")
        _frame(rng, 200).to_parquet(directory / "val.parquet")
    _frame(rng, 400).to_parquet(root / "test.parquet")
    runs = tmp_path / "runs"
    monkeypatch.setattr(settings, "PARTITIONS_DIR", str(tmp_path / "partitions"))
    monkeypatch.setattr(settings, "RUNS_DIR", str(runs))
    monkeypatch.setattr(settings, "PROGRESS_WEBHOOK", "")
    return root, runs


def test_federated_smoke_two_clients_two_rounds(synthetic_partitions):
    _, runs = synthetic_partitions
    summary = run_federated(
        {
            "dataset": "paysim_banks",
            "clients": 2,
            "num-server-rounds": 2,
            "local-epochs": 1,
            "strategy": "fedavg",
            "run-id": "smoke_test",
            "seed": 7,
        }
    )
    assert summary["run_id"] == "smoke_test"
    assert np.isfinite(summary["final"]["pr_auc"])
    assert np.isfinite(summary["final"]["roc_auc"])
    assert summary["federated_statistics"]["raw_rows_shared"] is False
    assert summary["evaluation"]["final_split"] == "official_full_test"
    assert summary["evaluation"]["test_observed_during_training"] is False
    directory = Path(runs) / "smoke_test"
    assert (directory / "global_model.npz").exists()
    events = [json.loads(line) for line in (directory / "metrics.jsonl").read_text().splitlines()]
    assert [e["event"] for e in events] == ["start", "round", "round", "end"]
    round_event = events[1]
    assert set(round_event["clients"].keys()) == {"0", "1"}
    assert "val_pr_auc" in round_event["clients"]["0"]
    assert round_event["evaluation_split"] == "federated_validation"


def test_federated_dp_run_reports_epsilon(synthetic_partitions):
    _, runs = synthetic_partitions
    summary = run_federated(
        {
            "dataset": "paysim_banks",
            "clients": 2,
            "num-server-rounds": 2,
            "strategy": "fedavg",
            "run-id": "smoke_dp",
            "dp-enabled": True,
            "dp-noise-multiplier": 1.0,
            "dp-clipping-norm": 1.0,
        }
    )
    assert summary["privacy"]["dp_enabled"] is True
    assert summary["epsilon"] is not None and summary["epsilon"] > 0


def test_fedprox_runs_with_proximal_term(synthetic_partitions):
    summary = run_federated(
        {
            "dataset": "paysim_banks",
            "clients": 2,
            "num-server-rounds": 2,
            "strategy": "fedprox",
            "proximal-mu": 0.1,
            "run-id": "smoke_fedprox",
        }
    )
    assert summary["config"]["strategy"] == "fedprox"
    assert np.isfinite(summary["final"]["pr_auc"])
