"""Offline training + honest evaluation for the three link models.

    python -m satya_engine.linking.train [--quick]

Data (labelled pairs from blocking candidates):
  synthetic  - satya_engine.linking.datasets.synthetic (seeded worlds)
  bpi2019    - real BPI Challenge 2019 P2P structure, synthetic identities
  demo       - curated demo dataset, held out entirely (sanity only)
Splits are group-disjoint (a group = one independent buyer world):
  train 50% | valid 15% (model + calibrator selection) | calib 15% (thresholds) | test 20%
Writes models/<task>/{model.json, model_card.json, evaluation.json}.
"""
import argparse
import json
import random
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import calibration as cal
from .blocking import candidates, completeness
from .decide import decision, per_doc
from .docs import FROM_TYPES, KINDS, TASK_OF, TO_TYPES, to_link_doc
from .features import FEATURES, MONOTONE, featurize, vectorize
from .metrics import ece, group_bootstrap, prf, ranking, summarize_probs, wilson
from .model import MODELS_DIR

SPLITS = (("train", 0.50), ("valid", 0.15), ("calib", 0.15), ("test", 0.20))
TARGET_PRECISION = 0.99
DELTA = 0.05
ALPHA_REVIEW = 0.02
REVIEW_FLOOR = 0.05
MARGIN = 0.10
TITLES = {"BILLS": "Invoice → PO linker", "RECEIVES": "GRN → PO linker", "SETTLES": "Payment → invoice linker"}
VERSION_DATE = datetime.now(timezone.utc).strftime("%Y%m%d")


def paise(value):
    return None if value is None else int((value * 100).to_integral_value())


def pay_paise(doc):
    if doc.amount is None:
        return None
    return paise(doc.amount + (doc.tds or 0))


def build_rows(world, kind):
    docs = [to_link_doc(d) for d in world["documents"]]
    frm = [d for d in docs if d.type == FROM_TYPES[kind]]
    to = [d for d in docs if d.type == TO_TYPES[kind]]
    truth = {(l["fromId"], l["toId"]) for l in world["links"] if l["kind"] == kind}
    cands = candidates(kind, frm, to)
    rows = []
    for f in frm:
        lst = cands.get(f.id, [])
        feats = featurize(kind, f, lst)
        for (t, blocks), row in zip(lst, feats):
            target = t.open_amount if t.open_amount is not None else t.amount
            rows.append({"from": f.id, "to": t.id, "y": int((f.id, t.id) in truth), "f": row,
                         "group": world["group"], "source": world["source"], "blocks": sorted(blocks),
                         "pay": pay_paise(f), "open": paise(target), "tax": paise(t.taxable or target)})
    linkable = {fid for fid, _ in truth}
    stats = completeness(cands, truth, len(frm), len(to))
    return rows, stats, linkable, len(frm)


def assign_splits(groups, seed):
    groups = sorted(groups)
    random.Random(seed).shuffle(groups)
    out, start = {}, 0
    for i, (name, frac) in enumerate(SPLITS):
        end = len(groups) if i == len(SPLITS) - 1 else start + max(1, round(frac * len(groups)))
        for g in groups[start:end]:
            out[g] = name
        start = end
    return out


# --------------------------------------------------------------------- models
def fit_logistic(X, y):
    from sklearn.linear_model import LogisticRegression
    mean, scale = X.mean(axis=0), X.std(axis=0)
    scale[scale == 0] = 1.0
    lr = LogisticRegression(C=1.0, max_iter=2000)
    lr.fit((X - mean) / scale, y)
    return {"type": "logistic", "coef": lr.coef_[0].tolist(), "intercept": float(lr.intercept_[0]),
            "mean": mean.tolist(), "scale": scale.tolist()}


def logistic_margin(m, X):
    return ((X - np.asarray(m["mean"])) / np.asarray(m["scale"])) @ np.asarray(m["coef"]) + m["intercept"]


