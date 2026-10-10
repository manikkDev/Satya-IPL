import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np
import pandas as pd
import pyarrow.dataset as pads
from sklearn.model_selection import train_test_split

from .schema import SCHEMAS, Schema, validate_columns

DATA = Path(__file__).resolve().parent
PROCESSED = DATA / "processed"
PARTITIONS = DATA / "partitions"


def _read_dataset(path: Path, filters=None) -> pd.DataFrame:
    parquet_files = sorted(path.glob("*.parquet")) if path.is_dir() else [path]
    if not parquet_files:
        raise FileNotFoundError("No processed Parquet files found at {}".format(path))
    dataset = pads.dataset([str(file) for file in parquet_files], format="parquet")
    expression = None
    if filters:
        for column, operator, value in filters:
            current = pads.field(column) == value if operator == "==" else None
            if current is None:
                raise ValueError("Unsupported filter {}".format(operator))
            expression = current if expression is None else expression & current
    return dataset.to_table(filter=expression).to_pandas()


def _stable_bucket(value, seed: int, modulus: int = 10000) -> int:
    payload = "{}:{}".format(seed, value).encode()
    return int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big") % modulus


def _group_validation_mask(frame: pd.DataFrame, id_col: str, fraction: float, seed: int) -> pd.Series:
    unique_ids = frame[id_col].drop_duplicates()
    buckets = unique_ids.map(lambda value: _stable_bucket(value, seed))
    selected = set(unique_ids[buckets < int(fraction * 10000)])
    mask = frame[id_col].isin(selected)
    if mask.sum() == 0 or (~mask).sum() == 0:
        raise ValueError("Deterministic group split produced an empty train or validation set")
    return mask


def dirichlet_label_skew(frame: pd.DataFrame, target: str, n_clients: int, alpha: float, seed: int = 42) -> List[List[int]]:
    if alpha <= 0:
        raise ValueError("Dirichlet alpha must be positive")
    rng = np.random.default_rng(seed)
    assignments = [[] for _ in range(n_clients)]
    for label in sorted(frame[target].unique()):
        indices = frame.index[frame[target] == label].to_numpy()
        rng.shuffle(indices)
        proportions = rng.dirichlet([alpha] * n_clients)
        cuts = (np.cumsum(proportions) * len(indices)).astype(int)[:-1]
        for client, chunk in enumerate(np.split(indices, cuts)):
            assignments[client].extend(chunk.tolist())
    return assignments


def _frame_stats(frame: pd.DataFrame, schema: Schema) -> Dict[str, object]:
    return {
        "rows": int(len(frame)),
        "positives": int(frame[schema.target].sum()),
        "positive_rate": float(frame[schema.target].mean()) if len(frame) else 0.0,
        "synthetic_rows": int(frame["is_synthetic"].sum()),
        "unique_customers": int(frame[schema.id_col].nunique()),
    }


def _validate_partition(frame: pd.DataFrame, schema: Schema, name: str, allow_synthetic: bool) -> None:
    validate_columns(frame.columns, schema.processed_required, name)
    if frame.empty:
        raise ValueError("{} is empty".format(name))
    if frame[schema.record_col].duplicated().any():
        raise ValueError("{} contains duplicate records".format(name))
    if not allow_synthetic and frame["is_synthetic"].ne(0).any():
        raise ValueError("{} contains synthetic records".format(name))
    if not set(frame[schema.target].astype(int).unique()).issubset({0, 1}):
        raise ValueError("{} has non-binary labels".format(name))


def _source_frames(key: str, schema: Schema, seed: int):
    root = PROCESSED / key
    if key == "paysim_banks":
        train_files = sorted(root.glob("train-*.parquet"))
        test_files = sorted(root.glob("test-*.parquet"))
        if not train_files or not test_files:
            raise FileNotFoundError("Processed PaySim train/test shards are missing; run python -m data.features paysim_banks")
        return train_files, _read_dataset(root, [("source_split", "==", "test")]), "official_huggingface_test"
    all_rows = _read_dataset(root)
    train, test = train_test_split(all_rows, test_size=0.15, stratify=all_rows[schema.target], random_state=seed)
    return train.reset_index(drop=True), test.reset_index(drop=True), "stratified_holdout"


def _natural_groups(key: str, train_source, schema: Schema, n_clients: int):
    if isinstance(train_source, list):
        dataset = pads.dataset([str(file) for file in train_source], format="parquet")
        available = sorted(int(value.as_py()) for value in dataset.to_table(columns=[schema.client_col]).column(0).unique())
        if len(available) != n_clients:
            raise ValueError("Expected {} natural institutions, found {}: {}".format(n_clients, len(available), available))
        return (
            (client, dataset.to_table(filter=pads.field(schema.client_col) == institution).to_pandas())
            for client, institution in enumerate(available)
        )
    available = sorted(int(value) for value in train_source[schema.client_col].unique())
    if len(available) < n_clients:
        raise ValueError("Requested {} clients but only {} natural institutions exist".format(n_clients, len(available)))
    return (
        (client, train_source[train_source[schema.client_col] == institution].copy())
        for client, institution in enumerate(available[:n_clients])
    )


