import hashlib
import json
import os
import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path

import numpy as np
from xgboost import XGBClassifier
from xgboost.core import XGBoostError

FEATURES = ["description_similarity", "token_overlap", "sku_agreement", "reference_agreement", "reference_conflict", "specification_agreement", "price_similarity", "quantity_similarity"]
ARTIFACT_DIR = Path(os.environ.get("MODEL_ARTIFACT_DIR", "runs/satya-linkage"))


def clean(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def features(left, right):
    a, b = left.get("description", "").lower(), right.get("description", "").lower()
    ta, tb = set(re.findall(r"[a-z0-9.]+", a)), set(re.findall(r"[a-z0-9.]+", b))
    numbers_a, numbers_b = set(re.findall(r"\d+(?:\.\d+)?", a)), set(re.findall(r"\d+(?:\.\d+)?", b))
    ra, rb = clean(left.get("poId")), clean(right.get("poId"))
    ratios = []
    for field in ("unitPrice", "quantity"):
        x, y = float(left.get(field, "0")), float(right.get(field, "0"))
        ratios.append(min(abs(x), abs(y)) / max(abs(x), abs(y)) if max(abs(x), abs(y)) else 1.0)
    return [SequenceMatcher(None, a, b).ratio(), len(ta & tb) / max(len(ta | tb), 1), float(bool(left.get("sku") and right.get("sku") and clean(left["sku"]) == clean(right["sku"]))), float(bool(ra and rb and ra == rb)), float(bool(ra and rb and ra != rb)), float(numbers_a == numbers_b) if numbers_a and numbers_b else 0.5, *ratios]


@lru_cache(maxsize=1)
def artifacts():
    report_path = ARTIFACT_DIR / "evaluation.json"
    model_path = ARTIFACT_DIR / "model.json"
    if not report_path.exists() or not model_path.exists():
        return None, {"ready": False, "task": "invoice_line_to_order_line", "message": "Run the offline training command; deterministic reconciliation remains available."}
    try:
        report = json.loads(report_path.read_text())
        if report["featureSchema"] != FEATURES or report["artifactSha256"] != hashlib.sha256(model_path.read_bytes()).hexdigest():
            raise ValueError("Artifact integrity mismatch")
        model = XGBClassifier(n_jobs=1)
        model.load_model(model_path)
        if model.n_features_in_ != len(FEATURES):
            raise ValueError("Feature schema mismatch")
        return model, report
    except (KeyError, ValueError, OSError, XGBoostError):
        return None, {"ready": False, "message": "Matching artifact validation failed; deterministic rules and heuristic suggestions remain available."}


def evaluation():
    return artifacts()[1]


def score_pair(left, right):
    values = features(left, right)
    model, report = artifacts()
    if model is None:
        score = 0.4 * values[0] + 0.25 * values[1] + 0.2 * values[2] + 0.15 * values[5]
        return {"score": round(score, 4), "probability": None, "kind": "heuristic", "features": dict(zip(FEATURES, values)), "status": "suggestion_only"}
    raw = float(model.predict(np.asarray([values]), output_margin=True)[0])
    calibration = report["calibration"]
    logit = calibration["coefficient"] * raw + calibration["intercept"]
    probability = float(1 / (1 + np.exp(-np.clip(logit, -50, 50))))
    return {"score": probability, "probability": probability, "kind": "calibrated_on_constructed_pairs", "modelVersion": report["modelVersion"], "features": dict(zip(FEATURES, values)), "status": "suggestion_only", "evaluationScope": "constructed_episode_disjoint_holdout_not_real_world_validation"}


def line_suggestions(records, po):
    proposals = []
    for invoice in records:
        if invoice.type != "INVOICE" or invoice.supplier != po.supplier:
            continue
        for item in invoice.lines:
            for ordered in po.lines:
                if len(proposals) >= 500:
                    return sorted(proposals, key=lambda p: -p["score"])[:100]
                left = {**item.model_dump(), "poId": invoice.poId}
                right = {**ordered.model_dump(), "poId": po.id}
                proposals.append({"recordId": invoice.id, "lineId": item.id, "poId": po.id, "poLineId": ordered.id, **score_pair(left, right)})
    return sorted(proposals, key=lambda p: -p["score"])[:100]
