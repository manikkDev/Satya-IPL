"""Exact subset-sum payment allocation.

A payment is allocated to open invoices (optionally plus credits, optionally
TDS-net). We return every exact solution; certainty reflects uniqueness.
"""
from decimal import Decimal
from itertools import combinations

from ..money import exact, money

D = Decimal
MAX_ITEMS = 20
MAX_SOLUTIONS = 10


class AllocationInputError(ValueError):
    pass


def _net(amount, policy):
    """TDS-net value: gross invoice covered by this payment amount."""
    if policy and policy.deductOnPayment and policy.rate:
        rate = D(policy.rate) / D("100")
        return exact(amount) * (D("1") - rate)
    return exact(amount)


def _subsets(target, items):
    """Yield subsets of (id, amount) whose amounts sum exactly to target."""
    n = len(items)
    if n > MAX_ITEMS:
        raise AllocationInputError(f"Too many candidates ({n}); max {MAX_ITEMS}")
    amounts = [D(a) for _, a in items]
    solutions = []
    for r in range(1, n + 1):
        for combo in combinations(range(n), r):
            if sum(amounts[i] for i in combo) == target:
                solutions.append([items[i] for i in combo])
                if len(solutions) >= MAX_SOLUTIONS:
                    return solutions
    return solutions


def allocate(request):
    payment_amount = exact(request.payment.amount.amount)
    if payment_amount <= 0:
        raise AllocationInputError("Payment amount must be positive")
    # Net invoice value covered = gross / (1 - tdsRate) when deducting.
    target = payment_amount
    if request.tdsPolicy and request.tdsPolicy.deductOnPayment and request.tdsPolicy.rate:
        target = money(payment_amount / (D("1") - D(request.tdsPolicy.rate) / D("100")))

    items = [(inv.id, inv.openAmount.amount) for inv in request.openInvoices]
    for credit in request.credits or []:
        items.append((credit.id, credit.amount.amount))
    # Deduplicate identical ids
    items = list({i: a for i, a in items}.items())
    solutions = _subsets(D(target), items)
    certainty = "CONFIRMED" if len(solutions) == 1 else (
        "PROBABLE" if len(solutions) <= 3 else "POSSIBLE")
    return {
        "solutions": [{
            "allocations": [{"documentId": doc_id,
                             "amount": {"amount": str(money(amount)),
                                        "currency": request.payment.amount.currency}} for doc_id, amount in combo],
            "residual": {"amount": str(money(D(target) - sum(D(a) for _, a in combo))),
                         "currency": request.payment.amount.currency},
        } for combo in solutions],
        "unique": len(solutions) == 1,
        "certainty": certainty,
    }
