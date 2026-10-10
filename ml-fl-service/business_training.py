import hashlib
import json
import random
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_score, recall_score, roc_auc_score
from xgboost import XGBClassifier

from business_matching import ARTIFACT_DIR, FEATURES, features


def generate(seed=42, episodes=1600):
    rng = random.Random(seed)
    families = [("pump", "kW"), ("motor", "V"), ("balance", "g"), ("valve", "mm"), ("switch", "A")]
    groups = list(range(episodes))
    rng.shuffle(groups)
    partitions = {identifier: ("train" if index < episodes * 0.6 else "validation" if index < episodes * 0.75 else "calibration" if index < episodes * 0.85 else "test") for index, identifier in enumerate(groups)}
    data = {name: [] for name in ("train", "validation", "calibration", "test")}
    for episode in range(episodes):
        family, unit = rng.choice(families)
        spec = rng.choice([10, 16, 32, 50, 100, 200, 230])
        price, qty = rng.randint(100, 20000), rng.randint(5, 100)
        po = f"ORDER-{episode}"
        sku = f"{family}-{spec}-{unit}"
        ordered = {"description": f"{family} {spec} {unit} industrial equipment", "sku": sku, "poId": po, "quantity": str(qty), "unitPrice": str(price)}
        for variant in range(6):
            positive = variant < 3
            item = dict(ordered)
            item["description"] = rng.choice([f"industrial {family}, {spec}{unit}", f"{family.upper()} / {spec} {unit}", f"{spec} {unit} {family} equipment"])
            item["quantity"] = str(rng.randint(1, qty))
            item["unitPrice"] = str(price if rng.random() < 0.7 else int(price * rng.uniform(0.8, 1.2)))
            if rng.random() < 0.35:
                item["sku"] = None
            if rng.random() < 0.35:
                item["poId"] = None
            if not positive:
                if variant == 3:
                    item["poId"] = None if rng.random() < 0.45 else f"OTHER-{episode}"
                elif variant == 4:
                    other_spec = spec + 5
                    item["sku"] = f"{family}-{other_spec}-{unit}"
                    item["description"] = f"industrial {family} {other_spec} {unit} equipment"
                    item["poId"] = None
                else:
                    item["poId"] = None
                    item["sku"] = None
                    item["description"] = f"{rng.choice(['accessory', 'housing', 'cable'])} for {family} {spec} {unit}"
            data[partitions[episode]].append((features(item, ordered), int(positive), episode))
    return data


def arrays(rows):
    return np.asarray([row[0] for row in rows]), np.asarray([row[1] for row in rows])


def metrics(labels, probabilities, threshold=0.5):
    predicted = probabilities >= threshold
    return {"prAuc": float(average_precision_score(labels, probabilities)), "rocAuc": float(roc_auc_score(labels, probabilities)), "precision": float(precision_score(labels, predicted, zero_division=0)), "recall": float(recall_score(labels, predicted, zero_division=0)), "brier": float(brier_score_loss(labels, probabilities)), "samples": int(len(labels))}


def train():
    data = generate()
    x_train, y_train = arrays(data["train"])
    x_validation, y_validation = arrays(data["validation"])
    x_calibration, y_calibration = arrays(data["calibration"])
    x_test, y_test = arrays(data["test"])
    baseline = LogisticRegression(max_iter=1000, random_state=42).fit(x_train, y_train)
    candidates = []
    for depth in (3, 5):
        model = XGBClassifier(n_estimators=100, max_depth=depth, learning_rate=0.08, subsample=0.9, colsample_bytree=0.9, n_jobs=1, random_state=42, eval_metric="logloss")
        model.fit(x_train, y_train)
        score = average_precision_score(y_validation, model.predict_proba(x_validation)[:, 1])
        candidates.append((score, model))
    model = max(candidates, key=lambda value: value[0])[1]
    calibrator = LogisticRegression().fit(model.predict(x_calibration, output_margin=True).reshape(-1, 1), y_calibration)
    probabilities = calibrator.predict_proba(model.predict(x_test, output_margin=True).reshape(-1, 1))[:, 1]
    high = probabilities >= 0.98
    bins = []
    for low, upper in zip(np.linspace(0, 1, 11)[:-1], np.linspace(0, 1, 11)[1:]):
        mask = (probabilities >= low) & (probabilities < upper if upper < 1 else probabilities <= upper)
        bins.append({"low": float(low), "high": float(upper), "count": int(mask.sum()), "predicted": float(probabilities[mask].mean()) if mask.any() else None, "observed": float(y_test[mask].mean()) if mask.any() else None})
    split_manifest = {name: sorted({row[2] for row in rows}) for name, rows in data.items()}
    report = {"ready": True, "modelVersion": "satya-pair-xgb-v2", "task": "invoice_line_to_order_line", "trainedAt": datetime.now(timezone.utc).isoformat(), "source": "CONSTRUCTED", "generatorVersion": "equipment-pairs-v2", "seed": 42, "featureSchema": FEATURES, "episodeCount": 1600, "pairCount": sum(len(rows) for rows in data.values()), "splitCounts": {name: len(rows) for name, rows in data.items()}, "splitManifestHash": hashlib.sha256(json.dumps(split_manifest, sort_keys=True).encode()).hexdigest(), "calibration": {"kind": "held_out_sigmoid", "coefficient": float(calibrator.coef_[0, 0]), "intercept": float(calibrator.intercept_[0])}, "baselines": {"logistic": metrics(y_test, baseline.predict_proba(x_test)[:, 1])}, "test": metrics(y_test, probabilities), "highConfidence": {"threshold": 0.98, "count": int(high.sum()), "coverage": float(high.mean()), "precision": float(y_test[high].mean()) if high.any() else None}, "reliabilityBins": bins, "automaticApproval": False, "limitations": ["Constructed pair labels; not measured on a real Indian company's records.", "Balanced constructed candidate prevalence is not deployment prevalence.", "No pretrained semantic encoder or OCR model is fine-tuned in this artifact.", "Specification and recurring-order negatives are limited to this generator; human review remains mandatory."]}
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_model(ARTIFACT_DIR / "model.json")
    report["artifactSha256"] = hashlib.sha256((ARTIFACT_DIR / "model.json").read_bytes()).hexdigest()
    (ARTIFACT_DIR / "evaluation.json").write_text(json.dumps(report, indent=2))
    (ARTIFACT_DIR / "splits.json").write_text(json.dumps(split_manifest))
    print(json.dumps({"modelVersion": report["modelVersion"], "test": report["test"], "source": report["source"], "automaticApproval": False}))
    return report


if __name__ == "__main__":
    train()
