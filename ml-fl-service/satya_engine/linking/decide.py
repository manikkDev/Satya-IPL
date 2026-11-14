"""The deployed decision rule (shared by training/certification and runtime).

BILLS / RECEIVES - one decision per from-document over its ranked candidates:
  auto    top p >= tau_auto AND (runner-up p < tau_review OR top - runner-up >= margin)
  review  otherwise, every candidate with p >= tau_review (at most 3)
SETTLES - one decision per payment: take the smallest k (1..4) such that the
  top-k invoices are amount-consistent with the payment (exact, net of one
  standard TDS rate, or short by <= Rs 500 bank charges, all in paise):
  auto    p_k >= tau_auto AND (p_{k+1} < tau_review OR p_k - p_{k+1} >= margin)
  review  otherwise, every candidate with p >= tau_review (at most 4)
Anything else is ignored. The LTT certificate is computed on exactly this
rule, so the >= 99% precision target refers to auto *decisions*.
"""
TDS_PERMILLE = (1, 10, 20, 50, 100)  # 0.1%, 1%, 2%, 5%, 10%
BANK_CHARGE_MAX_PAISE = 50000
MAX_REVIEW = 3
MAX_SET = 4


def amount_consistent(pay_paise, open_paise, taxable_paise):
    if pay_paise is None or open_paise is None:
        return None
    if abs(open_paise - pay_paise) <= 100:
        return "exact"
    for permille in TDS_PERMILLE:
        if abs(open_paise - (taxable_paise * permille) // 1000 - pay_paise) <= 100:
            return f"net of {permille / 10:g}% TDS"
    if 0 < open_paise - pay_paise <= BANK_CHARGE_MAX_PAISE:
        return "short by bank charges"
    return None


def settle_set(ranked, pay_paise, thresholds):
    """ranked: [(to_id, p, open_paise, taxable_paise)] desc. -> (k, basis, clear) or None."""
    if pay_paise is None:
        return None
    total = taxable = 0
    for k, (_to, _p, open_p, tax_p) in enumerate(ranked[:MAX_SET], start=1):
        if open_p is None:
            return None
        total += open_p
        taxable += tax_p if tax_p is not None else open_p
        basis = amount_consistent(pay_paise, total, taxable)
        if basis:
            nxt = ranked[k][1] if len(ranked) > k else 0.0
            pk = ranked[k - 1][1]
            clear = nxt < thresholds["review"] or (pk - nxt) >= thresholds.get("margin", 0.1)
            return k, basis, clear
        if total > pay_paise + BANK_CHARGE_MAX_PAISE:
            return None
    return None


def per_doc(kind, ranked, thresholds, pay_paise=None):
    """Return [(to_id, p, zone, basis)] for one from-document."""
    tau_a, tau_r, margin = thresholds["auto"], thresholds["review"], thresholds.get("margin", 0.1)
    if not ranked:
        return []
    if kind == "SETTLES":
        found = settle_set(ranked, pay_paise, thresholds)
        if found and tau_a is not None:
            k, basis, clear = found
            if clear and ranked[k - 1][1] >= tau_a:
                return [(r[0], r[1], "auto", basis) for r in ranked[:k]]
        return [(r[0], r[1], "review", None) for r in ranked[:MAX_REVIEW + 1] if r[1] >= tau_r]
    top_id, top_p = ranked[0][0], ranked[0][1]
    runner = ranked[1][1] if len(ranked) > 1 else 0.0
    clear = runner < tau_r or (top_p - runner) >= margin
    if tau_a is not None and top_p >= tau_a and clear:
        return [(top_id, top_p, "auto", None)]
    return [(r[0], r[1], "review", None) for r in ranked[:MAX_REVIEW] if r[1] >= tau_r]


def decision(kind, ranked, thresholds, pay_paise=None):
    """(score, chosen_ids) an auto decision is judged on for LTT; score 0 when
    the rule could never auto-decide this document."""
    if not ranked:
        return None, []
    if kind == "SETTLES":
        found = settle_set(ranked, pay_paise, thresholds)
        if not found:
            return 0.0, []
        k, _basis, clear = found
        return (ranked[k - 1][1] if clear else 0.0), [r[0] for r in ranked[:k]]
    top_p = ranked[0][1]
    runner = ranked[1][1] if len(ranked) > 1 else 0.0
    clear = runner < thresholds["review"] or (top_p - runner) >= thresholds.get("margin", 0.1)
    return (top_p if clear else 0.0), [ranked[0][0]]