def fit_xgb(X, y, Xv, yv, keys, seed):
    import xgboost as xgb
    mono = "(" + ",".join(str(MONOTONE.get(k, 0)) for k in keys) + ")"
    params = {"objective": "binary:logistic", "eval_metric": "aucpr", "max_depth": 4, "eta": 0.05,
              "subsample": 0.8, "colsample_bytree": 0.8, "min_child_weight": 2, "lambda": 1.0,
              "monotone_constraints": mono, "nthread": 4, "seed": seed}
    dtr = xgb.DMatrix(X, label=y, feature_names=keys)
    dva = xgb.DMatrix(Xv, label=yv, feature_names=keys)
    booster = xgb.train(params, dtr, num_boost_round=600, evals=[(dva, "valid")],
                        early_stopping_rounds=40, verbose_eval=False)
    best = booster.best_iteration + 1
    booster = xgb.train(params, dtr, num_boost_round=best)  # refit without the eval set
    return booster


def xgb_margin(booster, X, keys):
    import xgboost as xgb
    return booster.predict(xgb.DMatrix(X, feature_names=keys), output_margin=True)


def fit_hgb(X, y, seed):
    from sklearn.ensemble import HistGradientBoostingClassifier
    model = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=15,
                                           early_stopping=True, validation_fraction=0.15, random_state=seed)
    model.fit(X, y)
    return model


# ----------------------------------------------------------------- decisions
def ranked_by_from(rows, probs):
    by, pay = defaultdict(list), {}
    for r, p in zip(rows, probs):
        by[r["from"]].append((r["to"], float(p), r["open"], r["tax"], r["y"], r["group"], r["source"]))
        pay[r["from"]] = r["pay"]
    for k in by:
        by[k].sort(key=lambda t: (-t[1], t[0]))
    return by, pay


def decision_table(kind, rows, probs, thresholds):
    """One row per decision unit (from-document): LTT score and whether the
    auto decision would contain a false link."""
    out = []
    by, pay = ranked_by_from(rows, probs)
    for fid, ranked in by.items():
        truth = {t[0] for t in ranked if t[4]}
        score, chosen = decision(kind, [t[:4] for t in ranked], thresholds, pay[fid])
        wrong = int(any(c not in truth for c in chosen)) if chosen else 1
        out.append({"score": score, "wrong": wrong, "group": ranked[0][5], "source": ranked[0][6], "from": fid})
    return out


def zones(kind, rows, probs, thresholds):
    """Apply the deployed rule; returns {(from,to): zone}."""
    zone = {}
    by, pay = ranked_by_from(rows, probs)
    for fid, ranked in by.items():
        for to_id, p, z, _basis in per_doc(kind, [t[:4] for t in ranked], thresholds, pay[fid]):
            zone[(fid, to_id)] = z
    return zone


