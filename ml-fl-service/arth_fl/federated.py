import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from arth_fl.dp_accounting import epsilon_after_rounds, noise_for_target_epsilon
from arth_fl.progress import Progress
from data.schema import SCHEMAS
from models.calibrate import apply_temperature, fit_temperature
from models.common import frame_to_matrix, model_columns, sample_frame, save_json
from models.metrics import all_metrics, expected_calibration_error
from models.torch_mlp import (build_model, layer_sizes, pack_state,
                              predict_logits, train_local, unpack_state)
from settings import settings


class StoppedRun(Exception):
    pass


def federated_statistics(frames, schema):
    count = 0
    total = None
    total_sq = None
    for frame in frames:
        matrix = frame_to_matrix(frame, schema).astype(np.float64)
        count += len(matrix)
        current_sum = matrix.sum(axis=0)
        current_sq = np.square(matrix).sum(axis=0)
        total = current_sum if total is None else total + current_sum
        total_sq = current_sq if total_sq is None else total_sq + current_sq
    mean = total / count
    variance = np.maximum(total_sq / count - np.square(mean), 1e-6)
    return mean.astype(np.float64), np.sqrt(variance).astype(np.float64), count


def _oversample(matrix, labels, seed, ratio=8):
    rng = np.random.default_rng(seed)
    positive = np.where(labels == 1)[0]
    negative = np.where(labels == 0)[0]
    repeats = min(ratio * len(positive), max(len(positive), len(negative) // 2))
    extra = rng.choice(positive, size=repeats, replace=True) if len(positive) else np.array([], dtype=int)
    order = np.concatenate([np.arange(len(labels)), extra])
    rng.shuffle(order)
    return matrix[order], labels[order]


def _secure_weighted_average(updates, counts, seed):
    """Simulated SecAgg: pairwise masks that cancel exactly in the sum."""
    weighted = [np.asarray(update) * count for update, count in zip(updates, counts)]
    rng = np.random.default_rng(seed)
    for left in range(len(weighted)):
        for right in range(left + 1, len(weighted)):
            mask = rng.normal(0, 0.05, size=weighted[left].shape)
            weighted[left] += mask
            weighted[right] -= mask
    return np.sum(weighted, axis=0) / sum(counts)


def _evaluate_vector(vector, matrix, architecture="residual_mlp_v1"):
    model = unpack_state(build_model(matrix.shape[1], architecture=architecture), vector)
    return 1 / (1 + np.exp(-np.clip(predict_logits(model, matrix), -30, 30)))


def run_federated(config, stop_event=None):
    dataset = config.get("dataset", "paysim_banks")
    schema = SCHEMAS[dataset]
    clients = int(config.get("clients", 5))
    rounds = int(config.get("num-server-rounds", config.get("rounds", 12)))
    epochs = int(config.get("local-epochs", 1))
    cap = int(config.get("client-sample-cap", 60000))
    val_cap = int(config.get("val-sample-cap", 50000))
    strategy = config.get("strategy", "fedprox")
    proximal_mu = float(config.get("proximal-mu", 0.05)) if strategy == "fedprox" else 0.0
    lr = float(config.get("learning-rate", 3e-3))
    batch_size = int(config.get("batch-size", 512))
    fraction_train = float(config.get("fraction-train", 1.0))
    dp_enabled = bool(config.get("dp-enabled", False))
    delta = float(config.get("dp-delta", 1e-5))
    clip = float(config.get("dp-clipping-norm", 2.0))
    secagg = bool(config.get("secagg-enabled", True))
    seed = int(config.get("seed", 42))
    server_lr = float(config.get("server-lr", 0.05))
    architecture = config.get("model", "residual_mlp_v1")

    noise = float(config.get("dp-noise-multiplier", 0.45))
    target_epsilon = config.get("target-epsilon")
    if dp_enabled and target_epsilon:
        noise = noise_for_target_epsilon(float(target_epsilon), rounds, fraction_train, delta)

    run_id = config.get("run-id") or "fl_{}".format(uuid.uuid4().hex[:8])
    root = Path(settings.PARTITIONS_DIR) / dataset / "hfl_{}".format(clients)
    frames = [sample_frame(pd.read_parquet(root / "client_{}".format(client) / "train.parquet"), schema.target, cap, seed + client) for client in range(clients)]
    val_frames = [sample_frame(pd.read_parquet(root / "client_{}".format(client) / "val.parquet"), schema.target, val_cap, seed + 1000 + client) for client in range(clients)]
    mean, scale, stats_count = federated_statistics(frames, schema)
    matrices = [frame_to_matrix(frame, schema, mean, scale) for frame in frames]
    labels = [frame[schema.target].to_numpy(np.int8) for frame in frames]
    val_matrices = [frame_to_matrix(frame, schema, mean, scale) for frame in val_frames]
    val_labels = [frame[schema.target].to_numpy(np.int8) for frame in val_frames]
    validation_matrix = np.concatenate(val_matrices)
    validation_labels = np.concatenate(val_labels)
    test = pd.read_parquet(root / "test.parquet").reset_index(drop=True)
    test_matrix = frame_to_matrix(test, schema, mean, scale)
    test_labels = test[schema.target].to_numpy(np.int8)

    sizes = layer_sizes(matrices[0].shape[1])
    global_vector = pack_state(build_model(matrices[0].shape[1], seed, architecture))
    progress = Progress(settings.RUNS_DIR, run_id, settings.PROGRESS_WEBHOOK, settings.NODE_INTERNAL_TOKEN)
    progress.path.write_text("")
    normalized_config = {**config, "run-id": run_id, "dataset": dataset, "strategy": strategy,
                         "num-server-rounds": rounds, "dp-enabled": dp_enabled,
                         "dp-noise-multiplier": noise, "dp-clipping-norm": clip,
                         "secagg-enabled": secagg, "fraction-train": fraction_train,
                         "model": architecture}
    progress.emit({"run_id": run_id, "event": "start", "config": normalized_config})
    rng = np.random.default_rng(seed)
    # FedAdam server state
    adam_m = np.zeros_like(global_vector)
    adam_v = np.zeros_like(global_vector)
    beta1, beta2, tau = 0.9, 0.99, 1e-3
    round_events = []
    n_sampled = max(1, int(round(clients * fraction_train)))

    for server_round in range(1, rounds + 1):
        if stop_event and stop_event.is_set():
            raise StoppedRun(run_id)
        if fraction_train >= 1.0:
            sampled = list(range(clients))
        else:
            sampled = sorted(rng.choice(clients, size=n_sampled, replace=False).tolist())
        updates = []
        norms = []
        sampled_counts = []
        for client in sampled:
            x_local, y_local = _oversample(matrices[client], labels[client], seed + server_round * 100 + client)
            delta_vector = train_local(x_local, y_local, global_vector, epochs,
                                       seed + server_round * 100 + client,
                                       proximal_mu=proximal_mu, lr=lr, batch_size=batch_size,
                                       architecture=architecture)
            vector_norm = float(np.linalg.norm(delta_vector))
            norms.append((client, vector_norm))
            if dp_enabled and vector_norm > clip:
                delta_vector = delta_vector * (clip / vector_norm)
            updates.append(delta_vector)
            sampled_counts.append(len(labels[client]))
        if secagg:
            aggregate = _secure_weighted_average(updates, sampled_counts, seed + server_round)
        else:
            aggregate = sum(update * count for update, count in zip(updates, sampled_counts)) / sum(sampled_counts)
        if dp_enabled:
            aggregate = aggregate + rng.normal(0, noise * clip / len(sampled), size=aggregate.shape)

        if strategy == "fedadam":
            adam_m = beta1 * adam_m + (1 - beta1) * aggregate
            adam_v = beta2 * adam_v + (1 - beta2) * np.square(aggregate)
            m_hat = adam_m / (1 - beta1 ** server_round)
            v_hat = adam_v / (1 - beta2 ** server_round)
            global_vector = global_vector + server_lr * m_hat / (np.sqrt(v_hat) + tau)
        else:
            global_vector = global_vector + aggregate

        probability = _evaluate_vector(global_vector, validation_matrix, architecture)
        metrics = all_metrics(validation_labels, probability)
        epsilon = epsilon_after_rounds(noise, server_round, fraction_train, delta) if dp_enabled else None
        client_metrics = {}
        for client in sampled:
            p = _evaluate_vector(global_vector, val_matrices[client], architecture)
            m = all_metrics(val_labels[client], p)
            client_metrics[str(client)] = {"num_examples": len(labels[client]),
                                           "update_norm": dict(norms).get(client),
                                           "val_pr_auc": m["pr_auc"], "val_roc_auc": m["roc_auc"]}
        event = progress.emit({
            "run_id": run_id,
            "event": "round",
            "round": server_round,
            "num_rounds": rounds,
            "strategy": strategy,
            "global": metrics,
            "evaluation_split": "federated_validation",
            "clients": client_metrics,
            "privacy": {"dp_enabled": dp_enabled, "epsilon": epsilon, "delta": delta,
                        "noise_multiplier": noise, "clipping_norm": clip, "secagg": secagg,
                        "secagg_mode": "simulated_pairwise_masks" if secagg else "disabled"},
        })
        round_events.append(event)

    final_probability = _evaluate_vector(global_vector, test_matrix, architecture)
    final_uncalibrated = all_metrics(test_labels, final_probability)

    # Post-hoc temperature calibration on the union of client validation sets,
    # plus a quantile map so scores can be shown as population percentiles.
    model = unpack_state(build_model(matrices[0].shape[1], seed, architecture), global_vector)
    val_logits = np.concatenate([predict_logits(model, vm) for vm in val_matrices])
    val_y = np.concatenate(val_labels)
    temperature = fit_temperature(val_logits, val_y)
    calibrated = apply_temperature(val_logits, temperature)
    raw_validation = 1 / (1 + np.exp(-np.clip(val_logits, -30, 30)))
    ece_raw = expected_calibration_error(val_y, raw_validation)
    ece_cal = expected_calibration_error(val_y, calibrated)
    calibration_accepted = ece_cal < ece_raw
    if not calibration_accepted:
        temperature = 1.0
        calibrated = raw_validation
        ece_cal = ece_raw
    calibrated_test = apply_temperature(predict_logits(model, test_matrix), temperature)
    final = all_metrics(test_labels, calibrated_test)
    score_quantiles = np.quantile(calibrated, np.linspace(0, 1, 256))

    directory = Path(settings.RUNS_DIR) / run_id
    np.savez(directory / "global_model.npz", params=global_vector, layer_sizes=np.array(sizes),
             mean=mean, scale=scale, temperature=np.float64(temperature),
             score_quantiles=score_quantiles, model_architecture=np.array(architecture))
    summary = {
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": normalized_config,
        "final": final,
        "final_uncalibrated": final_uncalibrated,
        "epsilon": round_events[-1]["privacy"]["epsilon"],
        "privacy": round_events[-1]["privacy"],
        "calibration": {"temperature": temperature, "accepted": calibration_accepted,
                        "selection_split": "federated_validation", "ece_before": ece_raw, "ece_after": ece_cal,
                        "score_display": "percentile", "band_quantiles": {"medium": 0.75, "high": 0.95}},
        "federated_statistics": {"aggregated_records": stats_count,
                                 "shared": ["count", "feature_sum", "feature_sum_of_squares"],
                                 "raw_rows_shared": False},
        "feature_names": model_columns(schema),
        "evaluation": {"final_split": "official_full_test", "test_n": int(len(test)),
                       "test_positive_rate": float(test_labels.mean()),
                       "round_split": "federated_validation", "validation_n": int(len(validation_labels)),
                       "validation_positive_rate": float(validation_labels.mean()),
                       "test_observed_during_training": False},
    }
    save_json(directory / "summary.json", summary)
    progress.emit({"run_id": run_id, "event": "end", "final": final, "evaluation_split": "official_full_test", "privacy": summary["privacy"]})
    return summary


class FederatedJobs:
    def __init__(self):
        self.jobs = {}
        self.lock = threading.Lock()

    def start(self, config):
        run_id = config.get("run-id") or "fl_{}".format(uuid.uuid4().hex[:8])
        config = {**config, "run-id": run_id}
        stop_event = threading.Event()
        job = {"run_id": run_id, "status": "running", "config": config, "stop": stop_event, "error": None}
        self.jobs[run_id] = job

        def target():
            try:
                job["summary"] = run_federated(config, stop_event)
                job["status"] = "finished"
            except StoppedRun:
                job["status"] = "stopped"
            except Exception as error:
                job["status"] = "failed"
                job["error"] = str(error)

        threading.Thread(target=target, daemon=True).start()
        return run_id

    def stop(self, run_id):
        if run_id in self.jobs:
            self.jobs[run_id]["stop"].set()
            return True
        return False

    def status(self, run_id):
        directory = Path(settings.RUNS_DIR) / run_id
        events = []
        metrics = directory / "metrics.jsonl"
        if metrics.exists():
            events = [json.loads(line) for line in metrics.read_text().splitlines() if line.strip()]
        job = self.jobs.get(run_id)
        summary_path = directory / "summary.json"
        return {
            "run_id": run_id,
            "status": job["status"] if job else ("finished" if summary_path.exists() else "unknown"),
            "config": job["config"] if job else (json.loads(summary_path.read_text())["config"] if summary_path.exists() else None),
            "rounds": [event for event in events if event.get("event") == "round"],
            "final": json.loads(summary_path.read_text()) if summary_path.exists() else None,
            "error": job.get("error") if job else None,
        }


jobs = FederatedJobs()
