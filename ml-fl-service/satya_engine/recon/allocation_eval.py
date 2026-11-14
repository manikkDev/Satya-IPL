"""Offline evaluation of payment allocation (python -m satya_engine.recon.allocation_eval).

For every payment in the synthetic and BPI-2019-derived worlds, the open
invoices of the same supplier (PAN) dated on or before the payment and not
settled by an earlier payment form the pool; the narration is passed through.
Ground truth = the generator's SETTLES set. Compared with the legacy solver
(exact brute-force subset-sum, <= 20 candidates, no tolerance).
"""
import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from itertools import combinations
from pathlib import Path

import numpy as np

from ..contracts_v2 import AllocatePaymentRequest
from ..linking.metrics import wilson
from .allocate import allocate

OUT = Path(__file__).resolve().parents[2] / "models" / "allocation" / "evaluation.json"


def _legacy(pay, pool):
    if len(pool) > 20:
        return None
    sols = []
    amounts = [(i, Decimal(a)) for i, a in pool]
    for r in range(1, len(amounts) + 1):
        for combo in combinations(amounts, r):
            if sum(a for _, a in combo) == Decimal(pay):
                sols.append({i for i, _ in combo})
                if len(sols) >= 10:
                    return sols
    return sols


def cases(world):
    docs = {d["id"]: d for d in world["documents"]}
    truth = defaultdict(set)
    for l in world["links"]:
        if l["kind"] == "SETTLES":
            truth[l["fromId"]].add(l["toId"])
    settled_by = defaultdict(list)
    for pid, invs in truth.items():
        for i in invs:
            settled_by[i].append(docs[pid]["date"])
    pan_of = lambda d: (d["seller"].get("pan") or (d["seller"].get("gstin") or "")[2:12] or d["seller"]["name"])
    payments = sorted((docs[p] for p in truth), key=lambda d: (d["date"], d["id"]))
    for pay in payments:
        true_set = truth[pay["id"]]
        pan = pan_of(docs[next(iter(true_set))])
        pool = [d for d in docs.values() if d["type"] == "INVOICE_IN" and pan_of(d) == pan
                and d["date"] <= pay["date"] and not any(day < pay["date"] for day in settled_by[d["id"]])]
        if not all(t in {p["id"] for p in pool} for t in true_set):
            continue  # split payments / invoice dated after payment: outside this protocol
        yield pay, pool, true_set


def run(worlds):
    rows = []
    for w in worlds:
        for pay, pool, true_set in cases(w):
            body = {"payment": {"id": pay["id"], "amount": {"amount": pay["payment"]["amount"], "currency": "INR"},
                                "date": pay["date"], "utr": pay["payment"].get("utr"),
                                "narration": pay["payment"].get("narration"),
                                **({"tdsAmount": {"amount": pay["payment"]["tdsAmount"], "currency": "INR"}}
                                   if pay["payment"].get("tdsAmount") else {})},
                    "openInvoices": [{"id": d["id"], "number": d["number"], "date": d["date"],
                                      "openAmount": {"amount": d["totals"]["grand"], "currency": "INR"},
                                      "taxableAmount": {"amount": d["totals"]["taxable"], "currency": "INR"}}
                                     for d in pool]}
            t0 = time.perf_counter()
            try:
                out = allocate(AllocatePaymentRequest.model_validate(body))
            except ValueError:
                out = {"solutions": [], "certainty": "INSUFFICIENT_EVIDENCE", "ambiguous": False}
            ms = (time.perf_counter() - t0) * 1000
            best = {a["documentId"] for a in out["solutions"][0]["allocations"]} if out["solutions"] else None
            auto = out["certainty"] in ("CONFIRMED", "PROBABLE") and not out.get("ambiguous")
            gross = Decimal(pay["payment"]["amount"]) + Decimal(pay["payment"].get("tdsAmount") or "0")
            legacy = _legacy(str(gross), [(d["id"], d["totals"]["grand"]) for d in pool])
            rows.append({"source": w["source"], "group": w["group"], "pool": len(pool), "k": len(true_set),
                         "correct": best == true_set, "auto": auto, "confirmed": out["certainty"] == "CONFIRMED",
                         "found": best is not None, "ms": ms,
                         "legacyCorrect": bool(legacy) and len(legacy) == 1 and legacy[0] == true_set,
                         "legacyAnswered": bool(legacy) and len(legacy) == 1})
    return rows


def summarize(rows):
    n = len(rows)
    auto = [r for r in rows if r["auto"]]
    leg = [r for r in rows if r["legacyAnswered"]]
    return {
        "payments": n,
        "exactAllocationAccuracy": round(sum(r["correct"] for r in rows) / n, 4) if n else None,
        "autoRate": round(len(auto) / n, 4) if n else None,
        "autoPrecision": round(sum(r["correct"] for r in auto) / len(auto), 4) if auto else None,
        "autoPrecisionWilson95": wilson(sum(r["correct"] for r in auto), len(auto)),
        "confirmedRate": round(sum(r["confirmed"] for r in rows) / n, 4) if n else None,
        "abstentionRate": round(sum(not r["found"] for r in rows) / n, 4) if n else None,
        "multiInvoiceShare": round(sum(r["k"] > 1 for r in rows) / n, 4) if n else None,
        "latencyMsP50": round(float(np.percentile([r["ms"] for r in rows], 50)), 2) if n else None,
        "latencyMsP95": round(float(np.percentile([r["ms"] for r in rows], 95)), 2) if n else None,
        "legacy": {"answeredRate": round(len(leg) / n, 4) if n else None,
                   "exactAllocationAccuracy": round(sum(r["legacyCorrect"] for r in rows) / n, 4) if n else None,
                   "precisionWhenAnswered": round(sum(r["legacyCorrect"] for r in leg) / len(leg), 4) if leg else None,
                   "algorithm": "exact brute-force subset-sum, <= 20 candidates, no TDS/bank tolerance"},
    }


def main():
    from ..linking.datasets import bpi, synthetic
    worlds = synthetic.worlds(n=12, seed=99) + bpi.worlds()[:20]
    rows = run(worlds)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "task": "payment_allocation", "algorithm": "score-then-solve (plausibility + exact paise subset search, tolerance modes, ambiguity margin)",
        "protocol": "per payment: same-supplier invoices open at the payment date form the pool; truth = generator SETTLES set; "
                    "split payments (partial settlement) excluded from this protocol",
        "overall": summarize(rows),
        "bySource": [{"source": s, "provenance": {"synthetic": "synthetic", "bpi2019": "BPI-2019 derived"}[s],
                      **summarize([r for r in rows if r["source"] == s])} for s in ("synthetic", "bpi2019")],
        "limitations": ["Synthetic / BPI-derived payments only; real remittance behaviour differs",
                        "Pool restricted to the true supplier (mirrors the server's same-counterparty ranking)",
                        "Partial/split payments are not scored here (they always go to review)"],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1))
    print(json.dumps(report["overall"], indent=1))
    for s in report["bySource"]:
        print(s["source"], {k: s[k] for k in ("payments", "exactAllocationAccuracy", "autoRate", "autoPrecision", "abstentionRate")})


if __name__ == "__main__":
    main()