def evaluate(kind, rows, probs, thresholds, truth_total, linkable_from, boot=True):
    """Decision-level + pair-level metrics on one evaluation slice."""
    y = np.array([r["y"] for r in rows])
    zone = zones(kind, rows, probs, thresholds)
    groups = [r["group"] for r in rows]
    auto = np.array([zone.get((r["from"], r["to"])) == "auto" for r in rows])
    suggested = np.array([zone.get((r["from"], r["to"])) in ("auto", "review") for r in rows])
    tp = int((auto & (y == 1)).sum())
    fp = int((auto & (y == 0)).sum())
    fn = int(truth_total - tp)
    tn = int((~auto & (y == 0)).sum())
    precision, recall, f1 = prf(tp, fp, fn)
    summary, reliability = summarize_probs(probs, y)
    out = {
        "precision": precision, "recall": recall, "f1": f1,
        "prAuc": summary["prAuc"], "rocAuc": summary["rocAuc"], "brier": summary["brier"],
        "ece": summary["ece"], "eceEqualMass": summary["eceEqualMass"],
        "confusion": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "precisionWilson": wilson(tp, tp + fp),
        "autoRate": round(len({r["from"] for r, a in zip(rows, auto) if a}) / max(len(linkable_from) or 1, 1), 4),
        "suggestRecall": round(int((suggested & (y == 1)).sum()) / truth_total, 4) if truth_total else None,
        "reviewPairs": int((suggested & ~auto).sum()),
        "pairs": int(len(rows)), "positives": int(y.sum()), "truthLinks": int(truth_total),
    }
    if boot:
        g_arr = np.array(groups)
        truth_by_group = defaultdict(int)
        for r in rows:
            truth_by_group[r["group"]] += r["y"]

        def p_stat(idx):
            a, yy = auto[idx], y[idx]
            n = a.sum()
            return float((a & (yy == 1)).sum() / n) if n else np.nan

        def r_stat(idx):
            a, yy = auto[idx], y[idx]
            tot = yy.sum()
            return float((a & (yy == 1)).sum() / tot) if tot else np.nan
        out["ci"] = {"precision": group_bootstrap(list(g_arr), p_stat), "recall": group_bootstrap(list(g_arr), r_stat),
                     "method": "percentile bootstrap, 1000 reps, resampling whole groups (buyer worlds)"}
    return out, reliability


def coverage_curve(kind, rows, probs, thresholds, n_linkable):
    table = decision_table(kind, rows, probs, thresholds)
    pts = []
    for t in [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.95, 0.97, 0.98, 0.99, 0.995, 0.998, 0.999]:
        acc = [d for d in table if d["score"] is not None and d["score"] >= t]
        wrong = sum(d["wrong"] for d in acc)
        pts.append({"threshold": t, "coverage": round(len(acc) / max(n_linkable, 1), 4),
                    "precision": round(1 - wrong / len(acc), 4) if acc else None, "decisions": len(acc)})
    return pts


# ------------------------------------------------------------------- pipeline
def load_worlds(quick=False):
    from .datasets import bpi, demo, synthetic
    syn = synthetic.worlds(n=10 if quick else 40)
    bp = bpi.worlds()
    if quick:
        bp = bp[:12]
    return syn, bp, [demo.world()]


