"""Pairwise + candidate-set features for the three link kinds.

Every feature is a plain float; missing evidence is 0 with an explicit
`*_known` companion where absence itself is informative (tri-state
agreement: +1 agree, -1 conflict, 0 unknown). Money is compared in Decimal
and only converted to float ratios at the end.
"""
import math
from decimal import Decimal

from .normalize import desc_similarity, name_similarity, text_mentions

D = Decimal
TDS_RATES = (D("0.001"), D("0.01"), D("0.02"), D("0.05"), D("0.1"))
ONE_RUPEE = D("1")

COMMON = ["gstin_agree", "pan_agree", "name_sim", "ref_sim", "ref_exact",
          "date_gap", "date_gap_abs_log", "date_order_violation"]
LINE = ["line_match", "sku_jaccard", "hsn_agree", "qty_ratio", "qty_over", "rate_agree",
        "rate_rel_diff", "line_count_ratio", "value_ratio_log"]
CONTEXT = ["n_cands_log", "prescore_rank", "line_match_rank", "value_rank", "date_rank", "best_competitor_gap"]
PAYMENT = ["amt_exact", "amt_tds", "amt_bank_charge", "amt_ratio_log", "amt_partial",
           "amt_over", "due_gap_abs_log", "combo_member", "same_amount_cands", "amount_rank"]

FEATURES = {
    "BILLS": COMMON + LINE + ["amount_ratio_log"] + CONTEXT,
    "RECEIVES": COMMON + LINE + CONTEXT,
    "SETTLES": COMMON + PAYMENT + ["n_cands_log", "prescore_rank", "date_rank", "best_competitor_gap"],
}

# Monotone constraints (XGBoost): +1 more evidence -> never lower score.
MONOTONE = {
    "gstin_agree": 1, "pan_agree": 1, "name_sim": 1, "ref_sim": 1, "ref_exact": 1,
    "line_match": 1, "sku_jaccard": 1, "hsn_agree": 1, "rate_agree": 1,
    "amt_exact": 1, "amt_tds": 1, "combo_member": 1,
    "date_order_violation": -1, "qty_over": -1, "rate_rel_diff": -1,
}


def _tri(a, b):
    if not a or not b:
        return 0.0
    return 1.0 if a == b else -1.0


def _log_ratio(a, b):
    if a is None or b is None or a <= 0 or b <= 0:
        return 0.0
    return max(-3.0, min(3.0, math.log(float(a) / float(b))))


def common(frm, to):
    f = {}
    f["gstin_agree"] = _tri(frm.gstin, to.gstin)
    f["pan_agree"] = _tri(frm.pan, to.pan)
    f["name_sim"] = name_similarity(frm.party_name, to.party_name) if frm.party_name and to.party_name else 0.0
    f["ref_sim"] = text_mentions(frm.ref_text, to.number)
    f["ref_exact"] = 1.0 if f["ref_sim"] >= 0.999 else 0.0
    if frm.date and to.date:
        gap = (frm.date - to.date).days
        f["date_gap"] = float(max(-60, min(400, gap)))
        f["date_gap_abs_log"] = math.log1p(abs(gap))
        f["date_order_violation"] = 1.0 if gap < 0 else 0.0
    else:
        f["date_gap"], f["date_gap_abs_log"], f["date_order_violation"] = 0.0, 0.0, 0.0
    return f


def _line_sim(a, b):
    if a.sku and b.sku and a.sku.lower() == b.sku.lower():
        return 1.0
    sim = desc_similarity(a.desc, b.desc)
    if a.hsn and b.hsn and a.hsn[:4] == b.hsn[:4]:
        sim = min(1.0, sim + 0.05)
    return sim


def lines(frm, to):
    f = {k: 0.0 for k in LINE}
    if not frm.lines or not to.lines:
        return f
    matches = []
    for a in frm.lines:
        best, best_b = 0.0, None
        for b in to.lines:
            s = _line_sim(a, b)
            if s > best:
                best, best_b = s, b
        matches.append((a, best_b, best))
    f["line_match"] = sum(m[2] for m in matches) / len(matches)
    skus_a = {l.sku.lower() for l in frm.lines if l.sku}
    skus_b = {l.sku.lower() for l in to.lines if l.sku}
    f["sku_jaccard"] = len(skus_a & skus_b) / len(skus_a | skus_b) if skus_a and skus_b else 0.0
    hsn_a = {l.hsn[:4] for l in frm.lines if l.hsn}
    hsn_b = {l.hsn[:4] for l in to.lines if l.hsn}
    f["hsn_agree"] = len(hsn_a & hsn_b) / len(hsn_a) if hsn_a and hsn_b else 0.0
    qty_from = sum((m[0].qty for m in matches if m[1] is not None and m[0].qty is not None), D("0"))
    qty_to = sum((m[1].qty for m in matches if m[1] is not None and m[1].qty is not None), D("0"))
    f["qty_ratio"] = float(min(qty_from / qty_to, D("3"))) if qty_to > 0 else 0.0
    f["qty_over"] = 1.0 if any(m[1] is not None and m[0].qty is not None and m[1].qty is not None
                                and m[0].qty > m[1].qty * D("1.05") for m in matches) else 0.0
    rated = [(m[0].rate, m[1].rate) for m in matches if m[1] is not None and m[0].rate and m[1].rate]
    if rated:
        diffs = [abs(a - b) / b for a, b in rated]
        f["rate_agree"] = sum(1 for d in diffs if d <= D("0.01")) / len(diffs)
        f["rate_rel_diff"] = float(min(sum(diffs) / len(diffs), D("1")))
    f["line_count_ratio"] = len(frm.lines) / len(to.lines)
    from_value = sum((l.value for l in frm.lines if l.value is not None), D("0"))
    to_value = sum((l.value for l in to.lines if l.value is not None), D("0"))
    f["value_ratio_log"] = _log_ratio(from_value, to_value)
    return f


