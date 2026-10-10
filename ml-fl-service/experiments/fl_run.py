"""CLI entry for a synchronous federated run — same engine as POST /fl/start."""
import argparse
import json

from arth_fl.federated import run_federated


def main():
    parser = argparse.ArgumentParser(description="Run a synchronous federated experiment")
    parser.add_argument("--run-id", default=None)
    parser.add_argument("--strategy", default="fedprox", choices=["fedavg", "fedprox", "fedadam"])
    parser.add_argument("--rounds", type=int, default=8)
    parser.add_argument("--local-epochs", type=int, default=1)
    parser.add_argument("--dp-enabled", action="store_true")
    parser.add_argument("--dp-noise-multiplier", type=float, default=0.45)
    parser.add_argument("--dp-clipping-norm", type=float, default=2.0)
    parser.add_argument("--target-epsilon", type=float, default=None)
    parser.add_argument("--server-lr", type=float, default=0.05)
    parser.add_argument("--secagg", action="store_true", default=True)
    parser.add_argument("--no-secagg", dest="secagg", action="store_false")
    parser.add_argument("--fraction-train", type=float, default=1.0)
    parser.add_argument("--client-sample-cap", type=int, default=60000)
    parser.add_argument("--val-sample-cap", type=int, default=50000)
    arguments = parser.parse_args()
    summary = run_federated({
        "run-id": arguments.run_id,
        "strategy": arguments.strategy,
        "num-server-rounds": arguments.rounds,
        "local-epochs": arguments.local_epochs,
        "dp-enabled": arguments.dp_enabled,
        "dp-noise-multiplier": arguments.dp_noise_multiplier,
        "dp-clipping-norm": arguments.dp_clipping_norm,
        "target-epsilon": arguments.target_epsilon,
        "secagg-enabled": arguments.secagg,
        "fraction-train": arguments.fraction_train,
        "server-lr": arguments.server_lr,
        "client-sample-cap": arguments.client_sample_cap,
        "val-sample-cap": arguments.val_sample_cap,
    })
    print(json.dumps(summary["final"], indent=2))


if __name__ == "__main__":
    main()
