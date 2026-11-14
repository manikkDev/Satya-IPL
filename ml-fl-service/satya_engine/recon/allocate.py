"""Payment allocation: score, then solve, then abstain when ambiguous.

Single payment (/v2/allocate/payment, 1:N):
  1. pairwise plausibility per open invoice (printed reference in the
     narration/UTR, party agreement, invoice dated before payment, due-date
     proximity) - deterministic and explainable;
  2. exact search in integer paise (branch-and-bound subset-sum over the
     candidates, <= 8 invoices per payment) for every subset whose total S is
     feasible under one *mode*:
        exact            S == payment                      (+/- rounding)
        policy TDS       S - round(S * r) == payment       (r from tdsPolicy)
        TDS tolerance    same with r in {0.1%, 1%, 2%}     (194Q / 194C)
        bank charges     0 < S - payment <= bankChargeMax
  3. rank by objective = mode penalty + sum(1 - plausibility) + 0.1 per extra
     invoice; if the runner-up is within the ambiguity margin -> needs review
     (never guess). CONFIRMED only for a single feasible exact/policy solution.
Batch (/v2/allocate/batch, N:M): Hungarian assignment (Kuhn 1955) on 1:1
compatible pairs, then a mixed-integer program (scipy.optimize.milp/HiGHS) in
integer paise for the remaining many-to-many component, with a no-good cut to
measure the runner-up objective for the same ambiguity rule.
All money is integer paise internally; output is 2-dp decimal strings.
"""
import math
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

D = Decimal
MAX_ITEMS = 400
MAX_SOLUTIONS = 10
NODE_BUDGET = 250_000
DEFAULT_TDS = ("0.1", "1", "2")
DEFAULT_BANK_MAX = "500"
DEFAULT_MARGIN = D("0.25")
MODE_PENALTY = {"exact": 0.0, "policy_tds": 0.0, "tds": 0.45, "bank_charges": 0.6}


class AllocationInputError(ValueError):
    pass


def _paise(value):
    try:
        amount = D(str(value))
    except (InvalidOperation, ValueError) as error:
        raise AllocationInputError(f"Invalid amount {value!r}") from error
    if not amount.is_finite():
        raise AllocationInputError(f"Invalid amount {value!r}")
    return int((amount * 100).quantize(D("1"), rounding=ROUND_HALF_UP))


def _rupees(paise):
    sign = "-" if paise < 0 else ""
    paise = abs(paise)
    return f"{sign}{paise // 100}.{paise % 100:02d}"


def _rate(text):
    try:
        rate = D(str(text))
    except (InvalidOperation, ValueError) as error:
        raise AllocationInputError(f"Invalid TDS rate {text!r}") from error
    if not (D("0") < rate < D("100")):
        raise AllocationInputError(f"TDS rate must be a percentage between 0 and 100, got {text}")
    return rate


def _tds_paise(gross_paise, rate):
    return int((D(gross_paise) * rate / D("100")).quantize(D("1"), rounding=ROUND_HALF_UP))


def _parse_date(text):
    try:
        return date.fromisoformat(text) if text else None
    except ValueError:
        return None


class Settings:
    def __init__(self, tds_policy=None, tolerance=None):
        tol = tolerance
        self.rounding = tol.roundingPaise if tol and tol.roundingPaise is not None else 100
        self.bank_max = _paise(tol.bankChargeMax) if tol and tol.bankChargeMax is not None else _paise(DEFAULT_BANK_MAX)
        self.margin = D(tol.ambiguityMargin) if tol and tol.ambiguityMargin is not None else DEFAULT_MARGIN
        self.max_k = tol.maxInvoicesPerPayment if tol and tol.maxInvoicesPerPayment else 8
        self.policy_rate = _rate(tds_policy.rate) if tds_policy and tds_policy.deductOnPayment and tds_policy.rate else None
        rates = tol.tdsRates if tol and tol.tdsRates is not None else DEFAULT_TDS
        self.tds_rates = [r for r in (_rate(x) for x in rates) if r != self.policy_rate]

    def modes(self, total, pay, base=None):
        """Feasible modes for subset total S (paise) against payment (paise).
        TDS is computed on `base` (taxable value when known, else the gross)."""
        base = total if base is None else base
        out = []
        if abs(total - pay) <= self.rounding:
            out.append(("exact", None))
        if self.policy_rate is not None and abs(total - _tds_paise(base, self.policy_rate) - pay) <= self.rounding:
            out.append(("policy_tds", self.policy_rate))
        for rate in self.tds_rates:
            if abs(total - _tds_paise(base, rate) - pay) <= self.rounding:
                out.append(("tds", rate))
        if self.rounding < total - pay <= self.bank_max:
            out.append(("bank_charges", None))
        return out

    def window(self, pay):
        """[lo, hi] subset totals that could be feasible in any mode."""
        top = max([self.policy_rate or D("0")] + self.tds_rates + [D("0")])
        hi_tds = int(D(pay) / (D("1") - top / D("100"))) + self.rounding + 2 if top else pay + self.rounding
        return pay - self.rounding, max(pay + self.bank_max, hi_tds)