def _target(to):
    return to.open_amount if to.open_amount is not None else to.amount


def payment(frm, to):
    f = {k: 0.0 for k in PAYMENT}
    pay, inv = frm.amount, _target(to)
    if pay is None or inv is None or inv <= 0:
        return f
    gross = pay + (frm.tds or D("0"))
    f["amt_exact"] = 1.0 if abs(gross - inv) <= ONE_RUPEE or abs(pay - inv) <= ONE_RUPEE else 0.0
    base = to.taxable or inv
    f["amt_tds"] = 1.0 if not f["amt_exact"] and any(abs(pay - (inv - (base * r))) <= ONE_RUPEE for r in TDS_RATES) else 0.0
    short = inv - pay
    f["amt_bank_charge"] = 1.0 if ONE_RUPEE < short <= D("500") and not f["amt_tds"] else 0.0
    f["amt_ratio_log"] = _log_ratio(pay, inv)
    f["amt_partial"] = 1.0 if pay < inv * D("0.98") and not (f["amt_tds"] or f["amt_bank_charge"]) else 0.0
    f["amt_over"] = 1.0 if pay > inv + ONE_RUPEE else 0.0
    if frm.date and to.date:
        due = to.credit_days if to.credit_days is not None else 45
        f["due_gap_abs_log"] = math.log1p(abs((frm.date - to.date).days - due))
    return f


def pair_features(kind, frm, to):
    f = common(frm, to)
    if kind in ("BILLS", "RECEIVES"):
        f.update(lines(frm, to))
        if kind == "BILLS":
            f["amount_ratio_log"] = _log_ratio(frm.taxable or frm.amount, to.taxable or to.amount)
    else:
        f.update(payment(frm, to))
    return f


def _subset_members(pay, invoices, limit=12, max_size=4):
    """Ids of invoices that belong to SOME 2..4-invoice subset whose total equals
    the payment (exactly, or net of one common TDS rate), in integer paise."""
    from itertools import combinations
    if pay is None or not invoices:
        return set()
    target = int((pay * 100).to_integral_value())
    items = []
    for inv in invoices:
        amount = _target(inv)
        if amount is None or amount <= 0:
            continue
        paise = int((amount * 100).to_integral_value())
        if paise <= target + 100:
            items.append((inv.id, paise, int(((inv.taxable or amount) * 100).to_integral_value())))
    items = items[:limit]
    members = set()
    for size in range(2, min(max_size, len(items)) + 1):
        for combo in combinations(items, size):
            total = sum(c[1] for c in combo)
            if total + 100 < target:
                continue
            base = sum(c[2] for c in combo)
            if abs(total - target) <= 100 or any(abs(total - round(base * float(r)) - target) <= 100 for r in TDS_RATES):
                members.update(c[0] for c in combo)
    return members


def _rank(values, reverse=False):
    order = sorted(range(len(values)), key=lambda i: values[i], reverse=reverse)
    ranks = [0] * len(values)
    for r, i in enumerate(order):
        ranks[i] = r
    return ranks


def featurize(kind, frm, cands):
    """Feature dicts for every (frm, candidate) in prescore order, with context."""
    rows = [pair_features(kind, frm, to) for to, _ in cands]
    n = len(rows)
    if not n:
        return rows
    for i, row in enumerate(rows):
        row["n_cands_log"] = math.log1p(n)
        row["prescore_rank"] = float(min(i, 10))
    gaps = [abs(r["date_gap"]) for r in rows]
    for i, rank in enumerate(_rank(gaps)):
        rows[i]["date_rank"] = float(min(rank, 10))
    if kind in ("BILLS", "RECEIVES"):
        lm = [r["line_match"] + 0.5 * r["ref_sim"] + 0.25 * max(r["gstin_agree"], r["pan_agree"], 0) for r in rows]
        for i, rank in enumerate(_rank(lm, reverse=True)):
            rows[i]["line_match_rank"] = float(min(rank, 10))
        vr = [abs(r["value_ratio_log"]) for r in rows]
        for i, rank in enumerate(_rank(vr)):
            rows[i]["value_rank"] = float(min(rank, 10))
        best = max(lm)
        second = sorted(lm, reverse=True)[1] if n > 1 else 0.0
        for i, row in enumerate(rows):
            row["best_competitor_gap"] = lm[i] - (second if lm[i] == best else best)
    else:
        amt = [abs(r["amt_ratio_log"]) - r["amt_exact"] - r["amt_tds"] for r in rows]
        for i, rank in enumerate(_rank(amt)):
            rows[i]["amount_rank"] = float(min(rank, 10))
        exact_like = sum(1 for r in rows if r["amt_exact"] or r["amt_tds"])
        same_party = [to for (to, _), r in zip(cands, rows) if r["gstin_agree"] > 0 or r["pan_agree"] > 0 or r["name_sim"] >= 0.9]
        members = _subset_members(frm.amount, same_party)
        ev = [r["amt_exact"] + r["amt_tds"] + r["ref_sim"] + 0.5 * max(r["gstin_agree"], 0) for r in rows]
        best = max(ev)
        second = sorted(ev, reverse=True)[1] if n > 1 else 0.0
        for i, ((to, _), row) in enumerate(zip(cands, rows)):
            row["combo_member"] = 1.0 if to.id in members else 0.0
            row["same_amount_cands"] = float(min(exact_like, 5))
            row["best_competitor_gap"] = ev[i] - (second if ev[i] == best else best)
    return rows


def vectorize(kind, rows):
    keys = FEATURES[kind]
    return [[float(r.get(k, 0.0)) for k in keys] for r in rows]