def train_kind(kind, syn, bp, dm, seed=11, log=print):
    t0 = time.time()
    rows_by_source, blocking, linkable, truth_count = defaultdict(list), defaultdict(list), defaultdict(set), defaultdict(int)
    for w in syn + bp + dm:
        rows, stats, link_from, _ = build_rows(w, kind)
        rows_by_source[w["source"]].extend(rows)
        blocking[w["source"]].append(stats)
        linkable[w["group"]] = link_from
        truth_count[w["group"]] = stats["truePairs"]
    log(f"[{kind}] featurized in {time.time() - t0:.0f}s: " +
        ", ".join(f"{s}={len(r)}" for s, r in rows_by_source.items()))
    split_of = {}
    split_of.update(assign_splits({w["group"] for w in syn}, seed))
    split_of.update(assign_splits({w["group"] for w in bp}, seed + 1))
    split_of["demo"] = "holdout"
    keys = FEATURES[kind]
    all_rows = [r for rs in rows_by_source.values() for r in rs]
    part = defaultdict(list)
    for r in all_rows:
        part[split_of[r["group"]]].append(r)
    X = {k: np.array(vectorize(kind, [r["f"] for r in v]), float) for k, v in part.items()}
    Y = {k: np.array([r["y"] for r in v]) for k, v in part.items()}
    G = {k: [r["group"] for r in v] for k, v in part.items()}

    # ---- fit challengers on train, compare on valid
    lr = fit_logistic(X["train"], Y["train"])
    xg = fit_xgb(X["train"], Y["train"], X["valid"], Y["valid"], keys, seed)
    hgb = fit_hgb(X["train"], Y["train"], seed)
    margins = {
        "logistic_regression": lambda A: logistic_margin(lr, A),
        "xgboost": lambda A: xgb_margin(xg, A, keys),
        "hist_gradient_boosting": lambda A: hgb.decision_function(A),
    }
    comparison = {}
    calibrators = {}
    for name, fn in margins.items():
        mv = fn(X["valid"])
        rk = ranking(mv, Y["valid"])
        calib_fit, cv = cal.choose_calibrator(mv, Y["valid"], G["valid"])
        calibrators[name] = calib_fit
        comparison[name] = {"validPrAuc": rk["prAuc"], "validRocAuc": rk["rocAuc"],
                            "calibrator": calib_fit["method"], "calibrationCv": cv,
                            "validBrierCalibrated": cv[calib_fit["method"]]["brier"]}
    deployable = ["logistic_regression", "xgboost"]
    best_any = max(comparison, key=lambda k: (round(comparison[k]["validPrAuc"], 3), -comparison[k]["validBrierCalibrated"]))
    chosen = max(deployable, key=lambda k: (round(comparison[k]["validPrAuc"], 3), -comparison[k]["validBrierCalibrated"],
                                            k == "xgboost"))
    log(f"[{kind}] valid: " + ", ".join(f"{k} prAuc={v['validPrAuc']:.4f} brier={v['validBrierCalibrated']:.4f} ({v['calibrator']})"
                                       for k, v in comparison.items()) + f" -> {chosen}")

    def thresholds_for(name):
        calib_fit = calibrators[name]
        pc = cal.apply(calib_fit, margins[name](X["calib"]))
        pos = pc[Y["calib"] == 1]
        tau_r = min(max(cal.conformal_review_threshold(pos, ALPHA_REVIEW), REVIEW_FLOOR), 0.5)
        th = {"review": float(tau_r), "margin": MARGIN, "auto": None}
        table = decision_table(kind, part["calib"], pc, th)
        scores = [d["score"] for d in table if d["score"] is not None]
        wrong = [d["wrong"] for d in table if d["score"] is not None]
        ltt = cal.ltt_threshold(scores, wrong, alpha=1 - TARGET_PRECISION, delta=DELTA,
                                min_threshold=max(0.5, th["review"]))
        th["auto"] = ltt["threshold"]
        return th, ltt, pc

    def evaluate_model(name, th):
        calib_fit = calibrators[name]
        results, rel_all = {}, None
        test_rows = part["test"]
        pt = cal.apply(calib_fit, margins[name](X["test"]))
        truth_total = sum(truth_count[g] for g in set(G["test"]))
        link_from = set().union(*[linkable[g] for g in set(G["test"])]) if G["test"] else set()
        overall, rel_all = evaluate(kind, test_rows, pt, th, truth_total, link_from)
        overall["coverageCurve"] = coverage_curve(kind, test_rows, pt, th, len(link_from))
        results["overall"] = overall
        by_source = []
        for src in ("synthetic", "bpi2019"):
            idx = [i for i, r in enumerate(test_rows) if r["source"] == src]
            if not idx:
                continue
            rs = [test_rows[i] for i in idx]
            gs = {r["group"] for r in rs}
            m, _ = evaluate(kind, rs, pt[idx], th, sum(truth_count[g] for g in gs), set().union(*[linkable[g] for g in gs]))
            by_source.append({"source": src, **m})
        if part.get("holdout"):
            hd = part["holdout"]
            ph = cal.apply(calib_fit, margins[name](X["holdout"]))
            m, _ = evaluate(kind, hd, ph, th, truth_count["demo"], linkable["demo"], boot=False)
            m["note"] = "single curated world; no group bootstrap possible"
            by_source.append({"source": "demo", **m})
        results["bySource"] = by_source
        return results, rel_all

    th, ltt, _ = thresholds_for(chosen)
    results, reliability = evaluate_model(chosen, th)
    base_th, base_ltt, _ = thresholds_for("logistic_regression")
    base_results, _ = evaluate_model("logistic_regression", base_th)
    return {
        "kind": kind, "chosen": chosen, "bestAny": best_any, "comparison": comparison, "thresholds": th,
        "ltt": ltt, "results": results, "reliability": reliability,
        "baseline": {"algorithm": "logistic_regression", "thresholds": base_th, "ltt": {k: v for k, v in base_ltt.items() if k != "trace"},
                     "metrics": {k: v for k, v in base_results["overall"].items() if k != "coverageCurve"},
                     "bySource": base_results["bySource"]},
        "models": {"logistic_regression": lr, "xgboost": xg}, "calibrators": calibrators,
        "blocking": {s: {"pairCompleteness": round(float(np.mean([b["pairCompleteness"] for b in v if b["pairCompleteness"] is not None] or [0])), 4),
                         "reductionRatio": round(float(np.mean([b["reductionRatio"] for b in v])), 4),
                         "truePairs": int(sum(b["truePairs"] for b in v)), "candidatePairs": int(sum(b["candidatePairs"] for b in v))}
                     for s, v in blocking.items()},
        "data": {"sources": [{"name": s, "pairs": len(r), "positives": int(sum(x["y"] for x in r)),
                              "groups": len({x["group"] for x in r})} for s, r in rows_by_source.items()],
                 "splits": {k: {"pairs": len(v), "groups": len(set(G[k])), "positives": int(Y[k].sum())} for k, v in part.items()}},
        "featureImportance": _importance(chosen, lr, xg, keys),
    }


