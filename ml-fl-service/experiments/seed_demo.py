import argparse
import json
from pathlib import Path

from arth_fl.federated import run_federated
from experiments.report import build_report
from graph.ingest import ingest
from models.baselines import run as run_baselines
from models.common import save_json
from settings import settings
from vertical.run_vfl_demo import run as run_vfl

BASE_FL = {
    "dataset": "paysim_banks",
    "model": "residual_mlp_v1",
    "num-server-rounds": 8,
    "local-epochs": 1,
    "client-sample-cap": 40000,
    "val-sample-cap": 50000,
    "secagg-enabled": True,
}

# Strategy ladder + privacy levels — all real runs, all reproducible.
RUNS = [
    ("demo_fedavg", {"strategy": "fedavg"}),
    ("demo_fedprox", {"strategy": "fedprox", "proximal-mu": 0.05}),
    ("demo_fedadam", {"strategy": "fedadam", "server-lr": 0.05}),
]
DP_NOISES = (0.3, 0.45, 0.6, 2.0)


def seed(force=False, include_graph=True):
    root = Path(settings.RUNS_DIR)
    baseline_path = root / "baselines_paysim_banks.json"
    if force or not baseline_path.exists():
        run_baselines(train_cap=80000, test_cap=None)
    for run_id, extra in RUNS:
        if force or not (root / run_id / "summary.json").exists():
            run_federated({**BASE_FL, **extra, "run-id": run_id, "dp-enabled": False})
    tradeoff = []
    for noise in DP_NOISES:
        run_id = "demo_fedprox_dp_{}".format(str(noise).replace(".", "p"))
        if force or not (root / run_id / "summary.json").exists():
            summary = run_federated({**BASE_FL, "strategy": "fedprox", "proximal-mu": 0.05,
                                     "run-id": run_id, "num-server-rounds": 6,
                                     "client-sample-cap": 25000, "val-sample-cap": 50000,
                                     "dp-enabled": True, "dp-noise-multiplier": noise,
                                     "dp-clipping-norm": 2.0})
        else:
            summary = json.loads((root / run_id / "summary.json").read_text())
        tradeoff.append({"run_id": summary["run_id"], "noise_multiplier": noise,
                         "epsilon": summary["epsilon"], "pr_auc": summary["final"]["pr_auc"],
                         "roc_auc": summary["final"]["roc_auc"]})
    non_private = json.loads((root / "demo_fedprox" / "summary.json").read_text())
    tradeoff.insert(0, {"run_id": non_private["run_id"], "noise_multiplier": 0, "epsilon": None,
                        "pr_auc": non_private["final"]["pr_auc"], "roc_auc": non_private["final"]["roc_auc"]})
    save_json(root / "privacy_tradeoff.json",
              {"scope": "central-DP on institution updates, 5 clients; honest measured tradeoff",
               "delta": 1e-5, "clipping_norm": 2.0, "points": tradeoff})
    (root / "default_run.txt").write_text("demo_fedprox")
    vfl_path = root / "vfl_demo" / "summary.json"
    if force or not vfl_path.exists():
        run_vfl(sample_cap=6000)
    graph = ingest("demo_fedprox", 12000) if include_graph else None
    report = build_report()
    result = {"ok": True, "baseline": json.loads(baseline_path.read_text()),
              "federated_runs": [run["run_id"] for run in report["federated"]],
              "privacy_tradeoff": tradeoff, "vfl": report["vfl"], "graph": graph}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--skip-graph", action="store_true")
    arguments = parser.parse_args()
    seed(arguments.force, not arguments.skip_graph)