def plausibility(payment, inv):
    """0..1 deterministic pairwise plausibility, with reasons."""
    from ..linking.normalize import name_similarity, text_mentions
    score, reasons = 0.5, []
    text = " ".join(x for x in (payment.narration, payment.utr) if x)
    if inv.number and text:
        mention = text_mentions(text, inv.number)
        if mention >= 0.999:
            score += 0.4
            reasons.append(f"payment reference quotes {inv.number}")
        elif mention >= 0.85:
            score += 0.3
            reasons.append(f"payment reference resembles {inv.number}")
    if payment.partyGstin and inv.partyGstin:
        if payment.partyGstin.upper() == inv.partyGstin.upper():
            score += 0.05
        else:
            score -= 0.35
            reasons.append(f"{inv.number or inv.id} belongs to a different GSTIN")
    elif payment.partyName and inv.partyName and name_similarity(payment.partyName, inv.partyName) < 0.6:
        score -= 0.2
        reasons.append(f"{inv.number or inv.id} payee name differs")
    pay_day, inv_day, due = _parse_date(payment.date), _parse_date(inv.date), _parse_date(inv.dueDate)
    if pay_day and inv_day and inv_day > pay_day:
        score -= 0.3
        reasons.append(f"{inv.number or inv.id} is dated after the payment")
    if pay_day and due:
        score += 0.05 * max(0.0, 1 - abs((pay_day - due).days) / 60)
    return max(0.01, min(0.99, score)), reasons


def _search(items, lo, hi, max_k, budget=NODE_BUDGET):
    """Enumerate subsets (<= max_k items) with total in [lo, hi]; items sorted desc."""
    n = len(items)
    suffix = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        suffix[i] = suffix[i + 1] + items[i][1]
    found, nodes, truncated = [], 0, False
    stack = [(0, 0, ())]
    while stack:
        i, total, chosen = stack.pop()
        nodes += 1
        if nodes > budget:
            truncated = True
            break
        if lo <= total <= hi and chosen:
            found.append(chosen)
            if len(found) >= 2000:
                truncated = True
                break
        if i >= n or len(chosen) >= max_k or total + suffix[i] < lo:
            continue
        stack.append((i + 1, total, chosen))  # skip item i
        if total + items[i][1] <= hi:
            stack.append((i + 1, total + items[i][1], chosen + (i,)))
    return found, truncated


def _certainty(ranked, settings, truncated):
    if not ranked:
        return "INSUFFICIENT_EVIDENCE", False, None
    best = ranked[0]
    if len(ranked) == 1 and best["mode"] in ("exact", "policy_tds") and not truncated:
        return "CONFIRMED", False, None
    if len(ranked) > 1 and D(str(ranked[1]["objective"] - best["objective"])) < settings.margin:
        return "POSSIBLE", True, ranked[1]["objective"] - best["objective"]
    gap = ranked[1]["objective"] - best["objective"] if len(ranked) > 1 else None
    return "PROBABLE", False, gap


def _confidences(ranked, temperature=0.25):
    if not ranked:
        return
    weights = [math.exp(-(r["objective"] - ranked[0]["objective"]) / temperature) for r in ranked]
    total = sum(weights)
    for r, w in zip(ranked, weights):
        r["confidence"] = f"{w / total:.4f}"