def _importance(chosen, lr, xg, keys):
    if chosen == "xgboost":
        gain = xg.get_score(importance_type="gain")
        total = sum(gain.values()) or 1.0
        return sorted(({"feature": k, "gainShare": round(v / total, 4)} for k, v in gain.items()), key=lambda d: -d["gainShare"])[:12]
    coef = np.abs(np.asarray(lr["coef"]))
    return sorted(({"feature": k, "absStdCoef": round(float(c), 4)} for k, c in zip(keys, coef)), key=lambda d: -d["absStdCoef"])[:12]


PROVENANCE = {
    "synthetic": "synthetic — seeded generator (satya_engine.linking.datasets.synthetic); upper bound / regression test only",
    "bpi2019": "BPI-2019 derived — real P2P transaction structure from the BPI Challenge 2019 log (van Dongen, 4TU, CC BY 4.0); synthetic Indian identities, numbers, GST/TDS",
    "demo": "demo — Satya curated demo dataset (CONSTRUCTED_DEMO), held out from all fitting; sanity check only",
}
LIMITATIONS = [
    "No real customer data: every number here is synthetic, BPI-2019-derived (real structure, synthetic identities) or curated-demo. None of it is a real-company accuracy claim.",
    "The ≥99% auto-link precision guarantee (Learn-then-Test) holds only if deployment data are exchangeable with the calibration data; on a real tenant it must be re-certified on that tenant's reviewed links (shadow mode + audit slice).",
    "Printed references (PO numbers on invoices, invoice numbers in narrations) are simulated at fixed rates; real rates vary by supplier and change performance a lot.",
    "BPI-2019 quantities, rates, GST and TDS are synthesised from real net worth; descriptions are spend-area texts (low diversity).",
    "The demo hold-out is one small curated world (tens of links); its numbers have very wide uncertainty.",
    "Decisions are per from-document (invoice/GRN) and per pair (payment); one invoice billing several POs is not modelled.",
]


