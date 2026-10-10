"""Flower ServerApp: coordinator-side orchestration.

The coordinator never loads institution rows. With ``secagg-enabled=true`` the
fit stage runs the official Flower SecAgg+ protocol (key setup, key share,
masked upload, unmask) so the server only reconstructs the weighted aggregate.
FedAdam is rejected under SecAgg+: the workflow already produces the weighted
mean of client vectors, so a server-side adaptive update would be misleading.

Artifacts: the final vector + federated norm stats are saved to
``runs/<run-id>/global_model.npz`` so ``models.inference`` can serve the model.
Test-set evaluation and calibration are deliberately deferred to
``python -m arth_fl.finalize`` — the coordinator holds no data.
"""
import logging
from datetime import datetime, timezone
from itertools import count
from pathlib import Path

import numpy as np
from flwr.common import Context, ndarrays_to_parameters
from flwr.server import Grid, LegacyContext, ServerApp, ServerConfig
from flwr.server.strategy import FedAdam, FedAvg, FedProx
from flwr.server.workflow import DefaultWorkflow, SecAggPlusWorkflow
from flwr.server.workflow.constant import MAIN_PARAMS_RECORD

from arth_fl.dp_accounting import epsilon_after_rounds
from arth_fl.progress import Progress
from arth_fl.stats import load_norm_stats
from data.schema import SCHEMAS
from models.common import model_columns, save_json
from models.torch_mlp import build_model, layer_sizes, pack_state
from settings import settings

logger = logging.getLogger(__name__)

app = ServerApp()


def _bool(config, key, default=False):
    return str(config.get(key, str(default))).lower() in ("1", "true", "yes")


