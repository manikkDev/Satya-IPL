"""Finalize a Flower run artifact.

The coordinator never touches data, so a Flower run ships a raw model vector
(temperature=1.0, no test metrics). This step — a separate, documented job —
loads the artifact, fits temperature calibration on the union of client
validation splits, accepts it only if held-out ECE improves, evaluates once on
the untouched official test split, and stamps the summary with honest metrics.

Usage: python -m arth_fl.finalize <run_id>
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from data.schema import SCHEMAS
from models.calibrate import apply_temperature, fit_temperature
from models.common import frame_to_matrix, sample_frame, save_json
from models.metrics import all_metrics, expected_calibration_error
from models.torch_mlp import build_model, predict_logits, unpack_state
from settings import settings


def finalize(run_id, dataset="paysim_banks", clients=5, val_cap=50000, seed=42):
    directory = Path(settings.RUNS_DIR) / run_id
    summary_path = directory / "summary.json"
    model_path = directory / "global_model.npz"
    if not summary_path.exists() or not model_path.exists():
        raise FileNotFoundError("No Flower artifact at {}".format(directory))
    summary = json.loads(summary_path.read_text())
    archive = np.load(model_path)
    architecture = str(archive["model_architecture"].item()) if "model_architecture" in archive.files else "residual_mlp_v1"
    schema = SCHEMAS[dataset]
    root = Path(settings.PARTITIONS_DIR) / dataset / "hfl_{}".format(clients)

    model = unpack_state(build_model(len(summary["feature_names"]), seed, architecture), archive["params"])

    val_logits = []
    val_labels = []
    for client in range(clients):
        frame = sample_frame(pd.read_parquet(root / "client_{}".format(client) / "val.parquet"),
                             schema.target, val_cap, seed + 1000 + client)
        matrix = frame_to_matrix(frame, schema, archive["mean"], archive["scale"])
        val_logits.append(predict_logits(model, matrix))
        val_labels.append(frame[schema.target].to_numpy(np.int8))
    val_logits = np.concatenate(val_logits)
    val_y = np.concatenate(val_labels)

    temperature = fit_temperature(val_logits, val_y)
    raw_validation = 1 / (1 + np.exp(-np.clip(val_logits, -30, 30)))
    calibrated = apply_temperature(val_logits, temperature)
    ece_raw = expected_calibration_error(val_y, raw_validation)
    ece_cal = expected_calibration_error(val_y, calibrated)
    if ece_cal >= ece_raw:
        temperature = 1.0
        calibrated = raw_validation
        ece_cal = ece_raw

    test = pd.read_parquet(root / "test.parquet").reset_index(drop=True)
    test_matrix = frame_to_matrix(test, schema, archive["mean"], archive["scale"])
    test_labels = test[schema.target].to_numpy(np.int8)
    test_probs = apply_temperature(predict_logits(model, test_matrix), temperature)
    final = all_metrics(test_labels, test_probs)
    final_uncalibrated = all_metrics(test_labels, 1 / (1 + np.exp(-np.clip(predict_logits(model, test_matrix), -30, 30))))
    score_quantiles = np.quantile(calibrated, np.linspace(0, 1, 256))

    np.savez(model_path, params=archive["params"], layer_sizes=archive["layer_sizes"],
             mean=archive["mean"], scale=archive["scale"], temperature=np.float64(temperature),
             score_quantiles=score_quantiles, model_architecture=np.array(architecture))

    summary["final"] = final
    summary["final_uncalibrated"] = final_uncalibrated
    summary["calibration"] = {"temperature": temperature, "accepted": temperature != 1.0,
                              "selection_split": "federated_validation",
                              "ece_before": ece_raw, "ece_after": ece_cal,
                              "score_display": "percentile",
                              "band_quantiles": {"medium": 0.75, "high": 0.95}}
    summary["evaluation"] = {"final_split": "official_full_test",
                             "test_n": int(len(test)),
                             "test_positive_rate": float(test_labels.mean()),
                             "round_split": "federated_validation",
                             "validation_n": int(len(val_y)),
                             "validation_positive_rate": float(val_y.mean()),
                             "test_observed_during_training": False}
    save_json(summary_path, summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description="Finalize a Flower federated run artifact")
    parser.add_argument("run_id")
    parser.add_argument("--dataset", default="paysim_banks")
    parser.add_argument("--clients", type=int, default=5)
    args = parser.parse_args()
    summary = finalize(args.run_id, args.dataset, args.clients)
    print(json.dumps({"run_id": args.run_id, "final": summary["final"]}, default=float))


if __name__ == "__main__":
    main()