def allocate(request):
    pay = _paise(request.payment.amount.amount)
    if pay <= 0:
        raise AllocationInputError("Payment amount must be positive")
    if request.payment.tdsAmount is not None:
        pay += _paise(request.payment.tdsAmount.amount)  # TDS already recorded -> gross covered
    currency = request.payment.amount.currency
    settings = Settings(request.tdsPolicy, getattr(request, "tolerance", None))
    pool, meta, base_of = {}, {}, {}
    for inv in request.openInvoices:
        amount = _paise(inv.openAmount.amount)
        if amount > 0:
            p, why = plausibility(request.payment, inv)
            pool[inv.id] = amount
            meta[inv.id] = (p, why, inv.number or inv.id)
            base_of[inv.id] = min(_paise(inv.taxableAmount.amount), amount) if inv.taxableAmount else amount
    for credit in request.credits or []:
        amount = _paise(credit.amount.amount)
        if amount > 0 and credit.id not in pool:
            pool[credit.id] = amount
            meta[credit.id] = (0.5, [], credit.id)
    if len(pool) > MAX_ITEMS:
        raise AllocationInputError(f"Too many candidates ({len(pool)}); max {MAX_ITEMS} — narrow by supplier first")
    lo, hi = settings.window(pay)
    items = sorted(((doc_id, amount) for doc_id, amount in pool.items() if amount <= hi),
                   key=lambda t: (-t[1], -meta[t[0]][0], t[0]))
    subsets, truncated = _search(items, lo, hi, settings.max_k)
    candidates = []
    for subset in subsets:
        chosen = [items[i] for i in subset]
        total = sum(a for _, a in chosen)
        base = sum(base_of.get(d, a) for d, a in chosen)
        for mode, rate in settings.modes(total, pay, base):
            plaus = [meta[d][0] for d, _ in chosen]
            objective = MODE_PENALTY[mode] + sum(1 - p for p in plaus) + 0.1 * (len(chosen) - 1)
            reasons = []
            if mode == "exact":
                reasons.append("amounts add up exactly" if len(chosen) > 1 else "amount matches exactly")
            elif mode in ("policy_tds", "tds"):
                reasons.append(f"amounts add up net of {rate.normalize():f}% TDS (₹{_rupees(_tds_paise(base, rate))})")
            else:
                reasons.append(f"short by ₹{_rupees(total - pay)} — consistent with bank charges")
            for d, _ in chosen:
                reasons += meta[d][1]
            entry = {"ids": chosen, "total": total, "base": base, "mode": mode, "rate": rate, "objective": round(objective, 4),
                     "reasons": reasons}
            candidates.append(entry)
    candidates.sort(key=lambda c: (c["objective"], len(c["ids"]), [d for d, _ in c["ids"]]))
    # one entry per distinct invoice set (best mode wins)
    seen, ranked = set(), []
    for c in candidates:
        key = tuple(sorted(d for d, _ in c["ids"]))
        if key not in seen:
            seen.add(key)
            ranked.append(c)
    certainty, ambiguous, gap = _certainty(ranked, settings, truncated)
    _confidences(ranked)
    solutions = []
    for c in ranked[:MAX_SOLUTIONS]:
        tds = _tds_paise(c["base"], c["rate"]) if c["rate"] is not None else 0
        charges = c["total"] - pay if c["mode"] == "bank_charges" else 0
        solutions.append({
            "allocations": [{"documentId": d, "amount": {"amount": _rupees(a), "currency": currency}} for d, a in c["ids"]],
            "residual": {"amount": _rupees(0 if c["mode"] != "exact" else pay - c["total"]), "currency": currency},
            "mode": c["mode"], "objective": str(c["objective"]), "confidence": c["confidence"],
            **({"tdsAmount": {"amount": _rupees(tds), "currency": currency},
                "tdsRate": f"{c['rate'].normalize():f}"} if tds else {}),
            **({"bankCharges": {"amount": _rupees(charges), "currency": currency}} if charges else {}),
            "reasons": c["reasons"],
        })
    if not ranked:
        top_reasons = ["no combination of open invoices matches the payment exactly, net of TDS, or within bank-charge tolerance"]
    elif ambiguous:
        top_reasons = [f"{len(ranked)} allocations fit; the best two are within the ambiguity margin — a person must choose"]
    elif certainty == "CONFIRMED":
        top_reasons = ["exactly one combination of open invoices fits"]
    else:
        top_reasons = [f"best allocation beats the runner-up by {gap:.2f} objective points" if gap is not None
                       else "a single tolerance-based allocation fits"]
    if truncated:
        top_reasons.append("search budget reached — more combinations may exist; confirm manually")
    return {
        "solutions": solutions,
        "unique": len(ranked) == 1,
        "certainty": certainty,
        "ambiguous": ambiguous,
        "needsReview": certainty != "CONFIRMED",
        "confidence": solutions[0]["confidence"] if solutions else None,
        "alternatives": max(0, len(ranked) - 1),
        "reasons": top_reasons,
        "searchTruncated": truncated,
        "method": "score-then-solve: deterministic plausibility + exact paise subset search; ambiguity margin "
                  f"{settings.margin}; confidence is relative plausibility among feasible allocations, not a calibrated probability",
    }


