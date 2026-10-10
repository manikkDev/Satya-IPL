"""Federated normalization statistics.

Flower clients standardize features with the same mean/scale that the in-process
runner and inference use. Those statistics must be derived without any client
seeing another client's rows: each institution contributes only sufficient
statistics (count, per-feature sum, per-feature sum of squares) computed over
its own *train* split. This module materializes the aggregate once per
partition layout so every Flower client and the post-run finalizer can load it.

Usage: python -m arth_fl.stats --dataset paysim_banks --clients 5
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from data.schema import SCHEMAS
from models.common import frame_to_matrix, model_columns


def compute_norm_stats(dataset="paysim_banks", clients=5, partitions_dir="data/partitions"):
    schema = SCHEMAS[dataset]
    root = Path(partitions_dir) / dataset / "hfl_{}".format(clients)
    count = 0
    total = None
    total_sq = None
    for client in range(clients):
        frame = pd.read_parquet(root / "client_{}".format(client) / "train.parquet")
        matrix = frame_to_matrix(frame, schema).astype(np.float64)
        del frame
        count += len(matrix)
        current_sum = matrix.sum(axis=0)
        current_sq = np.square(matrix).sum(axis=0)
        total = current_sum if total is None else total + current_sum
        total_sq = current_sq if total_sq is None else total_sq + current_sq
    mean = total / count
    scale = np.sqrt(np.maximum(total_sq / count - np.square(mean), 1e-6))
    payload = {
        "dataset": dataset,
        "clients": clients,
        "computed_from": "client train splits only; sufficient statistics (count, sum, sum of squares)",
        "raw_rows_shared": False,
        "aggregated_records": int(count),
        "feature_names": model_columns(schema),
        "mean": mean.tolist(),
        "scale": scale.tolist(),
    }
    path = root / "norm_stats.json"
    path.write_text(json.dumps(payload, indent=2))
    return path, payload


def load_norm_stats(path):
    payload = json.loads(Path(path).read_text())
    return np.asarray(payload["mean"], dtype=np.float64), np.asarray(payload["scale"], dtype=np.float64), payload


def main():
    parser = argparse.ArgumentParser(description="Compute federated normalization stats")
    parser.add_argument("--dataset", default="paysim_banks")
    parser.add_argument("--clients", type=int, default=5)
    parser.add_argument("--partitions-dir", default="data/partitions")
    args = parser.parse_args()
    path, payload = compute_norm_stats(args.dataset, args.clients, args.partitions_dir)
    print(json.dumps({"wrote": str(path), "aggregated_records": payload["aggregated_records"]}))


if __name__ == "__main__":
    main()
