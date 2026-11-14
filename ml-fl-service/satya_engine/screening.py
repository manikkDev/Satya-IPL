"""Anomaly screening signals, emitted as low/medium POSSIBLE findings.

These rank attention; they never block a payment by themselves (case
recommendation ignores them). Every signal carries a plain explanation:
  SCREEN_PRICE_OUTLIER       unit rate far from the supplier+item history
                             (modified z = 0.6745 |x - median| / MAD >= 3.5,
                             Iglewicz & Hoaglin; corroborated by an Isolation
                             Forest when >= 50 observations, Liu et al. 2008)
  SCREEN_BELOW_APPROVAL_LIMIT repeated invoices just under a common approval
                             limit from one supplier within 30 days (split-billing pattern)
  SCREEN_BENFORD_FIRST_DIGIT first-digit distribution of a supplier-FY's
                             amounts departs from Benford (Nigrini MAD > 0.015,
                             >= 60 amounts) - a portfolio screen with known false positives
  SCREEN_NEW_BANK_ACCOUNT_PAYMENT first payment to a newly seen bank account,
                             scored by recency of the change and size vs usual payments
"""
import math
from collections import defaultdict
from datetime import date
from decimal import Decimal
from statistics import median

D = Decimal
RULE = "screening-v1"
MIN_HISTORY = 5
IF_MIN = 50
APPROVAL_LIMITS = (D("50000"), D("100000"), D("200000"), D("500000"), D("1000000"))
BENFORD = [math.log10(1 + 1 / d) for d in range(1, 10)]
LIVE = lambda d: d.get("status") not in {"reversed", "cancelled", "draft"}  # noqa: E731


def _finding(code, severity, message, evidence, amount=None):
    return {"code": code, "severity": severity, "certainty": "POSSIBLE", "message": message,
            "evidence": evidence, "amount": amount, "ruleVersion": RULE}


def _supplier(d):
    s = d.get("seller") or {}
    return s.get("supplierId") or s.get("gstin") or (s.get("name") or "").lower()


def _item_key(line):
    if line.get("itemId") or line.get("sku"):
        return "sku:" + str(line.get("itemId") or line.get("sku")).lower()
    from .linking.normalize import tokens
    return (line.get("hsn") or "") + ":" + " ".join(sorted(set(tokens(line.get("description")))))


def price_outliers(docs):
    obs = defaultdict(list)
    for d in docs:
        if d["type"] not in ("INVOICE_IN", "PO") or not LIVE(d):
            continue
        for line in d.get("lines") or []:
            if line.get("rate") and line.get("qty"):
                rate = D(str(line["rate"]))
                if rate > 0:
                    obs[(_supplier(d), _item_key(line))].append((d, line, rate))
    findings = []
    for (supplier, item), rows in obs.items():
        if len(rows) < MIN_HISTORY + 1:
            continue
        rates = [float(r[2]) for r in rows]
        med = median(rates)
        mad = median([abs(r - med) for r in rates])
        # scale floor: 2.5% of the median, so routine +/-3% negotiation noise on a
        # very stable price history is not an "outlier" (z >= 3.5 needs ~13%)
        mad = max(mad, med * 0.025, 1e-9)
        forest = None
        if len(rows) >= IF_MIN:
            import numpy as np
            from sklearn.ensemble import IsolationForest
            X = np.array([[math.log(r)] for r in rates])
            forest = IsolationForest(n_estimators=100, random_state=0).fit(X)
            iso = -forest.score_samples(X)
            cutoff = float(np.quantile(iso, 0.98))
        for i, (d, line, rate) in enumerate(rows):
            if d["type"] != "INVOICE_IN":
                continue
            z = 0.6745 * abs(float(rate) - med) / mad
            direction = "above" if float(rate) > med else "below"
            pct = abs(float(rate) - med) / med * 100 if med else 0
            if z < 3.5 or pct < 10 or (forest is not None and iso[i] < cutoff):
                continue
            findings.append(_finding(
                "SCREEN_PRICE_OUTLIER", "medium" if direction == "above" and pct >= 15 else "low",
                f"Screening signal: {d.get('number') or d['id']} line {line.get('lineNo')} rate ₹{rate} is "
                f"{pct:.0f}% {direction} this supplier's median ₹{med:.2f} for the item over {len(rows)} lines "
                f"(modified z {z:.1f}{'; isolation forest agrees' if forest is not None else ''}). "
                "Check for a price revision or contract rate before paying.",
                [{"documentId": d["id"], "lineNo": line.get("lineNo"), "field": "rate"}],
                str(((rate - D(str(med))) * D(str(line.get("qty")))).quantize(D("0.01"))) if direction == "above" else None))
    return findings