# ------------------------------------------------------------------ N:M batch
def _compatible(settings, pay, amount):
    return bool(settings.modes(amount, pay))


def allocate_batch(request):
    """Many payments x many invoices: Hungarian for 1:1, MILP for the rest."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    settings = Settings(request.tdsPolicy, request.tolerance)
    pays = [(p, _paise(p.amount.amount) + (_paise(p.tdsAmount.amount) if p.tdsAmount else 0)) for p in request.payments]
    invs = [(i, _paise(i.openAmount.amount)) for i in request.openInvoices if _paise(i.openAmount.amount) > 0]
    currency = request.payments[0].amount.currency
    plaus = {(p.id, i.id): plausibility(p, i) for p, _ in pays for i, _ in invs}

    # stage 1: Hungarian over 1:1-compatible pairs
    big = 1e6
    cost = np.full((len(pays), len(invs)), big)
    for a, (p, pp) in enumerate(pays):
        for b, (i, ip) in enumerate(invs):
            modes = settings.modes(ip, pp, min(_paise(i.taxableAmount.amount), ip) if i.taxableAmount else None)
            if modes:
                cost[a, b] = min(MODE_PENALTY[m] for m, _ in modes) + (1 - plaus[(p.id, i.id)][0])
    one_to_one, used_p, used_i = [], set(), set()
    if len(pays) and len(invs):
        rows, cols = linear_sum_assignment(cost)
        for a, b in zip(rows, cols):
            if cost[a, b] >= big:
                continue
            # ambiguity: another compatible invoice for this payment (or payment for
            # this invoice) within the margin -> leave for review
            alt_row = sorted(c for j, c in enumerate(cost[a]) if j != b and c < big)
            alt_col = sorted(c for j, c in enumerate(cost[:, b]) if j != a and c < big)
            close = (alt_row and alt_row[0] - cost[a, b] < float(settings.margin)) or \
                    (alt_col and alt_col[0] - cost[a, b] < float(settings.margin))
            p, i = pays[a][0], invs[b][0]
            one_to_one.append({"paymentId": p.id, "allocations": [{"documentId": i.id, "amount": {"amount": _rupees(invs[b][1]), "currency": currency}}],
                               "certainty": "POSSIBLE" if close else "PROBABLE", "needsReview": bool(close),
                               "reasons": (["another 1:1 pairing fits about as well"] if close else ["unique best 1:1 pairing"]) + plaus[(p.id, i.id)][1],
                               "method": "hungarian"})
            if not close:
                used_p.add(a)
                used_i.add(b)

    # stage 2: MILP for the remaining many-to-many component
    rest_p = [k for k in range(len(pays)) if k not in used_p]
    rest_i = [k for k in range(len(invs)) if k not in used_i]
    milp_result = _milp(pays, invs, rest_p, rest_i, plaus, settings, currency) if rest_p and rest_i else None
    return {"oneToOne": [x for x in one_to_one if not x["needsReview"]],
            "review": [x for x in one_to_one if x["needsReview"]],
            "manyToMany": milp_result,
            "method": "Hungarian (1:1) then MILP in integer paise (N:M) with tolerance slack and a no-good cut for the runner-up"}


def _milp(pays, invs, rest_p, rest_i, plaus, settings, currency, exclude=None):
    """Each remaining invoice is either fully settled (possibly across several
    payments) or untouched; each payment's allocations equal its amount up to
    bank-charge slack s, TDS slack t (<= max rate x allocated) and an
    unallocated remainder r, all penalised. Integer paise throughout."""
    import numpy as np
    from scipy.optimize import Bounds, LinearConstraint, milp

    P, I = len(rest_p), len(rest_i)
    if P * I > 4000:
        return {"status": "skipped", "reason": f"component too large ({P}x{I}); narrow by supplier"}
    na = P * I
    A_, Y_, Z_, S_, T_, R_ = 0, na, 2 * na, 2 * na + I, 2 * na + I + P, 2 * na + I + 2 * P
    n = 2 * na + I + 3 * P
    max_rate = max([settings.policy_rate or D("0")] + settings.tds_rates + [D("0")])
    c = np.zeros(n)
    for x, pk in enumerate(rest_p):
        pay = max(pays[pk][1], 1)
        for y_, ik in enumerate(rest_i):
            c[Y_ + x * I + y_] = 1 - plaus[(pays[pk][0].id, invs[ik][0].id)][0] + 0.1
        c[S_ + x] = MODE_PENALTY["bank_charges"] / max(settings.bank_max, 1)
        c[T_ + x] = MODE_PENALTY["tds"] / max(1, int(pay * max_rate / 100)) if max_rate else 0
        c[R_ + x] = 2.0 / pay
    A, lo, hi = [], [], []

    def add(row, low, high):
        A.append(row)
        lo.append(low)
        hi.append(high)
    for x, pk in enumerate(rest_p):
        row = np.zeros(n)
        row[A_ + x * I:A_ + (x + 1) * I] = 1
        row[S_ + x], row[T_ + x], row[R_ + x] = -1, -1, 1
        add(row, pays[pk][1] - settings.rounding, pays[pk][1] + settings.rounding)
        if max_rate:
            row = np.zeros(n)
            row[T_ + x] = 1
            row[A_ + x * I:A_ + (x + 1) * I] = -float(max_rate) / 100
            add(row, -np.inf, settings.rounding)
    for y_, ik in enumerate(rest_i):
        row = np.zeros(n)
        row[[A_ + x * I + y_ for x in range(P)]] = 1
        row[Z_ + y_] = -invs[ik][1]
        add(row, 0, 0)
        for x in range(P):
            row = np.zeros(n)
            row[A_ + x * I + y_] = 1
            row[Y_ + x * I + y_] = -invs[ik][1]
            add(row, -np.inf, 0)
    if exclude:
        row = np.zeros(n)
        for idx in exclude:
            row[Y_ + idx] = 1
        add(row, -np.inf, len(exclude) - 1)
    upper = np.concatenate([np.full(na, max(a for _, a in invs)), np.ones(na), np.ones(I),
                            np.full(P, settings.bank_max), np.full(P, np.inf),
                            np.array([pays[pk][1] for pk in rest_p], float)])
    if not max_rate:
        upper[T_:T_ + P] = 0
    integrality = np.concatenate([np.ones(2 * na + I), np.zeros(3 * P)])
    res = milp(c, constraints=LinearConstraint(np.array(A), lo, hi), integrality=integrality,
               bounds=Bounds(np.zeros(n), upper), options={"time_limit": 5})
    if res.x is None or res.status not in (0, 1):
        return {"status": "infeasible", "reason": "no N:M allocation fits within tolerances"}
    used = [k for k in range(na) if res.x[Y_ + k] > 0.5]
    allocations = []
    for k in used:
        x, y_ = divmod(k, I)
        amount = int(round(res.x[A_ + k]))
        if amount > 0:
            allocations.append({"paymentId": pays[rest_p[x]][0].id, "documentId": invs[rest_i[y_]][0].id,
                                "amount": {"amount": _rupees(amount), "currency": currency}})
    unallocated = [{"paymentId": pays[pk][0].id, "amount": {"amount": _rupees(int(round(res.x[R_ + x]))), "currency": currency}}
                   for x, pk in enumerate(rest_p) if res.x[R_ + x] > 0.5]
    out = {"status": "optimal" if res.status == 0 else "time_limit", "objective": round(float(res.fun), 4),
           "allocations": allocations, "unallocated": unallocated}
    if exclude is None and used:
        runner = _milp(pays, invs, rest_p, rest_i, plaus, settings, currency, exclude=used)
        gap = (runner["objective"] - out["objective"]) if runner.get("objective") is not None else None
        out["runnerUpObjective"] = runner.get("objective")
        out["ambiguous"] = gap is not None and gap < float(settings.margin)
        out["certainty"] = "POSSIBLE" if out["ambiguous"] or unallocated else "PROBABLE"
        out["needsReview"] = bool(out["ambiguous"] or unallocated or res.status != 0)
    return out
