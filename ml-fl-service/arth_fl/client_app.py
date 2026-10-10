"""Flower ClientApp: one institution = one isolated client process.

Under ``flwr run`` each SuperNode runs in its own Ray actor and only ever reads
that institution's partition files. The coordinator receives parameter vectors
and aggregate metrics only — and with ``secaggplus_mod`` + ``SecAggPlusWorkflow``
even those vectors are masked before they leave the client.

Features are standardized with the federated mean/scale materialized by
``python -m arth_fl.stats`` (sufficient statistics only). This keeps the model
compatible with ``models.inference``, which applies the same transform.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from flwr.client import ClientApp, NumPyClient
from flwr.client.mod import secaggplus_mod

from data.schema import SCHEMAS
from models.common import frame_to_matrix, sample_frame
from models.metrics import all_metrics
from models.torch_mlp import build_model, pack_state, predict_proba, train_local, unpack_state


def _hfl_root(config, dataset, clients):
    return Path(config.get("hfl-dir") or Path(config.get("partitions-dir", "data/partitions")) / dataset / "hfl_{}".format(clients))


def _load_norm_stats(config, dataset, clients):
    configured = config.get("norm-stats-file")
    if configured:
        path = Path(configured)
    else:
        path = _hfl_root(config, dataset, clients) / "norm_stats.json"
    if not path.exists():
        raise FileNotFoundError(
            "Federated normalization stats missing at {}. Run `python -m arth_fl.stats "
            "--dataset {} --clients {}` first (shares sufficient statistics only).".format(path, dataset, clients)
        )
    payload = json.loads(path.read_text())
    return np.asarray(payload["mean"], dtype=np.float64), np.asarray(payload["scale"], dtype=np.float64)


class BankClient(NumPyClient):
    def __init__(self, context):
        config = context.run_config
        self.client_id = int(context.node_config["partition-id"])
        clients = int(context.node_config["num-partitions"])
        dataset = config.get("dataset", "paysim_banks")
        schema = SCHEMAS[dataset]
        self.architecture = config.get("model", "residual_mlp_v1")
        self.local_epochs = int(config.get("local-epochs", 1))
        self.learning_rate = float(config.get("learning-rate", 3e-3))
        self.batch_size = int(config.get("batch-size", 512))
        self.proximal_mu = float(config.get("proximal-mu", 0.0)) if config.get("strategy") == "fedprox" else 0.0
        self.dp_enabled = str(config.get("dp-enabled", "false")).lower() in ("1", "true", "yes")
        self.dp_noise = float(config.get("dp-noise-multiplier", 0.0))
        self.dp_clip = float(config.get("dp-clipping-norm", 2.0))
        mean, scale = _load_norm_stats(config, dataset, clients)
        root = _hfl_root(config, dataset, clients) / "client_{}".format(self.client_id)
        train = sample_frame(pd.read_parquet(root / "train.parquet"), schema.target, int(config.get("client-sample-cap", 60000)), 42 + self.client_id)
        validation = sample_frame(pd.read_parquet(root / "val.parquet"), schema.target, int(config.get("val-sample-cap", 50000)), 142 + self.client_id)
        self.x_train = frame_to_matrix(train, schema, mean, scale)
        self.y_train = train[schema.target].to_numpy(np.int8)
        self.x_validation = frame_to_matrix(validation, schema, mean, scale)
        self.y_validation = validation[schema.target].to_numpy(np.int8)
        self.model = build_model(self.x_train.shape[1], 42, self.architecture)

    def get_parameters(self, config):
        return [pack_state(self.model)]

    def set_parameters(self, parameters):
        self.model = unpack_state(build_model(self.x_train.shape[1], 42, self.architecture), parameters[0])

    def fit(self, parameters, config):
        global_vector = np.asarray(parameters[0], dtype=np.float64)
        server_round = int(config.get("server_round", 0))
        update = train_local(
            self.x_train,
            self.y_train,
            global_vector,
            self.local_epochs,
            1000 + self.client_id + server_round * 100,
            proximal_mu=self.proximal_mu,
            lr=self.learning_rate,
            batch_size=self.batch_size,
            architecture=self.architecture,
        )
        if self.dp_enabled:
            # Local DP on the update before it is masked/sent: clip the delta,
            # then add Gaussian noise scaled so each client contributes its
            # share of the aggregate noise budget. Epsilon accounting is
            # reported in the run summary by the server app.
            norm = float(np.linalg.norm(update))
            if norm > self.dp_clip:
                update = update * (self.dp_clip / norm)
            rng = np.random.default_rng(10_000 + self.client_id + server_round * 100)
            update = update + rng.normal(0.0, self.dp_noise * self.dp_clip, size=update.shape)
        self.set_parameters([global_vector + update])
        return self.get_parameters({}), len(self.y_train), {"client_id": self.client_id}

    def evaluate(self, parameters, config):
        self.set_parameters(parameters)
        probabilities = predict_proba(self.model, self.x_validation)
        metrics = all_metrics(self.y_validation, probabilities)
        loss = float(-np.mean(self.y_validation * np.log(probabilities + 1e-7) + (1 - self.y_validation) * np.log(1 - probabilities + 1e-7)))
        # ConfigRecord rejects None/NaN; a tiny val split can legitimately have
        # no positives, so only ship finite numbers.
        out = {"client_id": self.client_id}
        for key in ("pr_auc", "roc_auc"):
            value = metrics.get(key)
            if value is not None and np.isfinite(value):
                out[key] = float(value)
        return loss, len(self.y_validation), out


def client_fn(context):
    return BankClient(context).to_client()


app = ClientApp(client_fn=client_fn, mods=[secaggplus_mod])
