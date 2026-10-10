import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

# xgboost/lightgbm and torch each ship an OpenMP runtime; without this the
# first large torch op deadlocks on macOS. Must be set before native imports.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import numpy as np
import pandas as pd
import xgboost as xgb

from data.schema import SCHEMAS
from models.common import frame_to_matrix, sample_frame, save_json, xy
from models.metrics import all_metrics
from settings import settings


def _mlp_fit(matrix, labels, seed, epochs=3, lr=3e-3, architecture="residual_mlp_v1"):
    """Same training routine the federated clients run — honest same-class baseline."""
    import torch
    # Single-thread intraop: xgboost/sklearn's OpenMP copy in this process
    # deadlocks torch's parallel kernels on macOS (kmp_suspend_64 hang).
    torch.set_num_threads(1)
    from models.torch_mlp import build_model, pack_state, train_local
    init = pack_state(build_model(matrix.shape[1], seed, architecture))
    vector = init + train_local(matrix, labels, init, epochs, seed, proximal_mu=0.0, lr=lr,
                                architecture=architecture)
    return vector


def _mlp_scores(vector, matrix, architecture="residual_mlp_v1"):
    from models.torch_mlp import build_model, predict_proba, unpack_state
    return predict_proba(unpack_state(build_model(matrix.shape[1], architecture=architecture), vector), matrix)


def fit_model(train, validation, key, seed=42):
    x_train, y_train = xy(train, key)
    x_validation, y_validation = xy(validation, key)
    negative, positive = np.bincount(y_train, minlength=2)
    model = xgb.XGBClassifier(
        n_estimators=350,
        learning_rate=0.06,
        max_depth=6,
        min_child_weight=2,
        subsample=0.85,
        colsample_bytree=0.85,
        scale_pos_weight=float(negative / max(positive, 1)),
        tree_method="hist",
        eval_metric="aucpr",
        random_state=seed,
        n_jobs=4,
        early_stopping_rounds=35,
    )
    model.fit(x_train, y_train, eval_set=[(x_validation, y_validation)], verbose=False)
    return model


def fit_lightgbm(train, validation, key, seed=42):
    import lightgbm as lgb
    x_train, y_train = xy(train, key)
    x_validation, y_validation = xy(validation, key)
    model = lgb.LGBMClassifier(
        n_estimators=600, learning_rate=0.05, num_leaves=63,
        subsample=0.85, colsample_bytree=0.85,
        scale_pos_weight=float(np.bincount(y_train, minlength=2)[0] / max(np.bincount(y_train, minlength=2)[1], 1)),
        random_state=seed, n_jobs=4, importance_type="gain",
    )
    model.fit(x_train, y_train, eval_set=[(x_validation, y_validation)],
              eval_metric="average_precision",
              callbacks=[lgb.early_stopping(35, verbose=False), lgb.log_evaluation(0)])
    return model


class _StandardizedLR:
    """Logistic regression carrying its own standardization statistics."""

    def __init__(self, model, mean, scale):
        self.model = model
        self.mean = mean
        self.scale = scale

    def predict_proba(self, matrix):
        return self.model.predict_proba(np.clip((matrix - self.mean) / self.scale, -12, 12))


def fit_logistic(train, key, seed=42):
    """Regularized logistic baseline (pooled reference — not federated)."""
    from sklearn.linear_model import LogisticRegression
    x_train, y_train = xy(train, key)
    mean = x_train.mean(axis=0)
    scale = np.maximum(x_train.std(axis=0), 1e-6)
    negative, positive = np.bincount(y_train, minlength=2)
    # sqrt class-weight + stronger L2: full ~775:1 weights make lbfgs diverge
    # on near-separable standardized features.
    model = LogisticRegression(C=0.5, max_iter=500,
                               class_weight={0: 1.0, 1: float(np.sqrt(negative / max(positive, 1)))},
                               solver="lbfgs", random_state=seed)
    model.fit(np.clip((x_train - mean) / scale, -12, 12), y_train)
    return _StandardizedLR(model, mean, scale)


def _stage(message):
    print("[baselines {}] {}".format(datetime.now(timezone.utc).strftime("%H:%M:%S"), message), flush=True)


