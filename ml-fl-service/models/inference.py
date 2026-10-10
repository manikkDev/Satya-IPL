import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from data.schema import SCHEMAS
from models.common import frame_to_matrix, model_columns
from models.metrics import all_metrics
from settings import settings


def available_runs():
    root = Path(settings.RUNS_DIR)
    runs = []
    if not root.exists():
        return runs
    for directory in root.iterdir():
        summary = directory / "summary.json"
        model = directory / "global_model.npz"
        if directory.is_dir() and summary.exists() and model.exists():
            value = json.loads(summary.read_text())
            runs.append({**value, "mtime": summary.stat().st_mtime})
    return sorted(runs, key=lambda item: item["mtime"], reverse=True)


def resolve_run(run_id=None):
    root = Path(settings.RUNS_DIR)
    if run_id:
        directory = root / run_id
        if (directory / "summary.json").exists() and (directory / "global_model.npz").exists():
            return directory, json.loads((directory / "summary.json").read_text())
        raise FileNotFoundError("Unknown model run {}".format(run_id))
    marker = root / "default_run.txt"
    if marker.exists():
        directory = root / marker.read_text().strip()
        if (directory / "summary.json").exists() and (directory / "global_model.npz").exists():
            return directory, json.loads((directory / "summary.json").read_text())
    runs = available_runs()
    if not runs:
        raise FileNotFoundError("No federated model is available; run the demo seed first")
    directory = root / runs[0]["run_id"]
    return directory, runs[0]


def _predict_proba(matrix, archive):
    from models.calibrate import apply_temperature
    from models.torch_mlp import build_model, predict_logits, unpack_legacy_state, unpack_state
    if "model_architecture" in archive.files:
        architecture = str(archive["model_architecture"].item())
        model = unpack_state(build_model(matrix.shape[1], architecture=architecture), archive["params"])
    else:
        model = unpack_legacy_state(build_model(matrix.shape[1], architecture="legacy_mlp_v1"), archive["params"])
    logits = predict_logits(model, matrix)
    temperature = float(archive["temperature"]) if "temperature" in archive.files else 1.0
    return apply_temperature(logits, temperature)


def _occlusion_explanations(matrix, probabilities, archive, schema, top=8):
    names = model_columns(schema)
    explanations = []
    for row_index in range(len(matrix)):
        contributions = []
        for feature in range(matrix.shape[1]):
            neutral = matrix[row_index : row_index + 1].copy()
            neutral[0, feature] = 0.0
            contribution = float(probabilities[row_index] - _predict_proba(neutral, archive)[0])
            contributions.append({"feature": names[feature], "contribution": contribution, "direction": "increases risk" if contribution >= 0 else "reduces risk"})
        contributions.sort(key=lambda item: -abs(item["contribution"]))
        explanations.append(contributions[:top])
    return explanations


def _percentile(probabilities, archive):
    """Map calibrated probabilities to population percentiles 0..1."""
    if "score_quantiles" not in archive.files:
        return probabilities
    quantiles = archive["score_quantiles"]
    return np.searchsorted(quantiles, np.clip(probabilities, quantiles[0], quantiles[-1]), side="right") / (len(quantiles) - 1)


def score_frame(frame, run_id=None, dataset="paysim_banks", explain=False):
    directory, summary = resolve_run(run_id)
    archive = np.load(directory / "global_model.npz")
    schema = SCHEMAS[dataset]
    matrix = frame_to_matrix(frame, schema, archive["mean"], archive["scale"])
    probabilities = _predict_proba(matrix, archive)
    scores = _percentile(probabilities, archive)
    result = {"run_id": summary["run_id"], "scores": probabilities.tolist(),
              "risk_scores": scores.tolist(),
              "score_semantics": "risk_score is the calibrated probability's percentile within the scored population",
              "risk_band": ["high" if value >= 0.95 else "medium" if value >= 0.75 else "low" for value in scores]}
    if explain:
        result["explanations"] = _occlusion_explanations(matrix, probabilities, archive, schema)
        result["explanation_method"] = "feature occlusion: change in calibrated probability when each feature is set to its population mean"
    return result


def test_frame(dataset="paysim_banks"):
    return pd.read_parquet(Path(settings.PARTITIONS_DIR) / dataset / "hfl_5" / "test.parquet")


