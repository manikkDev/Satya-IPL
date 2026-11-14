"""Offline evaluation of anomaly screening and supplier dedupe (synthetic, injected).

    python -m satya_engine.screening_eval

Screening: synthetic worlds with injected typologies (price spike +25..60%,
split billing just under a limit, first payment to a new bank account) ->
per-typology recall and precision@flags, plus the false-alarm rate on clean
worlds. Dedupe: a synthetic supplier master with injected duplicates (name
variants, transliteration, missing identifiers, shared bank) and PAN-sharing
branches -> pair precision/recall of the duplicate and possible zones.
Provenance: synthetic only. Prevalence is set by the injection rate.
"""
import json
import zlib
import random
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from .linking.datasets import synthetic
from .linking.datasets.common import make_gstin, make_supplier
from .linking.metrics import wilson
from .match.supplier_fs import duplicates
from .screening import run_screening

D = Decimal
ROOT = Path(__file__).resolve().parents[1] / "models"
USE_EM = False


def _inject(world, rng):
    docs = world["documents"]
    truth = defaultdict(set)  # code -> doc ids
    invoices = [d for d in docs if d["type"] == "INVOICE_IN"]
    for d in rng.sample(invoices, k=max(1, len(invoices) // 40)):  # price spike
        line = d["lines"][0]
        line["rate"] = str((D(line["rate"]) * D(str(rng.choice([1.25, 1.35, 1.6])))).quantize(D("0.01")))
        truth["SCREEN_PRICE_OUTLIER"].add(d["id"])
    by_sup = defaultdict(list)
    for d in invoices:
        by_sup[d["seller"].get("pan") or d["seller"]["name"]].append(d)
    for sup in rng.sample(sorted(by_sup), k=max(1, len(by_sup) // 4)):  # split billing
        base = by_sup[sup][0]
        day = date.fromisoformat(base["date"])
        limit = rng.choice([D("100000"), D("200000"), D("500000")])
        for k in range(rng.choice([2, 3])):
            amount = (limit * D(str(rng.choice([0.955, 0.97, 0.985, 0.994])))).quantize(D("1")) + D(rng.randint(0, 99))
            new = json.loads(json.dumps(base))
            new.update({"id": f"{base['id']}_split{k}", "number": f"{base['number']}-S{k}",
                        "date": (day + timedelta(days=3 * k)).isoformat()})
            new["totals"] = dict(new["totals"], grand=str(amount))
            docs.append(new)
            truth["SCREEN_BELOW_APPROVAL_LIMIT"].add(new["id"])
    pays = defaultdict(list)
    for d in docs:
        if d["type"] == "PAYMENT_OUT":
            d["payment"]["bankAccountMasked"] = "****" + str(zlib.crc32((d["seller"].get("pan") or d["seller"]["name"]).encode()) % 9000 + 1000)
            pays[d["seller"].get("pan") or d["seller"]["name"]].append(d)
    for sup in rng.sample(sorted(pays), k=max(1, len(pays) // 5)):  # bank change
        rows = sorted(pays[sup], key=lambda d: d["date"])
        if len(rows) >= 3:
            new_account = "****" + str(rng.randint(1000, 9999))
            for d in rows[len(rows) // 2:]:
                d["payment"]["bankAccountMasked"] = new_account
            truth["SCREEN_NEW_BANK_ACCOUNT_PAYMENT"].add(rows[len(rows) // 2]["id"])
    for d in docs:  # give every supplier a stable supplierId for grouping
        d["seller"]["supplierId"] = d["seller"].get("pan") or d["seller"]["name"]
        d.setdefault("fy", "2025-26")
    return truth


def screening_eval(n=12, seed=5):
    rng = random.Random(seed)
    stats = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "flags": 0})
    clean_flags, clean_docs = 0, 0
    for i, w in enumerate(synthetic.worlds(n=n, seed=seed)):
        if i % 4 == 3:  # clean control world
            for d in w["documents"]:
                d["seller"]["supplierId"] = d["seller"].get("pan") or d["seller"]["name"]
                d.setdefault("fy", "2025-26")
            flags = run_screening(w["documents"])
            clean_flags += len(flags)
            clean_docs += len(w["documents"])
            continue
        truth = _inject(w, rng)
        flags = run_screening(w["documents"])
        for code in ("SCREEN_PRICE_OUTLIER", "SCREEN_BELOW_APPROVAL_LIMIT", "SCREEN_NEW_BANK_ACCOUNT_PAYMENT"):
            mine = [f for f in flags if f["code"] == code]
            flagged = {e["documentId"] for f in mine for e in f["evidence"]}
            s = stats[code]
            s["flags"] += len(mine)
            s["tp"] += len(truth[code] & flagged)
            s["fn"] += len(truth[code] - flagged)
            s["fp"] += sum(1 for f in mine if not ({e["documentId"] for e in f["evidence"]} & truth[code]))
    out = []
    for code, s in stats.items():
        flags_ok = s["flags"] - s["fp"]
        out.append({"code": code, "recall": round(s["tp"] / (s["tp"] + s["fn"]), 4) if s["tp"] + s["fn"] else None,
                    "precisionAtFlags": round(flags_ok / s["flags"], 4) if s["flags"] else None,
                    "precisionWilson95": wilson(flags_ok, s["flags"]), "flags": s["flags"], "injected": s["tp"] + s["fn"]})
    return {"typologies": out, "cleanWorldFlagsPer1000Docs": round(1000 * clean_flags / max(clean_docs, 1), 2)}


def _variant(rng, name):
    swaps = [("Engineering", "Engg."), ("Industries", "Inds"), ("Private Limited", "Pvt. Ltd."),
             ("Pvt Ltd", "Private Limited"), ("Shree", "Shri"), ("Traders", "Trading Co")]
    out = name
    for a, b in swaps:
        if a in out:
            out = out.replace(a, b)
    if rng.random() < 0.4:
        out = "M/s " + out.upper()
    return out


def dedupe_eval(n=400, seed=8):
    rng = random.Random(seed)
    recs, dup_pairs, branch_pairs = [], set(), set()
    for i in range(n):
        s = make_supplier(rng, i)
        rec = {"id": f"s{i}", "name": s["name"], "pan": s["pan"], "gstins": [s["gstins"][0]],
               "pincode": str(rng.randint(110001, 799999)), "bankHashes": [f"h{i}"]}
        recs.append(rec)
        roll = rng.random()
        if roll < 0.12:  # duplicate record, partial identifiers
            dup = {"id": f"s{i}d", "name": _variant(rng, s["name"]),
                   "pan": s["pan"] if rng.random() < 0.6 else None,
                   "gstins": [s["gstins"][0]] if rng.random() < 0.5 else [],
                   "pincode": rec["pincode"] if rng.random() < 0.7 else None,
                   "bankHashes": [f"h{i}"] if rng.random() < 0.5 else []}
            recs.append(dup)
            dup_pairs.add(tuple(sorted((rec["id"], dup["id"]))))
        elif roll < 0.18:  # branch: same PAN, other-state GSTIN
            other = make_gstin("29" if s["state"] != "29" else "27", s["pan"], 2)
            recs.append({"id": f"s{i}b", "name": s["name"], "pan": s["pan"], "gstins": [other],
                         "pincode": str(rng.randint(110001, 799999)), "bankHashes": [f"h{i}b"]})
            branch_pairs.add(tuple(sorted((rec["id"], f"s{i}b"))))
    result = duplicates(recs, use_em=USE_EM)
    dup_pred = {tuple(sorted((a, b))) for c in result["clusters"] for a in c["supplierIds"] for b in c["supplierIds"] if a < b}
    poss_pred = {tuple(sorted((v["a"], v["b"]))) for v in result["possible"]}
    branch_pred = {tuple(sorted((a, b))) for e in result["sameLegalEntity"] for a in e["supplierIds"] for b in e["supplierIds"] if a < b}

    def pr(pred, truth):
        tp = len(pred & truth)
        return {"precision": round(tp / len(pred), 4) if pred else None, "recall": round(tp / len(truth), 4) if truth else None,
                "predicted": len(pred), "truth": len(truth)}
    return {"records": len(recs), "duplicateZone": pr(dup_pred, dup_pairs),
            "duplicateOrPossible": pr(dup_pred | poss_pred, dup_pairs),
            "branchesAsDuplicates": len(dup_pred & branch_pairs), "branchDetection": pr(branch_pred, branch_pairs),
            "parameters": result["parameters"], "thresholds": result["thresholds"]}


def main():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    anomaly = {"generatedAt": now, "task": "anomaly_screening", "provenance": "synthetic (injected typologies)",
               **screening_eval(),
               "policy": "screening findings are severity low/medium, certainty POSSIBLE, and never change the case recommendation",
               "limitations": ["Injected typologies only; real fraud is rarer, adaptive and unlabelled",
                               "Benford screen needs >= 60 amounts per supplier-FY and is not evaluated per invoice",
                               "Precision depends on the injection prevalence chosen here"]}
    global USE_EM
    USE_EM = True
    em_variant = dedupe_eval()
    USE_EM = False
    dedupe = {"generatedAt": now, "task": "supplier_dedupe", "provenance": "synthetic supplier master with injected duplicates/branches",
              **dedupe_eval(), "method": "Fellegi-Sunter + union-find (satya_engine.match.supplier_fs), documented m/u priors",
              "emVariant": {"note": "label-free EM re-estimation of m/u (fastLink/Splink style) over the blocked pairs converged to a "
                                    "'similar name' latent class on this master and is therefore OFF by default",
                            "duplicateZone": em_variant["duplicateZone"]},
              "limitations": ["Synthetic names from a small vocabulary; real masters have more variety and Indic scripts",
                              "Transliteration is rule-based (Devanagari only), not IndicXlit"]}
    for task, body in (("anomaly", anomaly), ("supplier_dedupe", dedupe)):
        (ROOT / task).mkdir(parents=True, exist_ok=True)
        (ROOT / task / "evaluation.json").write_text(json.dumps(body, indent=1))
    print(json.dumps({"anomaly": anomaly["typologies"], "clean": anomaly["cleanWorldFlagsPer1000Docs"],
                      "dedupe": {k: dedupe[k] for k in ("duplicateZone", "duplicateOrPossible", "branchesAsDuplicates", "branchDetection")}}, indent=1))


if __name__ == "__main__":
    main()