def run(key="paysim_banks", clients=5, train_cap=150000, test_cap=None, runs_dir=None, seed=42,
        mlp_cap=60000, mlp_architecture="residual_mlp_v1"):
    schema = SCHEMAS[key]
    root = Path("data/partitions") / key / "hfl_{}".format(clients)
    test = sample_frame(pd.read_parquet(root / "test.parquet"), schema.target, test_cap, seed)
    x_test, y_test = xy(test, key)
    _stage("loaded {} test rows".format(len(test)))
    trains, validations, isolated = [], [], {}
    for client in range(clients):
        train = sample_frame(pd.read_parquet(root / "client_{}".format(client) / "train.parquet"), schema.target, train_cap, seed + client)
        validation = sample_frame(pd.read_parquet(root / "client_{}".format(client) / "val.parquet"), schema.target, max(25000, train_cap // 5), seed + client)
        trains.append(train)
        validations.append(validation)
        model = fit_model(train, validation, key, seed + client)
        isolated[str(client)] = all_metrics(y_test, model.predict_proba(x_test)[:, 1])
        _stage("isolated XGB client {} done ({} rows)".format(client, len(train)))
    central_train = pd.concat(trains, ignore_index=True).sample(frac=1, random_state=seed).reset_index(drop=True)
    central_validation = pd.concat(validations, ignore_index=True).sample(frac=1, random_state=seed).reset_index(drop=True)
    central = fit_model(central_train, central_validation, key, seed)
    centralized = all_metrics(y_test, central.predict_proba(x_test)[:, 1])
    _stage("pooled XGB done")
    central_lgbm = fit_lightgbm(central_train, central_validation, key, seed)
    centralized_lightgbm = all_metrics(y_test, central_lgbm.predict_proba(x_test)[:, 1])
    _stage("pooled LightGBM done")
    central_lr = fit_logistic(central_train, key, seed)
    centralized_logistic = all_metrics(y_test, central_lr.predict_proba(x_test)[:, 1])
    _stage("pooled logistic done")
    numeric_metrics = [key for key, value in centralized.items() if isinstance(value, (int, float)) and key != "n"]
    isolated_mean = {metric: float(np.mean([entry[metric] for entry in isolated.values() if entry[metric] is not None])) for metric in numeric_metrics}

    # Same-model-class baselines: identical RiskMLP + training routine as FL clients.
    from arth_fl.federated import _oversample, federated_statistics
    mlp_frames = [sample_frame(pd.read_parquet(root / "client_{}".format(client) / "train.parquet"), schema.target, mlp_cap, seed + client) for client in range(clients)]
    mean, scale, _ = federated_statistics(mlp_frames, schema)
    mlp_test = frame_to_matrix(test, schema, mean, scale)
    isolated_mlp = {}
    for client, frame in enumerate(mlp_frames):
        xm = frame_to_matrix(frame, schema, mean, scale)
        ym = frame[schema.target].to_numpy(np.int8)
        xm, ym = _oversample(xm, ym, seed + client)
        vector = _mlp_fit(xm, ym, seed + client, architecture=mlp_architecture)
        isolated_mlp[str(client)] = all_metrics(y_test, _mlp_scores(vector, mlp_test, mlp_architecture))
        _stage("isolated MLP client {} done".format(client))
    pooled = np.concatenate([frame_to_matrix(frame, schema, mean, scale) for frame in mlp_frames])
    pooled_y = np.concatenate([frame[schema.target].to_numpy(np.int8) for frame in mlp_frames])
    pooled, pooled_y = _oversample(pooled, pooled_y, seed)
    centralized_mlp = all_metrics(y_test, _mlp_scores(_mlp_fit(pooled, pooled_y, seed, architecture=mlp_architecture), mlp_test, mlp_architecture))
    _stage("pooled MLP done")
    isolated_mlp_mean = {metric: float(np.mean([entry[metric] for entry in isolated_mlp.values()])) for metric in numeric_metrics}

    result = {
        "dataset": key,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": {"centralized": "pooled-data XGBoost upper bound", "centralized_lightgbm": "pooled-data LightGBM upper bound",
                        "centralized_logistic": "pooled-data logistic regression reference",
                        "isolated": "one XGBoost model per institution",
                        "centralized_mlp": "pooled {} — same class as the federated model".format(mlp_architecture),
                        "isolated_mlp": "per-institution {} — same class as the federated model".format(mlp_architecture),
                        "train_sampling": "uniform_without_replacement", "train_cap": train_cap,
                        "mlp_cap": mlp_cap, "mlp_architecture": mlp_architecture,
                        "test_cap": test_cap, "test_sampling": "none_full_official_split", "seed": seed},
        "evaluation": {"split": "official_full_test", "n": int(len(test)),
                       "positive_rate": float(y_test.mean()), "test_observed_during_training": False},
        "centralized": centralized,
        "centralized_lightgbm": centralized_lightgbm,
        "centralized_logistic": centralized_logistic,
        "isolated": isolated,
        "isolated_mean": isolated_mean,
        "centralized_mlp": centralized_mlp,
        "isolated_mlp": isolated_mlp,
        "isolated_mlp_mean": isolated_mlp_mean,
        "gap": {"pr_auc": centralized["pr_auc"] - isolated_mean["pr_auc"], "roc_auc": centralized["roc_auc"] - isolated_mean["roc_auc"]},
        "mlp_gap": {"pr_auc": centralized_mlp["pr_auc"] - isolated_mlp_mean["pr_auc"], "roc_auc": centralized_mlp["roc_auc"] - isolated_mlp_mean["roc_auc"]},
    }
    output = Path(runs_dir or settings.RUNS_DIR)
    output.mkdir(parents=True, exist_ok=True)
    central.save_model(output / "centralized_{}.json".format(key))
    central_lgbm.booster_.save_model(str(output / "centralized_lgbm_{}.txt".format(key)))
    save_json(output / "baselines_{}.json".format(key), result)
    print(result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="paysim_banks")
    parser.add_argument("--clients", type=int, default=5)
    parser.add_argument("--train-cap", type=int, default=150000)
    parser.add_argument("--test-cap", type=int, default=0)
    parser.add_argument("--mlp-cap", type=int, default=60000)
    parser.add_argument("--mlp-architecture", default="residual_mlp_v1")
    arguments = parser.parse_args()
    run(arguments.dataset, arguments.clients, arguments.train_cap, arguments.test_cap or None,
        mlp_cap=arguments.mlp_cap, mlp_architecture=arguments.mlp_architecture)
