"""Deterministic pair features — no learned weights, no fabrications."""
import re
from decimal import Decimal

from rapidfuzz import fuzz

from .blocking import norm_ref

D = Decimal
SPEC_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(kw|hp|mm|inch|bar|amp|a|v|phase|l|kg)\b", re.I)


def _amount(record):
    return D(record.amount.amount) if record.amount else None


def _specs(text):
    return {(m.group(2).lower(), m.group(1)) for m in SPEC_RE.finditer(text or "")}


def features(anchor, candidate, task):
    """Feature vector + human-readable contributions for one pair."""
    f = {}
    a_num, c_num = norm_ref(anchor.number), norm_ref(candidate.number)
    f["ref_exact"] = 1.0 if a_num and a_num == c_num else 0.0
    f["ref_prefix"] = 1.0 if a_num and c_num and (a_num in c_num or c_num in a_num) else 0.0
    f["ref_similarity"] = fuzz.ratio(a_num, c_num) / 100 if a_num and c_num else 0.0
    if anchor.refs and anchor.refs.poId and anchor.refs.poId == candidate.id:
        f["explicit_ref"] = 1.0
    else:
        f["explicit_ref"] = 0.0

    a_amt, c_amt = _amount(anchor), _amount(candidate)
    if a_amt is not None and c_amt is not None:
        f["amount_delta"] = float(abs(a_amt - c_amt))
        f["amount_ratio"] = float(min(a_amt, c_amt) / max(a_amt, c_amt)) if max(a_amt, c_amt) else 0.0
    else:
        f["amount_delta"] = None
        f["amount_ratio"] = 0.0

    if anchor.date and candidate.date:
        from datetime import date
        try:
            f["date_delta_days"] = abs((date.fromisoformat(candidate.date) - date.fromisoformat(anchor.date)).days)
        except ValueError:
            f["date_delta_days"] = None
    else:
        f["date_delta_days"] = None

    if anchor.description and candidate.description:
        f["desc_ratio"] = fuzz.ratio(anchor.description, candidate.description) / 100
        f["desc_token_set"] = fuzz.token_set_ratio(anchor.description, candidate.description) / 100
    else:
        f["desc_ratio"] = f["desc_token_set"] = 0.0

    a_specs, c_specs = _specs(anchor.description), _specs(candidate.description)
    if a_specs and c_specs:
        f["spec_conflict"] = 1.0 if {u for u, _ in a_specs} & {u for u, _ in c_specs} and a_specs != c_specs else 0.0
    else:
        f["spec_conflict"] = 0.0

    f["hsn_agree"] = 0.0
    if anchor.hsn and candidate.hsn:
        a_h, c_h = anchor.hsn, candidate.hsn
        f["hsn_agree"] = 1.0 if a_h == c_h else (0.75 if a_h[:4] == c_h[:4] else (0.5 if a_h[:2] == c_h[:2] else 0.0))

    f["uom_compat"] = 1.0 if anchor.uom and candidate.uom and anchor.uom == candidate.uom else 0.0

    a_party = (anchor.party.gstin or anchor.party.pan) if anchor.party else None
    c_party = (candidate.party.gstin or candidate.party.pan) if candidate.party else None
    f["party_same"] = 1.0 if a_party and a_party == c_party else 0.0

    if anchor.payment and candidate.amount:
        f["payment_amount_match"] = 1.0 if D(anchor.payment.amount.amount) == c_amt else 0.0

    if anchor.refs:
        f["reference_present"] = 1.0
    else:
        f["reference_present"] = 0.0
    return f


def contributions(f):
    """Top human-readable reasons from the feature vector."""
    reasons = []
    if f.get("explicit_ref"):
        reasons.append({"feature": "explicit_ref", "value": 1.0,
                        "impact": "document states the link"})
    if f.get("ref_exact"):
        reasons.append({"feature": "ref_exact", "value": 1.0,
                        "impact": "normalised document numbers identical"})
    if f.get("party_same"):
        reasons.append({"feature": "party_same", "value": 1.0,
                        "impact": "same supplier/buyer identity"})
    if f.get("amount_ratio", 0) >= 0.98:
        reasons.append({"feature": "amount_ratio", "value": f["amount_ratio"],
                        "impact": "amounts nearly equal"})
    if f.get("hsn_agree", 0) >= 0.75:
        reasons.append({"feature": "hsn_agree", "value": f["hsn_agree"],
                        "impact": "HSN codes agree"})
    if f.get("spec_conflict"):
        reasons.append({"feature": "spec_conflict", "value": 1.0,
                        "impact": "conflicting specs (hard negative)"})
    if f.get("desc_token_set", 0) >= 0.85:
        reasons.append({"feature": "desc_token_set", "value": f["desc_token_set"],
                        "impact": "descriptions highly similar"})
    return reasons[:3]
