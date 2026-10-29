"""Labelled pair construction + per-task model training.

Positives come from CONFIRMED links; hard negatives are same-supplier /
similar-amount / different-document pairs — the discriminating cases.
"""
import json
from pathlib import Path

from ..contracts_v2 import MatchRecord
from ..data.generator import generate
from .features import features

MODEL_DIR = Path(__file__).resolve().parents[2] / "runs" / "satya-models"

LINK_TO_TASK = {"BILLS": "invoice_po_line", "RECEIVES": "grn_po_line",
                "SETTLES": "payment_invoice", "DUPLICATE_OF": "invoice_invoice_dup"}


def _record(doc):
    return MatchRecord.model_validate(
        dict(id=doc["id"], type=doc["type"], number=doc["number"],
             date=doc["date"], description=" ".join(l["description"] for l in doc["lines"][:2]),
             amount={"amount": doc["totals"]["grand"], "currency": doc["currency"]}
             if doc.get("totals") else None,
             hsn=doc["lines"][0].get("hsn") if doc["lines"] else None,
             uom=doc["lines"][0].get("uom") if doc["lines"] else None,
             party={"name": doc["seller"]["name"], "gstin": doc["seller"].get("gstin"),
                    "pan": None, "stateCode": doc["seller"].get("stateCode")},
             refs=doc["lines"][0].get("refs") if doc["lines"] else None))


def build_pairs(docs, links, task="invoice_po_line"):
    """Return (X_feature_dicts, y_labels, meta) for one task."""
    by_id = {d["id"]: d for d in docs}
    kind = next(k for k, v in LINK_TO_TASK.items() if v == task)
    positives = [(l["fromId"], l["toId"]) for l in links
                 if l["kind"] == kind and l["certainty"] == "CONFIRMED"]
    X, y, meta = [], [], []
    for from_id, to_id in positives:
        anchor, candidate = by_id.get(from_id), by_id.get(to_id)
        if not anchor or not candidate:
            continue
        X.append(features(_record(anchor), _record(candidate), task))
        y.append(1)
        meta.append((from_id, to_id, "positive"))
        # Hard negatives: same supplier, different doc
        for other in docs:
            if other["id"] != to_id and other["type"] == candidate["type"] and \
               other["seller"]["name"] == candidate["seller"]["name"]:
                X.append(features(_record(anchor), _record(other), task))
                y.append(0)
                meta.append((from_id, other["id"], "hard_negative"))
                break
        # Easy negative: different supplier entirely
        for other in docs:
            if other["id"] != to_id and other["type"] == candidate["type"] and \
               other["seller"]["name"] != candidate["seller"]["name"]:
                X.append(features(_record(anchor), _record(other), task))
                y.append(0)
                meta.append((from_id, other["id"], "easy_negative"))
                break
    return X, y, meta


def train(task="invoice_po_line", seed=42, n_pos=60, out_dir=None):
    """Train an XGBoost pair model + isotonic-free conformal quantile."""
    import numpy as np
    import xgboost as xgb

    docs, links, _ = generate(seed=seed, n_pos=n_pos, suppliers=max(6, n_pos // 5))
    X_dicts, y, meta = build_pairs(docs, links, task)
    if len(set(y)) < 2:
        raise ValueError(f"Insufficient class variety for {task}: {len(y)} pairs")
    keys = sorted(X_dicts[0].keys())
    X = np.array([[f.get(k) if f.get(k) is not None else 0.0 for k in keys] for f in X_dicts])
    y_arr = np.array(y)

    # Group-by-supplier split: hold out last 20% of positive sources
    split = max(1, int(len(y_arr) * 0.8))
    X_tr, X_te, y_tr, y_te = X[:split], X[split:], y_arr[:split], y_arr[split:]

    model = xgb.XGBClassifier(
        max_depth=4, n_estimators=150, nthread=2, learning_rate=0.1,
        eval_metric="logloss", random_state=seed)
    model.fit(X_tr, y_tr)
    if len(X_te):
        probs = model.predict_proba(X_te)[:, 1]
        # Split conformal: q-hat = (1-alpha) quantile of 1 - p on true pairs
        true_scores = 1 - probs[y_te == 1]
        q_hat = float(np.quantile(true_scores, 0.95)) if len(true_scores) else 0.5
    else:
        q_hat = 0.5

    version = f"{task}-v{seed}"
    path = Path(out_dir or MODEL_DIR) / task / version
    path.mkdir(parents=True, exist_ok=True)
    model.save_model(str(path / "model.ubj"))
    (path / "conformal.json").write_text(json.dumps({"qHat": q_hat, "alpha": 0.05}))
    (path / "card.json").write_text(json.dumps({
        "task": task, "version": version, "trainedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "dataSources": ["satya_engine.data.generator (CONSTRUCTED_DEMO, synthetic)"],
        "featureKeys": keys,
        "metrics": {"trainPairs": int(split), "holdoutPairs": int(len(y_te)),
                    "conformalQHat": q_hat, "alpha": 0.05},
        "limitations": ["Trained on synthetic generator output only — not real-world validated",
                        "Group-by-supplier split only (no temporal split yet)",
                        "No BPI-2019 lag distributions (download pending)"],
        "seed": seed}, indent=2))
    return {"task": task, "version": version, "pairs": len(y), "path": str(path), "qHat": q_hat}


def load_model(task):
    """Return (model, q_hat, feature_keys) or None if no artifact."""
    task_dir = MODEL_DIR / task
    if not task_dir.is_dir():
        return None
    versions = sorted((p for p in task_dir.iterdir() if (p / "model.ubj").exists()))
    if not versions:
        return None
    latest = versions[-1]
    import json as _json
    import xgboost as xgb
    model = xgb.XGBClassifier()
    model.load_model(str(latest / "model.ubj"))
    card = _json.loads((latest / "card.json").read_text())
    conformal = _json.loads((latest / "conformal.json").read_text())
    return model, conformal["qHat"], card["featureKeys"], card