def write_artifacts(out, models_dir=MODELS_DIR, log=print):
    kind = out["kind"]
    task = TASK_OF[kind]
    d = Path(models_dir) / task
    d.mkdir(parents=True, exist_ok=True)
    chosen = out["chosen"]
    version = f"{task}-{VERSION_DATE}"
    if chosen == "xgboost":
        out["models"]["xgboost"].save_model(str(d / "model.json"))
    else:
        (d / "model.json").write_text(json.dumps(out["models"]["logistic_regression"]))
    overall = out["results"]["overall"]
    metrics = {k: overall[k] for k in ("precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "eceEqualMass")}
    metrics["ci"] = {"precision": overall["ci"]["precision"], "recall": overall["ci"]["recall"]}
    metrics.update({"autoRate": overall["autoRate"], "suggestRecall": overall["suggestRecall"],
                    "precisionWilson": overall["precisionWilson"]})
    sources = [{"name": s["name"], "provenance": PROVENANCE[s["name"]], "pairs": s["pairs"],
                "positives": s["positives"], "groups": s["groups"]} for s in out["data"]["sources"]]
    th = out["thresholds"]
    card = {
        "id": task, "task": task, "kind": kind, "title": TITLES[kind], "version": version,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "algorithm": chosen, "modelFile": "model.json", "featureKeys": FEATURES[kind],
        "calibrator": out["calibrators"][chosen], "thresholds": th,
        "operatingPoint": {"threshold": th["auto"], "reviewThreshold": th["review"], "ambiguityMargin": th["margin"],
                           "targetPrecision": TARGET_PRECISION, "delta": DELTA,
                           "method": "Learn-then-Test conformal risk control (fixed-sequence exact binomial tests) on the calibration split; "
                                     "review threshold = split-conformal 2% quantile of true-link scores, floored at 0.05 to bound reviewer load"},
        "baseline": {"algorithm": "logistic_regression", "metrics": {k: out["baseline"]["metrics"].get(k) for k in ("precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "autoRate")}},
        "data": {"sources": sources, "splits": out["data"]["splits"],
                 "splitPolicy": "group-disjoint by buyer world: train 50% / valid 15% / calib 15% / test 20%; demo held out"},
        "metrics": metrics, "explanations": "TreeSHAP" if chosen == "xgboost" else "linear SHAP (exact for logistic)",
        "limitations": LIMITATIONS, "intendedUse": (
            "Propose evidence links between AP documents that lack explicit references. Auto-zone links are written "
            "as PROBABLE (never CONFIRMED) and stay reversible; review-zone links go to a person. Not for payment "
            "release decisions on its own; not validated on real company data."),
        "selection": "highest validation PR-AUC among deployable models (logistic, XGBoost), calibrated-Brier tie-break; "
                     "HistGradientBoosting is a non-deployable challenger (no exact per-decision attributions)",
    }
    evaluation = {
        "generatedAt": card["trainedAt"], "task": task, "version": version, "algorithm": chosen,
        "comparison": out["comparison"], "bestAnyAlgorithm": out["bestAny"],
        "thresholds": th, "ltt": out["ltt"], "test": out["results"]["overall"], "reliability": out["reliability"],
        "bySource": out["results"]["bySource"], "baseline": out["baseline"], "blocking": out["blocking"],
        "featureImportance": out["featureImportance"], "data": card["data"], "limitations": LIMITATIONS,
    }
    (d / "model_card.json").write_text(json.dumps(card, indent=1, default=float))
    (d / "evaluation.json").write_text(json.dumps(evaluation, indent=1, default=float))
    log(f"[{kind}] wrote {d} ({chosen}, auto>={th['auto']}, review>={th['review']:.3f}); "
        f"test precision={metrics['precision']} recall={metrics['recall']} prAuc={metrics['prAuc']:.4f}")
    return card, evaluation


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--kinds", default=",".join(KINDS))
    parser.add_argument("--out", default=str(MODELS_DIR))
    args = parser.parse_args(argv)
    t0 = time.time()
    syn, bp, dm = load_worlds(args.quick)
    print(f"worlds: synthetic={len(syn)} bpi={len(bp)} demo={len(dm)} ({time.time() - t0:.0f}s)")
    for kind in args.kinds.split(","):
        out = train_kind(kind, syn, bp, dm)
        write_artifacts(out, args.out)


if __name__ == "__main__":
    main()
