"""Informational purchase-of-goods TDS estimate, not a tax determination.

The caller supplies already-reviewed eligible purchase bases. This helper does
not decide whether GST, an advance or a return belongs in that statutory base.
"""
from datetime import date
from decimal import Decimal, localcontext

from ..money import exact, money
from .fy import fy_of

SOURCES = [
    "https://www.incometaxindia.gov.in/w/section-393-6",
    "https://traces61downloads.tdscpc.gov.in/docs/30-Jun-21.pdf",
]
SELLER_THRESHOLD = Decimal("5000000")
BUYER_THRESHOLD = Decimal("100000000")
RATE_PERCENT = Decimal("0.1")


def estimate_purchase_tds(*, transaction_date, transaction_base, prior_eligible_base,
                          buyer_prior_business_turnover, seller_resident,
                          other_tds_or_tcs_applies, buyer_exempt):
    day = date.fromisoformat(transaction_date)
    financial_year = fy_of(day)
    year = int(financial_year[:4])
    legal_reference = (
        "Income-tax Act 1961 section 194Q" if year <= 2025 else
        "Income-tax Act 2025 section 393(1), Table 8(ii), read with section 402(6)"
    )
    result = {
        "fy": financial_year, "legalReference": legal_reference, "sources": SOURCES,
        "informationalOnly": True, "tds393Applicable": None, "estimatedTds": None,
        "warning": "Informational estimate only; confirm eligible purchase bases and exceptions with a tax adviser",
    }
    if day < date(2021, 7, 1) or year > 2026:
        result["reason"] = "Rule version has not been verified for this business date"
        return result
    current, prior = exact(transaction_base), exact(prior_eligible_base)
    if current < 0 or prior < 0:
        raise ValueError("Supply non-negative, reviewed eligible purchase bases")
    turnover = exact(buyer_prior_business_turnover) if buyer_prior_business_turnover is not None else None
    if turnover is not None and turnover < 0:
        raise ValueError("Business turnover cannot be negative")
    flags = (seller_resident, other_tds_or_tcs_applies, buyer_exempt)
    if any(value is not None and not isinstance(value, bool) for value in flags):
        raise ValueError("Residency and exceptions must be explicit booleans or unknown")
    excluded = (turnover is not None and turnover <= BUYER_THRESHOLD) or (
        seller_resident is False or other_tds_or_tcs_applies is True or buyer_exempt is True
    )
    if excluded:
        return {**result, "tds393Applicable": False, "estimatedTds": "0.00",
                "reason": "An explicitly supplied eligibility condition is not satisfied"}
    if turnover is None or any(value is None for value in flags):
        return {**result, "reason": "Eligibility information is incomplete; no applicability or amount inferred"}
    with localcontext() as context:
        context.prec = 50
        excess_before = max(Decimal("0"), prior - SELLER_THRESHOLD)
        excess_after = max(Decimal("0"), prior + current - SELLER_THRESHOLD)
        base = excess_after - excess_before
        estimate = money(base * RATE_PERCENT / Decimal("100"))
    return {**result, "tds393Applicable": base > 0, "estimatedTds": format(estimate, ".2f"),
            "eligibleBaseThisTransaction": format(base, "f"), "ratePercent": str(RATE_PERCENT)}
