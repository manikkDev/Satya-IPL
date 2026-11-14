"""Runtime: load committed link models, score, calibrate, explain.

Artifacts: models/<task>/{model.json, model_card.json, evaluation.json}.
Inference is numpy + xgboost only (no training libraries, ~10 MB RSS).
Explanations: XGBoost pred_contribs (exact TreeSHAP, Lundberg et al. 2020)
or, for a logistic model, exact linear SHAP coef * (x - mean); contributions
are in log-odds of the raw model and mapped to plain-English reasons.
"""
import json
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

from .calibration import apply as calibrate
from .docs import TASK_OF
from .features import FEATURES

MODELS_DIR = Path(os.environ.get("SATYA_MODELS_DIR") or Path(__file__).resolve().parents[2] / "models")


class LinkModel:
    def __init__(self, task_dir):
        self.dir = Path(task_dir)
        self.card = json.loads((self.dir / "model_card.json").read_text())
        self.keys = self.card["featureKeys"]
        self.calibrator = self.card["calibrator"]
        self.thresholds = self.card["thresholds"]
        self.algorithm = self.card["algorithm"]
        raw = json.loads((self.dir / self.card.get("modelFile", "model.json")).read_text())
        if self.algorithm == "logistic_regression":
            self.coef = np.asarray(raw["coef"], float)
            self.intercept = float(raw["intercept"])
            self.mean = np.asarray(raw["mean"], float)
            self.scale = np.asarray(raw["scale"], float)
            self.booster = None
        else:
            import xgboost as xgb
            self.booster = xgb.Booster()
            self.booster.load_model(str(self.dir / self.card.get("modelFile", "model.json")))
            self.booster.set_param({"nthread": 1})

    @property
    def version(self):
        return self.card["version"]

    def margin_and_contribs(self, X):
        X = np.asarray(X, float)
        if self.booster is None:
            z = (X - self.mean) / self.scale
            contrib = z * self.coef
            return contrib.sum(axis=1) + self.intercept, contrib
        import xgboost as xgb
        dm = xgb.DMatrix(X, feature_names=self.keys)
        margin = self.booster.predict(dm, output_margin=True)
        contrib = self.booster.predict(dm, pred_contribs=True)[:, :-1]
        return margin, contrib

    def predict(self, X):
        margin, contrib = self.margin_and_contribs(X)
        return calibrate(self.calibrator, margin), margin, contrib


@lru_cache(maxsize=8)
def load(kind):
    task_dir = MODELS_DIR / TASK_OF[kind]
    if not (task_dir / "model_card.json").exists():
        return None
    model = LinkModel(task_dir)
    if model.keys != FEATURES[kind]:
        raise RuntimeError(f"{TASK_OF[kind]} artifact feature keys do not match code (retrain)")
    return model


def _pct(v):
    return f"{round(100 * v)}%"


def reason_text(kind, key, value, contrib, frm, to):
    """Plain-English evidence for one feature; None when not worth saying."""
    up = contrib > 0
    if key == "gstin_agree":
        if value > 0:
            return f"Same supplier GSTIN ({frm.gstin})"
        if value < 0:
            return f"Different supplier GSTIN ({frm.gstin} vs {to.gstin})" if to.gstin else None
        return None
    if key == "pan_agree":
        if value > 0:
            return "Same supplier PAN (legal entity), different branch GSTIN" if frm.gstin != to.gstin and frm.gstin and to.gstin else "Same supplier PAN"
        if value < 0:
            return "Supplier PAN differs"
        return None
    if key == "name_sim":
        return f"Supplier name {'matches' if value >= 0.9 else 'is similar' if value >= 0.7 else 'differs'} ({_pct(value)} similar)"
    if key == "ref_exact":
        return None
    if key == "ref_sim":
        if value <= 0.0:
            return "No printed reference to this document" if not up else None
        if value >= 0.999:
            return f"{'Narration' if kind == 'SETTLES' else 'Document'} quotes {to.number} exactly"
        if value >= 0.8:
            return f"{'Narration' if kind == 'SETTLES' else 'Document'} quotes a reference close to {to.number} (likely typo/OCR)"
        return None
    if key == "date_gap":
        days = int(value)
        if days < 0:
            return f"Dated {abs(days)} days before {to.number}"
        return f"Dated {days} days after {to.number}"
    if key == "date_order_violation" and value > 0:
        return f"Dated before {to.number} (unusual order)"
    if key == "line_match":
        return f"Line items {'match' if value >= 0.85 else 'partly match' if value >= 0.6 else 'do not match'} the PO ({_pct(value)} description/SKU similarity)"
    if key == "sku_jaccard" and value > 0:
        return f"{_pct(value)} of item codes shared"
    if key == "hsn_agree" and value > 0:
        return "HSN codes agree"
    if key == "qty_ratio" and value > 0:
        return f"Quantity is {_pct(value)} of the matching PO lines" + (" (partial delivery)" if value < 0.98 else "")
    if key == "qty_over" and value > 0:
        return "Quantity exceeds the PO line on at least one item"
    if key == "rate_agree":
        return f"Rates agree on {_pct(value)} of matched lines" if value > 0 else "Rates differ from the PO"
    if key == "rate_rel_diff" and value > 0.01:
        return f"Average rate difference {_pct(value)} vs PO"
    if key in ("value_ratio_log", "amount_ratio_log"):
        ratio = float(np.exp(value))
        return f"Value is {_pct(ratio)} of the PO value"
    if key == "amt_exact" and value > 0:
        return f"Payment equals the invoice amount ({to.number})"
    if key == "amt_tds" and value > 0:
        return "Payment equals the invoice net of a standard TDS rate (194Q/194C/194J)"
    if key == "amt_bank_charge" and value > 0:
        return "Payment is short by a bank-charge-sized amount (≤ ₹500)"
    if key == "amt_partial" and value > 0:
        return "Payment covers only part of the invoice"
    if key == "amt_over" and value > 0:
        return "Payment exceeds the invoice amount"
    if key == "combo_member" and value > 0:
        return "Invoice is part of an exact combination of open invoices that sums to the payment"
    if key == "same_amount_cands" and value > 1:
        return f"{int(value)} open invoices fit this amount (ambiguous)"
    if key == "best_competitor_gap":
        return "Clearly the best candidate" if value > 0.15 else ("Another candidate fits about as well" if value > -0.05 else "Another candidate fits better")
    if key in ("n_cands_log",) and not up:
        return f"{int(round(np.expm1(value)))} plausible candidates compete"
    if key in ("line_match_rank", "value_rank", "amount_rank", "date_rank", "prescore_rank"):
        return None
    if key == "due_gap_abs_log":
        return "Paid near the invoice due date" if up else "Paid far from the invoice due date"
    return None


def reasons(kind, row, contrib_row, keys, frm, to, top=4):
    order = np.argsort(-np.abs(contrib_row))
    out, used = [], set()
    for j in order:
        if len(out) >= top or abs(contrib_row[j]) < 0.05:
            break
        key = keys[j]
        text = reason_text(kind, key, row.get(key, 0.0), float(contrib_row[j]), frm, to)
        if text and text not in used:
            used.add(text)
            out.append({"feature": key, "text": text, "direction": "supports" if contrib_row[j] > 0 else "against",
                        "contribution": round(float(contrib_row[j]), 3)})
    return out
