"""Experiment matrix (plan §6.8): strategy ladder + DP tiers, skipping finished runs."""
import json
from pathlib import Path

from arth_fl.federated import run_federated
from settings import settings

GRID = [
    {"run-id": "mx_fedavg", "strategy": "fedavg"},
    {"run-id": "mx_fedprox", "strategy": "fedprox", "proximal-mu": 0.05},
    {"run-id": "mx_fedadam", "strategy": "fedadam", "server-lr": 0.05},
    {"run-id": "mx_fedprox_dp_mid", "strategy": "fedprox", "proximal-mu": 0.05,
     "dp-enabled": True, "dp-noise-multiplier": 0.45, "dp-clipping-norm": 2.0},
    {"run-id": "mx_fedprox_dp_strong", "strategy": "fedprox", "proximal-mu": 0.05,
     "dp-enabled": True, "dp-noise-multiplier": 2.0, "dp-clipping-norm": 2.0},
]
BASE = {"dataset": "paysim_banks", "model": "residual_mlp_v1", "num-server-rounds": 8, "local-epochs": 1,
        "client-sample-cap": 40000, "val-sample-cap": 50000, "secagg-enabled": True}


def main():
    for config in GRID:
        run_id = config["run-id"]
        if (Path(settings.RUNS_DIR) / run_id / "summary.json").exists():
            print("skip", run_id)
            continue
        summary = run_federated({**BASE, **config})
        print(run_id, "pr_auc", round(summary["final"]["pr_auc"], 4),
              "epsilon", summary["epsilon"])
    from experiments.report import build_report
    print(json.dumps(build_report()["federated"], indent=2)[:2000])


if __name__ == "__main__":
    main()
