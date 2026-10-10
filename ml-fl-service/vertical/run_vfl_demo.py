"""Vertical federated learning demo: real split-NN over PSI-aligned records.

Three parties hold disjoint feature slices of the same customers. Only the
bank holds labels. Private-set intersection (hashed Diffie-Hellman, see
``vertical/psi.py``) aligns records without revealing non-overlapping
identifiers. Training is genuine split learning — parties exchange embedding
tensors and embedding gradients only; raw features never leave a party.
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from data.schema import SCHEMAS
from models.common import TYPE_VOCAB, save_json
from settings import settings
from vertical.psi import Party, intersect_many
from vertical.splitnn import SplitNNTrainer, VFLParty


def party_matrix(frame, columns, fit_indices=None):
    """Encode one party's slice. Standardization stats are LOCAL to the party."""
    numeric = [c for c in columns if c != "type"]
    parts = []
    if numeric:
        values = frame[numeric].fillna(0).to_numpy(np.float32)
        ref = values[fit_indices] if fit_indices is not None else values
        mean, std = ref.mean(axis=0), np.clip(ref.std(axis=0), 1e-6, None)
        parts.append(np.clip((values - mean) / std, -12, 12))
    if "type" in columns:
        parts.append(np.column_stack([(frame["type"] == v).to_numpy(np.float32) for v in TYPE_VOCAB]))
    return np.column_stack(parts).astype(np.float32)


def run(dataset="paysim_banks", sample_cap=30000, epochs=8, embed_dim=8, seed=42):
    schema = SCHEMAS[dataset]
    source = pd.read_parquet(Path(settings.PARTITIONS_DIR) / dataset / "hfl_5" / "client_0" / "train.parquet")
    frame = source.sample(min(sample_cap, len(source)), random_state=seed).reset_index(drop=True)  # uniform, label-blind
    rng = np.random.default_rng(seed)

    # Simulate partial coverage: each party observes ~92% of the records.
    parties = {}
    for party, columns in schema.vfl_groups.items():
        mask = rng.random(len(frame)) < 0.92
        cols = [schema.record_col, *columns, *([schema.target] if party == "bank" else [])]
        parties[party] = frame.loc[mask, cols].drop_duplicates(schema.record_col)

    # PSI: parties discover shared record_ids without exposing non-overlaps.
    identifiers = intersect_many([Party(value[schema.record_col].astype(str).tolist()) for value in parties.values()])
    shared = set(identifiers)
    aligned = {name: value[value[schema.record_col].astype(str).isin(shared)]
                    .set_index(schema.record_col).sort_index() for name, value in parties.items()}
    common = sorted(set.intersection(*(set(value.index) for value in aligned.values())))
    aligned = {name: value.loc[common] for name, value in aligned.items()}

    labels = aligned["bank"][schema.target].to_numpy(np.int8)
    order = np.random.default_rng(seed).permutation(len(common))
    cut = int(len(order) * 0.75)
    train_idx, test_idx = order[:cut], order[cut:]

    matrices = {name: party_matrix(frame_party, schema.vfl_groups[name], fit_indices=train_idx)
                for name, frame_party in aligned.items()}

    # Parties: bank holds labels + top model; others are passive feature holders.
    vfl_parties = [
        VFLParty(name, matrices[name], labels=labels if name == "bank" else None,
                 embed_dim=embed_dim, holds_labels=(name == "bank"), seed=seed + i)
        for i, name in enumerate(["bank", "lending_app", "insurer"])
    ]
    label_party = next(p for p in vfl_parties if p.holds_labels)
    trainer = SplitNNTrainer(vfl_parties, label_party, embed_dim=embed_dim, lr=1e-3)

    pos_weight = torch.tensor(float(np.clip((labels[train_idx] == 0).sum() / max((labels[train_idx] == 1).sum(), 1), 1, 50)))
    history = []
    for epoch in range(1, epochs + 1):
        loss = trainer.train_epoch(train_idx, pos_weight=pos_weight)
        history.append({"epoch": epoch, "train_loss": round(loss, 5)})

    vfl_scores = trainer.predict(test_idx)

    # Bank-only baseline: same total capacity, only the bank's own slice.
    solo = VFLParty("bank_solo", matrices["bank"], labels=labels, embed_dim=embed_dim, holds_labels=True, seed=seed)
    solo_trainer = SplitNNTrainer([solo], solo, embed_dim=embed_dim, lr=1e-3)
    for _ in range(epochs):
        solo_trainer.train_epoch(train_idx, pos_weight=pos_weight)
    bank_scores = solo_trainer.predict(test_idx)

    # Centralized ceiling reference (clearly labeled, never deployable):
    combined = np.column_stack([matrices[n] for n in ["bank", "lending_app", "insurer"]])
    pooled = make_pipeline(StandardScaler(),
                           LogisticRegression(max_iter=200, C=0.5, class_weight="balanced",
                                              solver="saga", random_state=seed))
    pooled.fit(combined[train_idx], labels[train_idx])
    pooled_scores = pooled.predict_proba(combined[test_idx])[:, 1]

    result = {
        "aligned_n": len(common),
        "protocol": "split-NN: bottom nets per party + top net on label holder; embeddings + embedding gradients only",
        "psi": "hashed Diffie-Hellman educational simulation (vertical/psi.py)",
        "parties": {name: {"features": len(schema.vfl_groups[name]), "matrix_width": int(m.shape[1])}
                    for name, m in matrices.items()},
        "communication": trainer.ledger.summary(),
        "epochs": epochs,
        "history": history,
        "test_n": int(len(test_idx)),
        "test_positive_rate": float(labels[test_idx].mean()),
        "bank_only_roc_auc": float(roc_auc_score(labels[test_idx], bank_scores)),
        "bank_only_pr_auc": float(average_precision_score(labels[test_idx], bank_scores)),
        "vfl_roc_auc": float(roc_auc_score(labels[test_idx], vfl_scores)),
        "vfl_pr_auc": float(average_precision_score(labels[test_idx], vfl_scores)),
        "vfl_pr_auc_gain": float(average_precision_score(labels[test_idx], vfl_scores)
                                 - average_precision_score(labels[test_idx], bank_scores)),
        "centralized_pooled_reference_roc_auc": float(roc_auc_score(labels[test_idx], pooled_scores)),
        "centralized_pooled_reference_pr_auc": float(average_precision_score(labels[test_idx], pooled_scores)),
        "notes": "Centralized reference pools raw features and is NOT deployable under the privacy model; "
                 "it bounds what split-NN can approach. Single-process party isolation; "
                 "boundary crossings are ledgered, not socketed.",
    }
    save_json(Path(settings.RUNS_DIR) / "vfl_demo" / "summary.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="paysim_banks")
    parser.add_argument("--epochs", type=int, default=8)
    args = parser.parse_args()
    print(run(args.dataset, epochs=args.epochs))