def below_approval_limit(docs):
    by_supplier = defaultdict(list)
    for d in docs:
        if d["type"] == "INVOICE_IN" and LIVE(d) and d.get("totals") and d.get("date"):
            by_supplier[_supplier(d)].append(d)
    findings = []
    for supplier, invs in by_supplier.items():
        for limit in APPROVAL_LIMITS:
            near = sorted((d for d in invs if limit * D("0.95") <= D(str(d["totals"]["grand"])) < limit),
                          key=lambda d: d["date"])
            best = []
            for i, d in enumerate(near):
                window = [x for x in near[i:] if (date.fromisoformat(x["date"]) - date.fromisoformat(d["date"])).days <= 30]
                if len(window) > len(best):
                    best = window
            if len(best) >= 2:
                total = sum(D(str(x["totals"]["grand"])) for x in best)
                findings.append(_finding(
                    "SCREEN_BELOW_APPROVAL_LIMIT", "medium" if len(best) >= 3 else "low",
                    f"Screening signal: {len(best)} invoices from one supplier within 30 days are each just under "
                    f"₹{limit:,.0f} (a common approval limit), together ₹{total:,.2f}. Possible split billing — "
                    "confirm they are separate supplies.",
                    [{"documentId": x["id"], "field": "totals.grand"} for x in best], str(total)))
                break
    return findings


def benford(docs, min_n=60):
    groups = defaultdict(list)
    for d in docs:
        if d["type"] != "INVOICE_IN" or not LIVE(d):
            continue
        key = (_supplier(d), d.get("fy"))
        for line in d.get("lines") or []:
            value = line.get("taxableValue") or line.get("lineTotal")
            if value:
                groups[key].append((d["id"], D(str(value))))
    findings = []
    for (supplier, fy), values in groups.items():
        digits = [int(str(v).lstrip("0.")[0]) for _, v in values if v >= 10 and str(v).lstrip("0.")[:1].isdigit()]
        digits = [x for x in digits if 1 <= x <= 9]
        if len(digits) < min_n:
            continue
        observed = [digits.count(k) / len(digits) for k in range(1, 10)]
        mad = sum(abs(o - e) for o, e in zip(observed, BENFORD)) / 9
        if mad > 0.015:
            worst = max(range(9), key=lambda k: observed[k] - BENFORD[k])
            findings.append(_finding(
                "SCREEN_BENFORD_FIRST_DIGIT", "low",
                f"Screening signal: first digits of {len(digits)} line amounts for this supplier in FY {fy} depart from "
                f"Benford's law (MAD {mad:.3f} > 0.015; digit {worst + 1} appears {observed[worst]:.0%} vs expected "
                f"{BENFORD[worst]:.0%}). Portfolio-level screen only — common for fixed-price items; no per-invoice conclusion.",
                [{"documentId": doc_id} for doc_id in sorted({i for i, _ in values})[:20]]))
    return findings


def new_bank_account_payment(docs, recent_days=30):
    pays = defaultdict(list)
    for d in docs:
        if d["type"] == "PAYMENT_OUT" and LIVE(d) and (d.get("payment") or {}).get("bankAccountMasked"):
            pays[_supplier(d)].append(d)
    findings = []
    for supplier, rows in pays.items():
        rows.sort(key=lambda d: (d["date"], d["id"]))
        seen, history = {}, []
        for d in rows:
            account = d["payment"]["bankAccountMasked"]
            amount = D(str(d["payment"].get("amount") or "0"))
            if seen and account not in seen:
                last_day, last_acct = max((v, k) for k, v in seen.items())
                gap = (date.fromisoformat(d["date"]) - date.fromisoformat(last_day)).days
                typical = median([float(a) for a in history]) if history else None
                ratio = float(amount) / typical if typical else None
                big = ratio is not None and ratio >= 1.5
                findings.append(_finding(
                    "SCREEN_NEW_BANK_ACCOUNT_PAYMENT", "medium" if (gap <= recent_days or big) else "low",
                    f"Screening signal: first payment to account {account} (previously {last_acct}, last used "
                    f"{gap} days earlier)" + (f"; amount is {ratio:.1f}x this supplier's typical payment" if ratio else "")
                    + ". Verify the bank-change instruction by a call-back to a known contact.",
                    [{"documentId": d["id"], "field": "payment.bankAccountMasked"}], str(amount)))
            seen[account] = d["date"]
            history.append(amount)
    return findings


def run_screening(docs, links=None):
    out = []
    for fn in (price_outliers, below_approval_limit, benford, new_bank_account_payment):
        try:
            out += fn(docs)
        except Exception:  # a screen must never break reconciliation
            continue
    return out
