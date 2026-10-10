import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Tuple

import numpy as np
import pandas as pd

from settings import settings

from .schema import GMSC, PAYSIM, SCHEMAS, validate_columns

DATA = Path(__file__).resolve().parent
RAW = DATA / "raw"
PROCESSED = DATA / "processed"
HASH_KEY = settings.ARTH_DATA_HASH_KEY.encode()


def _pseudonym(value) -> str:
    return hashlib.blake2b(str(value).encode(), key=HASH_KEY, digest_size=16).hexdigest()


def _pseudonymize(series: pd.Series) -> pd.Series:
    unique = series.astype(str).unique()
    mapping = {value: _pseudonym(value) for value in unique}
    return series.astype(str).map(mapping)


def _causal_velocity(df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
    counts = np.zeros(len(df), dtype=np.int32)
    amounts = np.zeros(len(df), dtype=np.float64)
    duplicated = df["nameOrig"].duplicated(keep=False)
    if not duplicated.any():
        return counts, amounts
    repeated = df.loc[duplicated, ["nameOrig", "step", "amount"]].sort_values(["nameOrig", "step"], kind="stable")
    for _, group in repeated.groupby("nameOrig", sort=False):
        steps = group["step"].to_numpy()
        values = group["amount"].to_numpy(dtype=np.float64)
        prefix = np.concatenate(([0.0], np.cumsum(values)))
        positions = np.arange(len(group))
        starts = np.searchsorted(steps, steps - 24, side="left")
        same_step_starts = np.searchsorted(steps, steps, side="left")
        counts[group.index.to_numpy()] = same_step_starts - starts
        amounts[group.index.to_numpy()] = prefix[same_step_starts] - prefix[starts]
    return counts, amounts


def engineer_paysim(frame: pd.DataFrame, source_split: str, row_offset: int = 0) -> pd.DataFrame:
    validate_columns(frame.columns, PAYSIM.raw_required, "PaySim raw frame")
    df = frame.reset_index(drop=True).copy()
    df[PAYSIM.record_col] = np.arange(row_offset, row_offset + len(df), dtype=np.uint64)
    if source_split == "test":
        df[PAYSIM.record_col] += np.uint64(1 << 63)
    df[PAYSIM.id_col] = _pseudonymize(df["nameOrig"])
    df["counterparty_id"] = _pseudonymize(df["nameDest"])
    df[PAYSIM.client_col] = pd.to_numeric(df["BankID"], errors="raise").astype(np.int8)
    df[PAYSIM.target] = pd.to_numeric(df[PAYSIM.target], errors="raise").astype(np.int8)
    df["amt_log"] = np.log1p(df["amount"].clip(lower=0))
    df["orig_delta"] = df["oldbalanceOrg"] - df["newbalanceOrig"] - df["amount"]
    df["dest_delta"] = df["newbalanceDest"] - df["oldbalanceDest"] - df["amount"]
    df["orig_zero_after"] = (df["newbalanceOrig"] == 0).astype(np.int8)
    df["dest_zero_before"] = (df["oldbalanceDest"] == 0).astype(np.int8)
    df["amt_to_bal_ratio"] = df["amount"] / (df["oldbalanceOrg"].abs() + 1.0)
    df["hour"] = (df["step"] % 24).astype(np.int8)
    df["is_night"] = df["hour"].between(0, 5).astype(np.int8)
    df["orig_tx_count_24"], df["orig_amt_sum_24"] = _causal_velocity(df)
    df["dest_in_degree"] = 0.0
    df["dest_out_degree"] = 0.0
    df["orig_pagerank"] = 0.0
    df["is_synthetic"] = np.int8(0)
    df["source_split"] = source_split
    keep = [*PAYSIM.processed_required, "counterparty_id", "source_split"]
    result = df[keep]
    _validate_processed(result, PAYSIM)
    return result


def engineer_gmsc(frame: pd.DataFrame) -> pd.DataFrame:
    validate_columns(frame.columns, GMSC.raw_required, "GMSC raw frame")
    df = frame.reset_index(drop=True).copy()
    raw_id = df["Unnamed: 0"] if "Unnamed: 0" in df else pd.Series(np.arange(len(df)), index=df.index)
    df[GMSC.record_col] = np.arange(len(df), dtype=np.uint64)
    df[GMSC.id_col] = _pseudonymize(raw_id)
    df["income_missing"] = df["MonthlyIncome"].isna().astype(np.int8)
    df["MonthlyIncome"] = df["MonthlyIncome"].fillna(0).clip(lower=0)
    df["NumberOfDependents"] = df["NumberOfDependents"].fillna(0).clip(lower=0)
    df["income_log"] = np.log1p(df["MonthlyIncome"])
    df["total_past_due"] = (
        df["NumberOfTime30-59DaysPastDueNotWorse"]
        + df["NumberOfTime60-89DaysPastDueNotWorse"]
        + df["NumberOfTimes90DaysLate"]
    )
    df["util_clipped"] = df["RevolvingUtilizationOfUnsecuredLines"].clip(0, 2)
    df["debt_income"] = df["DebtRatio"].clip(lower=0) * df["MonthlyIncome"]
    df["age_band"] = pd.cut(df["age"], [0, 25, 35, 45, 55, 65, np.inf], labels=False, include_lowest=True).fillna(0)
    df["dependents_per_income"] = df["NumberOfDependents"] / (df["MonthlyIncome"] + 1.0)
    ranked_income = df["MonthlyIncome"].rank(method="first")
    df[GMSC.client_col] = pd.qcut(ranked_income, 5, labels=False).astype(np.int8)
    df[GMSC.target] = pd.to_numeric(df[GMSC.target], errors="raise").astype(np.int8)
    df["is_synthetic"] = np.int8(0)
    df["source_split"] = "train"
    result = df[[*GMSC.processed_required, "source_split"]]
    _validate_processed(result, GMSC)
    return result


def _validate_processed(df: pd.DataFrame, schema) -> None:
    validate_columns(df.columns, schema.processed_required, "{} processed frame".format(schema.key))
    labels = set(df[schema.target].dropna().astype(int).unique())
    if not labels.issubset({0, 1}):
        raise ValueError("{} target is not binary: {}".format(schema.key, labels))
    if df[schema.record_col].duplicated().any():
        raise ValueError("{} contains duplicate record identifiers".format(schema.key))
    numeric = df[schema.numeric].to_numpy(dtype=np.float64)
    if not np.isfinite(numeric).all():
        bad = [column for column in schema.numeric if not np.isfinite(df[column].to_numpy(dtype=np.float64)).all()]
        raise ValueError("{} contains non-finite values in {}".format(schema.key, bad))


def process_paysim_banks() -> Path:
    source = RAW / "paysim_banks"
    files = sorted(source.glob("*.parquet"))
    if not files:
        raise FileNotFoundError("No PaySim source files. Run python -m data.download --only paysim_banks")
    destination = PROCESSED / "paysim_banks"
    destination.mkdir(parents=True, exist_ok=True)
    stats = []
    offsets = {"train": 0, "test": 0}
    for path in files:
        split = "test" if path.name.startswith("test-") else "train"
        frame = pd.read_parquet(path)
        engineered = engineer_paysim(frame, split, offsets[split])
        offsets[split] += len(frame)
        output = destination / path.name
        engineered.to_parquet(output, index=False, compression="zstd")
        row = {
            "file": output.name,
            "source_file": path.name,
            "split": split,
            "rows": len(engineered),
            "positive_rate": float(engineered[PAYSIM.target].mean()),
            "institutions": sorted(int(value) for value in engineered[PAYSIM.client_col].unique()),
        }
        stats.append(row)
        print(json.dumps(row))
    manifest = {
        "dataset": PAYSIM.key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "pseudonymization": "keyed blake2b-128; key not persisted",
        "excluded_source_columns": ["isFlaggedFraud", "nameOrig", "nameDest", "BankID"],
        "files": stats,
        "features": PAYSIM.model_features,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return destination


def process_gmsc() -> Path:
    source = RAW / "gmsc" / "cs-training.csv"
    if not source.exists():
        raise FileNotFoundError("No GMSC training CSV. Run python -m data.download --only gmsc")
    destination = PROCESSED / "gmsc"
    destination.mkdir(parents=True, exist_ok=True)
    frame = engineer_gmsc(pd.read_csv(source))
    output = destination / "train.parquet"
    frame.to_parquet(output, index=False, compression="zstd")
    manifest = {
        "dataset": GMSC.key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": 1,
        "files": [{"file": output.name, "split": "train", "rows": len(frame), "positive_rate": float(frame[GMSC.target].mean())}],
        "features": GMSC.model_features,
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return destination


def run(keys: Iterable[str]) -> None:
    handlers = {"paysim_banks": process_paysim_banks, "gmsc": process_gmsc}
    for key in keys:
        handlers[key]()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create leakage-safe model features from downloaded datasets")
    parser.add_argument("datasets", nargs="*", default=["paysim_banks"], choices=sorted(SCHEMAS))
    args = parser.parse_args()
    run(args.datasets)