def _dirichlet_groups(train_source, schema: Schema, n_clients: int, alpha: float, seed: int) -> Dict[int, pd.DataFrame]:
    frame = _read_dataset(PROCESSED / schema.key) if isinstance(train_source, list) else train_source
    if "source_split" in frame:
        frame = frame[frame["source_split"] == "train"].copy()
    assignments = dirichlet_label_skew(frame, schema.target, n_clients, alpha, seed)
    groups = {}
    for client, indices in enumerate(assignments):
        group = frame.loc[indices].copy()
        group[schema.client_col] = client
        groups[client] = group
    return groups


def partition_hfl(key: str, n_clients: int = 5, alpha: Optional[float] = None, seed: int = 42, validation_fraction: float = 0.15) -> Path:
    schema = SCHEMAS[key]
    train_source, global_test, test_origin = _source_frames(key, schema, seed)
    groups = _natural_groups(key, train_source, schema, n_clients) if alpha is None else _dirichlet_groups(train_source, schema, n_clients, alpha, seed).items()
    output = PARTITIONS / key / "hfl_{}".format(n_clients)
    output.mkdir(parents=True, exist_ok=True)

    _validate_partition(global_test, schema, "global test", allow_synthetic=False)
    global_test.to_parquet(output / "test.parquet", index=False, compression="zstd")
    metadata = {
        "dataset": key,
        "task": schema.task,
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "n_clients": n_clients,
        "partition_method": "natural_institution" if alpha is None else "dirichlet_label_skew",
        "alpha": alpha,
        "validation_fraction": validation_fraction,
        "global_test_origin": test_origin,
        "global_test": _frame_stats(global_test, schema),
        "features": schema.model_features,
        "clients": {},
    }

    all_seen_customers = set()
    for client, group in groups:
        _validate_partition(group, schema, "client {} source".format(client), allow_synthetic=False)
        current_customers = set(group[schema.id_col].unique())
        foreign = current_customers & all_seen_customers
        if foreign:
            raise ValueError("{} customer identifiers cross institution boundaries".format(len(foreign)))
        all_seen_customers.update(current_customers)
        validation_mask = _group_validation_mask(group, schema.id_col, validation_fraction, seed)
        train = group.loc[~validation_mask].reset_index(drop=True)
        validation = group.loc[validation_mask].reset_index(drop=True)
        client_test = global_test[global_test[schema.client_col] == group[schema.client_col].iloc[0]].reset_index(drop=True)
        for split_name, split in (("train", train), ("val", validation), ("test", client_test)):
            _validate_partition(split, schema, "client {} {}".format(client, split_name), allow_synthetic=split_name == "train")
        if set(train[schema.id_col]) & set(validation[schema.id_col]):
            raise ValueError("Client {} has customer leakage between train and validation".format(client))
        directory = output / "client_{}".format(client)
        directory.mkdir(parents=True, exist_ok=True)
        train.to_parquet(directory / "train.parquet", index=False, compression="zstd")
        validation.to_parquet(directory / "val.parquet", index=False, compression="zstd")
        client_test.to_parquet(directory / "test.parquet", index=False, compression="zstd")
        metadata["clients"][str(client)] = {
            "source_institution": int(group[schema.client_col].iloc[0]),
            "train": _frame_stats(train, schema),
            "val": _frame_stats(validation, schema),
            "test": _frame_stats(client_test, schema),
        }

    rates = [round(client["train"]["positive_rate"], 10) for client in metadata["clients"].values()]
    metadata["non_iid"] = {
        "distinct_positive_rates": len(set(rates)),
        "positive_rate_min": min(rates),
        "positive_rate_max": max(rates),
        "positive_rate_range": max(rates) - min(rates),
    }
    if len(set(rates)) < 2:
        raise ValueError("Institution partitions are not measurably non-IID")
    (output / "meta.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2))
    return output


def partition_vfl(key: str, seed: int = 42, overlap: float = 0.85) -> Path:
    if not 0 < overlap <= 1:
        raise ValueError("overlap must be in (0, 1]")
    schema = SCHEMAS[key]
    root = PROCESSED / key
    frame = _read_dataset(root)
    if "source_split" in frame:
        frame = frame[frame["source_split"] == "train"].copy()
    output = PARTITIONS / key / "vfl"
    output.mkdir(parents=True, exist_ok=True)
    parties = {}
    for index, (party, columns) in enumerate(schema.vfl_groups.items()):
        mask = frame[schema.record_col].map(lambda value: _stable_bucket(value, seed + index) < int(overlap * 10000))
        selected = frame.loc[mask, [schema.record_col, *columns, *([schema.target] if party == "bank" else [])]]
        selected.to_parquet(output / "party_{}.parquet".format(party), index=False, compression="zstd")
        parties[party] = {"rows": len(selected), "columns": list(selected.columns)}
    manifest = {"dataset": key, "seed": seed, "requested_party_overlap": overlap, "join_key": schema.record_col, "label_party": "bank", "parties": parties}
    (output / "meta.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create deterministic institution partitions")
    parser.add_argument("--dataset", default="paysim_banks", choices=sorted(SCHEMAS))
    parser.add_argument("--clients", type=int, default=5)
    parser.add_argument("--mode", choices=["hfl", "vfl"], default="hfl")
    parser.add_argument("--alpha", type=float, default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--overlap", type=float, default=0.85)
    args = parser.parse_args()
    if args.mode == "hfl":
        partition_hfl(args.dataset, args.clients, args.alpha, args.seed, args.validation_fraction)
    else:
        partition_vfl(args.dataset, args.seed, args.overlap)