def customer_sample(run_id=None, dataset="paysim_banks", n=50, client_id=None):
    schema = SCHEMAS[dataset]
    frame = test_frame(dataset)
    if client_id is not None:
        frame = frame[frame[schema.client_col] == int(client_id)]
    frame = frame.sample(min(int(n), len(frame)), random_state=17).reset_index(drop=True)
    scored = score_frame(frame, run_id, dataset, explain=False)
    columns = [schema.id_col, schema.client_col, "amount", "type", "hour", "amt_to_bal_ratio"]
    rows = frame[columns].to_dict("records")
    for row, score, probability, band in zip(rows, scored["risk_scores"], scored["scores"], scored["risk_band"]):
        row.update({"score": score, "probability": probability, "risk_band": band})
    return {"run_id": scored["run_id"], "rows": rows}


def customer_detail(customer_id, run_id=None, dataset="paysim_banks", client_id=None):
    schema = SCHEMAS[dataset]
    frame = test_frame(dataset)
    if client_id is not None:
        frame = frame[frame[schema.client_col] == int(client_id)]
    account_rows = frame[frame[schema.id_col] == str(customer_id)].copy()
    if account_rows.empty:
        raise LookupError("Customer was not found in the authorized institution scope")
    scored_all = score_frame(account_rows, run_id, dataset, explain=False)
    peak = int(np.argmax(scored_all["risk_scores"]))
    row = account_rows.iloc[[peak]].copy()
    scored = score_frame(row, run_id, dataset, explain=True)
    visible = [schema.id_col, schema.client_col, "amount", "type", "hour", "amt_to_bal_ratio",
               "oldbalanceOrg", "oldbalanceDest", "orig_tx_count_24", "orig_amt_sum_24"]
    transaction = row[[column for column in visible if column in row.columns]].iloc[0].to_dict()
    transaction.update({"score": scored["risk_scores"][0], "probability": scored["scores"][0],
                        "risk_band": scored["risk_band"][0]})
    return {"run_id": scored["run_id"], "customer_id": str(customer_id), "transaction": transaction,
            "transactions_reviewed": int(len(account_rows)), "explanation": scored["explanations"][0],
            "explanation_method": scored["explanation_method"]}


def citizen_profile(customer_ref, run_id=None, dataset="paysim_banks"):
    """Deterministic demo mapping: a citizen's customerRef selects one account in
    the scored test population; we surface that account's riskiest transaction."""
    frame = test_frame(dataset)
    schema = SCHEMAS[dataset]
    index = int(hashlib.sha256(str(customer_ref).encode()).hexdigest(), 16) % len(frame)
    account = frame.iloc[index][schema.id_col]
    account_rows = frame[frame[schema.id_col] == account]
    scored_all = score_frame(account_rows, run_id, dataset, explain=False)
    peak = int(np.argmax(scored_all["risk_scores"]))
    row = account_rows.iloc[[peak]].copy()
    scored = score_frame(row, run_id, dataset, explain=True)
    return {
        "run_id": scored["run_id"],
        "customer_ref": customer_ref,
        "pseudonymous_account": account,
        "score": scored["risk_scores"][0],
        "probability": scored["scores"][0],
        "risk_band": scored["risk_band"][0],
        "explanation": scored["explanations"][0],
        "facts": {"transaction_type": row.iloc[0]["type"], "amount": float(row.iloc[0]["amount"]),
                  "hour": int(row.iloc[0]["hour"]), "institution": int(row.iloc[0][schema.client_col]),
                  "transactions_reviewed": int(len(account_rows))},
        "guidance": ["Review repayment dates and keep scheduled payments current", "Report unfamiliar transactions immediately", "Keep contact and income information up to date"],
        "disclaimer": "This educational risk signal is not a lending decision or guarantee.",
    }


def fairness_report(run_id=None, dataset="paysim_banks"):
    schema = SCHEMAS[dataset]
    frame = test_frame(dataset)
    scored = score_frame(frame, run_id, dataset)
    frame = frame.copy()
    frame["probability"] = scored["scores"]
    groups = []
    for institution, group in frame.groupby(schema.client_col):
        metrics = all_metrics(group[schema.target].to_numpy(), group["probability"].to_numpy())
        predicted = group["probability"] >= 0.5
        negatives = group[schema.target] == 0
        false_positive_rate = float((predicted & negatives).sum() / max(1, negatives.sum()))
        groups.append({"group": "Bank {}".format(int(institution)), "false_positive_rate": false_positive_rate, **metrics})
    return {"run_id": scored["run_id"], "scope": "institution-level operational fairness; PaySim has no demographic attributes", "groups": groups}
