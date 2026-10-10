import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from .schema import SCHEMAS

DATA = Path(__file__).resolve().parent
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
PARTITIONS = DATA / "partitions"


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate_hfl(key: str, n_clients: int = 5) -> dict:
    schema = SCHEMAS[key]
    root = PARTITIONS / key / "hfl_{}".format(n_clients)
    metadata_path = root / "meta.json"
    _require(metadata_path.exists(), "Missing partition metadata {}".format(metadata_path))
    metadata = json.loads(metadata_path.read_text())
    _require(metadata["n_clients"] == n_clients, "Metadata client count mismatch")
    _require(len(metadata["clients"]) == n_clients, "Not all clients are represented")

    raw_manifest = RAW / key / "manifest.json"
    processed_manifest = PROCESSED / key / "manifest.json"
    _require(raw_manifest.exists(), "Missing source provenance manifest")
    _require(processed_manifest.exists(), "Missing processed-data manifest")

    global_test_path = root / "test.parquet"
    _require(global_test_path.exists(), "Missing global test split")
    global_test = pd.read_parquet(global_test_path, columns=[schema.record_col, schema.target, "is_synthetic"])
    _require(global_test["is_synthetic"].eq(0).all(), "Global test contains synthetic rows")
    global_records = set(global_test[schema.record_col])

    all_training_customers = set()
    all_client_test_records = set()
    client_results = {}
    forbidden_columns = {"nameOrig", "nameDest", "BankID", "isFlaggedFraud"}
    for client in range(n_clients):
        directory = root / "client_{}".format(client)
        split_frames = {}
        for split in ("train", "val", "test"):
            path = directory / "{}.parquet".format(split)
            _require(path.exists(), "Missing client {} {} split".format(client, split))
            columns = set(pq.read_schema(path).names)
            _require(not (columns & forbidden_columns), "Client {} {} exposes raw identifiers or target proxies".format(client, split))
            frame = pd.read_parquet(path)
            _require(set(schema.processed_required).issubset(frame.columns), "Client {} {} schema mismatch".format(client, split))
            _require(set(frame[schema.target].astype(int).unique()).issubset({0, 1}), "Client {} {} target is not binary".format(client, split))
            _require(not frame[schema.record_col].duplicated().any(), "Client {} {} has duplicate records".format(client, split))
            _require(np.isfinite(frame[schema.numeric].to_numpy(dtype=np.float64)).all(), "Client {} {} has non-finite features".format(client, split))
            if split != "train":
                _require(frame["is_synthetic"].eq(0).all(), "Client {} {} contains synthetic rows".format(client, split))
            split_frames[split] = frame

        train_customers = set(split_frames["train"][schema.id_col])
        validation_customers = set(split_frames["val"][schema.id_col])
        _require(train_customers.isdisjoint(validation_customers), "Client {} leaks customers between train and validation".format(client))
        client_customers = train_customers | validation_customers
        _require(client_customers.isdisjoint(all_training_customers), "Customers cross institution boundaries at client {}".format(client))
        all_training_customers.update(client_customers)

        test_records = set(split_frames["test"][schema.record_col])
        _require(test_records.issubset(global_records), "Client {} test is not a subset of global test".format(client))
        _require(test_records.isdisjoint(all_client_test_records), "Client test partitions overlap")
        all_client_test_records.update(test_records)
        client_results[str(client)] = {
            split: {
                "rows": len(frame),
                "positives": int(frame[schema.target].sum()),
                "positive_rate": float(frame[schema.target].mean()),
                "synthetic_rows": int(frame["is_synthetic"].sum()),
            }
            for split, frame in split_frames.items()
        }

    _require(all_client_test_records == global_records, "Client test splits do not exactly cover global test")
    training_rows = sum(result["train"]["rows"] + result["val"]["rows"] for result in client_results.values())
    training_positives = sum(result["train"]["positives"] + result["val"]["positives"] for result in client_results.values())
    full_rate = (training_positives + int(global_test[schema.target].sum())) / (training_rows + len(global_test))
    test_rate = float(global_test[schema.target].mean())
    _require(abs(test_rate - full_rate) <= 0.002, "Global test positive rate differs from full data by more than 0.2 percentage points")
    rates = [result["train"]["positive_rate"] for result in client_results.values()]
    _require(len(set(round(rate, 10) for rate in rates)) > 1, "Client label distributions are not non-IID")

    report = {
        "ok": True,
        "dataset": key,
        "validated_at": datetime.now(timezone.utc).isoformat(),
        "checks": {
            "source_provenance_manifest": True,
            "processed_manifest": True,
            "required_schema": True,
            "finite_numeric_features": True,
            "binary_target": True,
            "raw_identifiers_excluded": True,
            "client_customers_disjoint": True,
            "train_validation_customers_disjoint": True,
            "client_tests_cover_global_test": True,
            "no_synthetic_validation_or_test": True,
            "non_iid_label_distribution": True,
            "test_rate_within_0_2_percentage_points": True,
        },
        "full_positive_rate": full_rate,
        "global_test_positive_rate": test_rate,
        "positive_rate_difference": abs(test_rate - full_rate),
        "clients": client_results,
    }
    output = root / "validation_report.json"
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate data provenance, privacy boundaries, quality, and partition integrity")
    parser.add_argument("--dataset", default="paysim_banks", choices=sorted(SCHEMAS))
    parser.add_argument("--clients", type=int, default=5)
    arguments = parser.parse_args()
    validate_hfl(arguments.dataset, arguments.clients)