@app.main()
def main(grid: Grid, context: Context) -> None:
    config = context.run_config
    dataset = config.get("dataset", "paysim_banks")
    architecture = config.get("model", "residual_mlp_v1")
    clients = int(config.get("clients", 5))
    rounds = int(config.get("num-server-rounds", 8))
    secagg = _bool(config, "secagg-enabled", True)
    dp_enabled = _bool(config, "dp-enabled", False)
    dp_noise = float(config.get("dp-noise-multiplier", 0.0))
    dp_clip = float(config.get("dp-clipping-norm", 2.0))
    dp_delta = float(config.get("dp-delta", 1e-5))
    fraction_train = float(config.get("fraction-train", 1.0))
    strategy_name = config.get("strategy", "fedprox")
    run_id = config.get("run-id") or "flwr_{}".format(datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S"))

    stats_path = Path(config.get("hfl-dir") or Path(config.get("partitions-dir", "data/partitions")) / dataset / "hfl_{}".format(clients)) / "norm_stats.json"
    mean, scale, stats_payload = load_norm_stats(config.get("norm-stats-file") or stats_path)

    progress = Progress(config.get("runs-dir") or settings.RUNS_DIR, run_id,
                        config.get("progress-webhook") or settings.PROGRESS_WEBHOOK,
                        settings.NODE_INTERNAL_TOKEN)
    round_counter = count(1)
    per_round = []

    def weighted_metrics(metrics):
        """Fold each client's validation metrics into a round progress event.

        ``evaluate_metrics_aggregation_fn`` is the only channel through which
        per-round metrics reach the coordinator — metrics, never rows.
        """
        total = sum(examples for examples, _ in metrics)
        if not total:
            return {}
        aggregated = {}
        for key in ("pr_auc", "roc_auc"):
            values = [(examples, value.get(key)) for examples, value in metrics if value.get(key) is not None]
            if values:
                aggregated[key] = sum(examples * value for examples, value in values) / sum(examples for examples, _ in values)
        server_round = next(round_counter)
        client_metrics = {str(int(value.get("client_id"))): {"num_examples": examples,
                                                            "val_pr_auc": value.get("pr_auc"),
                                                            "val_roc_auc": value.get("roc_auc")}
                          for examples, value in metrics if value.get("client_id") is not None}
        event = progress.emit({
            "run_id": run_id, "event": "round", "round": server_round, "num_rounds": rounds,
            "strategy": strategy_name, "engine": "flower-1.20",
            "global": aggregated, "evaluation_split": "federated_validation",
            "clients": client_metrics,
            "privacy": {"dp_enabled": dp_enabled, "delta": dp_delta,
                        "noise_multiplier": dp_noise, "clipping_norm": dp_clip,
                        "secagg": secagg,
                        "secagg_mode": "flower_secaggplus" if secagg else "disabled"},
        })
        per_round.append(event)
        return aggregated

    features = len(model_columns(SCHEMAS[dataset]))
    initial = ndarrays_to_parameters([pack_state(build_model(features, 42, architecture))])
    common = {
        "fraction_fit": fraction_train,
        "fraction_evaluate": 1.0,
        "min_fit_clients": clients,
        "min_evaluate_clients": clients,
        "min_available_clients": clients,
        "initial_parameters": initial,
        "evaluate_metrics_aggregation_fn": weighted_metrics,
    }
    if strategy_name == "fedadam" and secagg:
        logger.warning("FedAdam under SecAgg+ is misleading (aggregate is already the weighted mean); using FedAvg.")
        strategy_name = "fedavg"
    if strategy_name == "fedprox":
        strategy = FedProx(proximal_mu=float(config.get("proximal-mu", 0.05)), **common)
    elif strategy_name == "fedadam":
        strategy = FedAdam(eta=float(config.get("server-lr", 0.05)), **common)
    else:
        strategy = FedAvg(**common)

    legacy = LegacyContext(context=context, config=ServerConfig(num_rounds=rounds), strategy=strategy)

    progress.emit({"run_id": run_id, "event": "start", "engine": "flower-1.20",
                   "config": {**dict(config), "run-id": run_id, "strategy": strategy_name}})
    if secagg:
        secure_fit = SecAggPlusWorkflow(
            num_shares=int(config.get("num-shares", clients)),
            reconstruction_threshold=int(config.get("reconstruction-threshold", max(2, clients - 1))),
            max_weight=float(config.get("max-weight", 1000000)),
            clipping_range=float(config.get("secagg-clipping-range", 8.0)),
            quantization_range=int(config.get("secagg-quantization-range", 4194304)),
            modulus_range=int(config.get("secagg-modulus-range", 4294967296)),
            timeout=float(config.get("secagg-timeout", 120.0)),
        )
        DefaultWorkflow(fit_workflow=secure_fit)(grid, legacy)
    else:
        DefaultWorkflow()(grid, legacy)

    record = legacy.state.array_records.get(MAIN_PARAMS_RECORD)
    if record is None:
        progress.emit({"run_id": run_id, "event": "end", "status": "failed",
                       "error": "workflow produced no parameters"})
        raise RuntimeError("Federated run produced no aggregated parameters")
    final_vector = np.asarray(record.to_numpy_ndarrays()[0], dtype=np.float64)

    directory = Path(config.get("runs-dir") or settings.RUNS_DIR) / run_id
    directory.mkdir(parents=True, exist_ok=True)
    np.savez(directory / "global_model.npz",
             params=final_vector, layer_sizes=np.array(layer_sizes(features)),
             mean=mean, scale=scale, temperature=np.float64(1.0),
             model_architecture=np.array(architecture))

    epsilon = epsilon_after_rounds(dp_noise, rounds, fraction_train, dp_delta) if dp_enabled else None
    summary = {
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "flower-1.20-simulation",
        "config": {**dict(config), "run-id": run_id, "strategy": strategy_name},
        "rounds": per_round,
        "final": None,
        "privacy": {"dp_enabled": dp_enabled, "epsilon": epsilon, "delta": dp_delta,
                    "noise_multiplier": dp_noise, "clipping_norm": dp_clip,
                    "dp_mode": "client_side_gaussian" if dp_enabled else "disabled",
                    "epsilon_note": "RDP estimate for the configured noise multiplier; see DECISIONS.md",
                    "secagg": secagg,
                    "secagg_mode": "flower_secaggplus" if secagg else "disabled"},
        "federated_statistics": {"aggregated_records": stats_payload.get("aggregated_records"),
                                 "shared": ["count", "feature_sum", "feature_sum_of_squares"],
                                 "raw_rows_shared": False},
        "feature_names": model_columns(SCHEMAS[dataset]),
        "evaluation": {"final_split": "pending_finalize",
                       "note": "test evaluation + calibration run via `python -m arth_fl.finalize` — the coordinator holds no data"},
    }
    save_json(directory / "summary.json", summary)
    progress.emit({"run_id": run_id, "event": "end", "status": "finished",
                   "evaluation_split": "federated_validation",
                   "privacy": summary["privacy"],
                   "next_step": "python -m arth_fl.finalize {}".format(run_id)})
    logger.info("Federated run %s complete; artifact at %s", run_id, directory)
