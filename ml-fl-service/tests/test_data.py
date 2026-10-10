import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from data.features import engineer_paysim
from data.partition import PARTITIONS, dirichlet_label_skew
from data.schema import PAYSIM


def _raw_paysim() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "step": [1, 2, 26, 3, 4, 5, 6, 7],
            "type": ["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER", "CASH_IN", "PAYMENT"],
            "amount": [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0],
            "nameOrig": ["A", "A", "A", "B", "C", "D", "E", "F"],
            "oldbalanceOrg": [100.0] * 8,
            "newbalanceOrig": [90.0, 80.0, 70.0, 60.0, 50.0, 40.0, 30.0, 20.0],
            "nameDest": ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8"],
            "oldbalanceDest": [0.0] * 8,
            "newbalanceDest": [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0],
            "isFraud": [0, 1, 1, 0, 0, 1, 0, 0],
            "isFlaggedFraud": [0] * 8,
            "BankID": [0, 0, 0, 1, 2, 3, 4, 4],
        }
    )


def test_paysim_features_are_private_finite_and_causal():
    processed = engineer_paysim(_raw_paysim(), "train")
    assert set(PAYSIM.processed_required).issubset(processed.columns)
    assert not {"nameOrig", "nameDest", "BankID", "isFlaggedFraud"} & set(processed.columns)
    assert processed["customer_id"].str.fullmatch(r"[0-9a-f]{32}").all()
    assert processed["counterparty_id"].str.fullmatch(r"[0-9a-f]{32}").all()
    assert np.isfinite(processed[PAYSIM.numeric].to_numpy()).all()
    assert processed.loc[0, "orig_tx_count_24"] == 0
    assert processed.loc[1, "orig_tx_count_24"] == 1
    assert processed.loc[1, "orig_amt_sum_24"] == 10.0
    assert processed.loc[2, "orig_tx_count_24"] == 1
    assert processed.loc[2, "orig_amt_sum_24"] == 20.0


def test_dirichlet_partition_is_deterministic_and_complete():
    frame = pd.DataFrame({"target": [0] * 90 + [1] * 10})
    first = dirichlet_label_skew(frame, "target", 5, 0.5, 42)
    second = dirichlet_label_skew(frame, "target", 5, 0.5, 42)
    assert first == second
    flattened = [index for client in first for index in client]
    assert sorted(flattened) == list(range(100))
    assert len(flattened) == len(set(flattened))


def test_generated_hfl_partitions_when_present():
    root = PARTITIONS / "paysim_banks" / "hfl_5"
    if not (root / "meta.json").exists():
        pytest.skip("Run make data && make partitions for the full integration assertion")
    metadata = json.loads((root / "meta.json").read_text())
    assert metadata["n_clients"] == 5
    assert metadata["partition_method"] == "natural_institution"
    assert metadata["non_iid"]["distinct_positive_rates"] > 1
    assert abs(metadata["global_test"]["positive_rate"] - _full_positive_rate(metadata)) <= 0.002

    client_ids = []
    global_records = set(pd.read_parquet(root / "test.parquet", columns=[PAYSIM.record_col])[PAYSIM.record_col])
    for client in range(5):
        directory = root / "client_{}".format(client)
        train = pd.read_parquet(directory / "train.parquet")
        validation = pd.read_parquet(directory / "val.parquet")
        test = pd.read_parquet(directory / "test.parquet")
        assert set(train[PAYSIM.id_col]).isdisjoint(set(validation[PAYSIM.id_col]))
        assert validation["is_synthetic"].eq(0).all()
        assert test["is_synthetic"].eq(0).all()
        assert set(test[PAYSIM.record_col]).issubset(global_records)
        client_ids.append(set(pd.concat([train[PAYSIM.id_col], validation[PAYSIM.id_col]])))
    for left in range(5):
        for right in range(left + 1, 5):
            assert client_ids[left].isdisjoint(client_ids[right])


def _full_positive_rate(metadata):
    train_positives = sum(client["train"]["positives"] + client["val"]["positives"] for client in metadata["clients"].values())
    train_rows = sum(client["train"]["rows"] + client["val"]["rows"] for client in metadata["clients"].values())
    test = metadata["global_test"]
    return (train_positives + test["positives"]) / (train_rows + test["rows"])
