import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE

from .schema import SCHEMAS

PARTITIONS = Path(__file__).resolve().parent / "partitions"


def smote_client(train: pd.DataFrame, key: str, target_positive_rate: float = 0.10, seed: int = 42) -> pd.DataFrame:
    schema = SCHEMAS[key]
    if not 0 < target_positive_rate < 0.5:
        raise ValueError("target_positive_rate must be in (0, 0.5)")
    if train["is_synthetic"].ne(0).any():
        raise ValueError("Refusing to augment a frame that already contains synthetic rows")
    y = train[schema.target].astype(int).to_numpy()
    positives = int(y.sum())
    desired_positives = int(np.ceil(target_positive_rate * (len(y) - positives) / (1 - target_positive_rate)))
    if positives >= desired_positives:
        return train.copy()
    if positives < 6:
        raise ValueError("SMOTE requires at least 6 positive examples")
    features = train[schema.numeric].fillna(0).astype(float)
    sampler = SMOTE(sampling_strategy={1: desired_positives}, random_state=seed)
    resampled_x, resampled_y = sampler.fit_resample(features, y)
    generated_count = len(resampled_x) - len(train)
    synthetic = pd.DataFrame(resampled_x[-generated_count:], columns=schema.numeric)
    synthetic[schema.target] = resampled_y[-generated_count:].astype(np.int8)
    synthetic["is_synthetic"] = np.int8(1)
    synthetic[schema.record_col] = ["synthetic_{}_{}".format(seed, index) for index in range(generated_count)]
    synthetic[schema.id_col] = ["synthetic_customer_{}_{}".format(seed, index) for index in range(generated_count)]
    synthetic[schema.client_col] = train[schema.client_col].iloc[0]
    if schema.time_col:
        synthetic[schema.time_col] = train[schema.time_col].median()
    for column in schema.categorical:
        synthetic[column] = train[column].mode(dropna=True).iloc[0]
    for column in train.columns:
        if column not in synthetic:
            synthetic[column] = "synthetic" if train[column].dtype == object else 0
    synthetic = synthetic[train.columns]
    return pd.concat([train, synthetic], ignore_index=True)


def augment_partition(key: str, n_clients: int = 5, target_positive_rate: float = 0.10, seed: int = 42) -> None:
    root = PARTITIONS / key / "hfl_{}".format(n_clients)
    metadata_path = root / "meta.json"
    metadata = json.loads(metadata_path.read_text())
    for client in range(n_clients):
        path = root / "client_{}".format(client) / "train.parquet"
        original = pd.read_parquet(path)
        augmented = smote_client(original, key, target_positive_rate, seed + client)
        augmented.to_parquet(path, index=False, compression="zstd")
        metadata["clients"][str(client)]["augmentation"] = {
            "method": "SMOTE",
            "original_rows": len(original),
            "synthetic_rows": len(augmented) - len(original),
            "target_positive_rate": target_positive_rate,
        }
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Optionally augment client training splits only")
    parser.add_argument("--dataset", default="paysim_banks", choices=sorted(SCHEMAS))
    parser.add_argument("--clients", type=int, default=5)
    parser.add_argument("--target-positive-rate", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    augment_partition(args.dataset, args.clients, args.target_positive_rate, args.seed)
