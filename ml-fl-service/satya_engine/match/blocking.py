"""Multi-pass candidate blocking — recall-oriented prefilter before scoring."""
import re
from decimal import Decimal

D = Decimal
AMOUNT_BAND = D("0.10")       # ±10%
DATE_WINDOW_DAYS = 120


def norm_ref(number):
    return re.sub(r"[^a-z0-9]", "", (number or "").lower())


def _amount(record):
    if record.amount is not None:
        return D(record.amount.amount)
    return None


def _supplier_key(record):
    if record.party:
        return (record.party.gstin or record.party.pan or record.party.name or "").lower()
    return ""


def block(anchor, pool):
    """Return candidate MatchRecords worth scoring.

    Any ONE of the passes admitting a pair keeps it — the point is recall,
    not precision.
    """
    from datetime import date

    kept = []
    a_amount, a_supplier, a_ref = _amount(anchor), _supplier_key(anchor), norm_ref(anchor.number)
    for candidate in pool:
        if candidate.id == anchor.id:
            continue
        c_amount, c_supplier, c_ref = _amount(candidate), _supplier_key(candidate), norm_ref(candidate.number)
        reasons = []
        stated = {getattr(anchor.refs, f, None) for f in ("poId", "grnId", "invoiceId")} if anchor.refs else set()
        stated |= {getattr(candidate.refs, f, None) for f in ("poId", "grnId", "invoiceId")} if candidate.refs else set()
        stated.discard(None)
        if anchor.id in stated or candidate.id in stated:
            reasons.append("explicit_ref")
        if a_supplier and c_supplier and a_supplier == c_supplier:
            reasons.append("same_supplier")
        if a_ref and c_ref and (a_ref == c_ref or a_ref in c_ref or c_ref in a_ref):
            reasons.append("similar_number")
        if a_amount is not None and c_amount is not None and a_amount > 0:
            if abs(c_amount - a_amount) / a_amount <= AMOUNT_BAND:
                reasons.append("amount_band")
        if anchor.date and candidate.date:
            try:
                gap = abs((date.fromisoformat(candidate.date) - date.fromisoformat(anchor.date)).days)
                if gap <= DATE_WINDOW_DAYS:
                    reasons.append("date_window")
            except ValueError:
                pass
        if not reasons and anchor.description and candidate.description:
            a_desc = set(norm_ref(anchor.description))
            c_desc = set(norm_ref(candidate.description))
            overlap = len(a_desc & c_desc) / max(len(a_desc | c_desc), 1)
            if overlap >= 0.5:
                reasons.append("description_overlap")
        if reasons:
            kept.append((candidate, reasons))
    return kept
