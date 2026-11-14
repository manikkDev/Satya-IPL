"""Recall-oriented candidate generation (union of blocks), Christen 2012 style.

Blocks, any of which admits a (from, to) pair:
  party   - same GSTIN / PAN / supplierId / phonetic name key, inside a date window
  ref     - the from-document's printed reference text names the to-document number
  amount  - (SETTLES only) payment within 1% of the invoice value, or equal to
            it net of a common TDS rate, inside a date window, any party
Candidates are pre-ranked by a cheap score and capped at MAX_CANDIDATES per
from-document. Quality is reported as pair completeness vs reduction ratio.
"""
import bisect
import re
from collections import defaultdict
from decimal import Decimal

from .docs import FROM_TYPES, TO_TYPES
from .normalize import core_number, digits, name_similarity, text_mentions

D = Decimal
OCR_DIGITS = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "S": "5", "B": "8"})
MAX_CANDIDATES = {"BILLS": 25, "RECEIVES": 25, "SETTLES": 40}
# (days before from.date, days after from.date) a to-document may be dated
WINDOWS = {"BILLS": (400, 30), "RECEIVES": (400, 15), "SETTLES": (450, 10)}
TDS_RATES = (D("0.001"), D("0.01"), D("0.02"), D("0.05"), D("0.1"))


def _in_window(kind, frm, to):
    if frm.date is None or to.date is None:
        return True
    before, after = WINDOWS[kind]
    gap = (frm.date - to.date).days
    return -after <= gap <= before


def _amount_close(frm, to):
    if frm.amount is None or to.amount is None or to.amount <= 0:
        return False
    target = to.open_amount if to.open_amount is not None else to.amount
    if abs(frm.amount - target) <= max(D("1"), target * D("0.01")):
        return True
    base = to.taxable or target
    return any(abs(frm.amount - (target - base * r)) <= D("1") for r in TDS_RATES)


class Index:
    def __init__(self, to_docs):
        self.by_party = defaultdict(list)
        self.by_number = defaultdict(list)
        self.by_suffix = defaultdict(list)
        self.docs = to_docs
        self.by_amount = sorted((d for d in to_docs if d.amount is not None), key=lambda d: d.amount)
        self.amounts = [d.amount for d in self.by_amount]
        for doc in to_docs:
            for key in doc.party_keys:
                self.by_party[key].append(doc)
            core = core_number(doc.number)
            if len(core) >= 3:
                self.by_number[core].append(doc)
                dg = digits(doc.number)
                if len(dg) >= 3 and dg != core:
                    self.by_number[dg].append(doc)
                if len(dg) >= 3:
                    self.by_suffix[dg.lstrip("0")[-3:]].append(doc)


def _ref_hits(frm, index):
    if not frm.ref_text:
        return []
    hits = []
    for token in sorted(set(frm.ref_text.replace("/", " ").replace("-", " ").split()) | {frm.ref_text}):
        core = core_number(token)
        for key in (core, digits(token)):
            if key and len(key) >= 3:
                hits.extend(index.by_number.get(key, []))
    if not hits:  # noisy / embedded reference: fuzzy check docs sharing a digit suffix
        pool = {}
        for run in re.findall(r"\d{3,}", frm.ref_text.translate(OCR_DIGITS)):
            for doc in index.by_suffix.get(run.lstrip("0")[-3:], []):
                pool[doc.id] = doc
        hits = [d for _, d in sorted(pool.items()) if text_mentions(frm.ref_text, d.number) >= 0.85]
    return hits


def prescore(kind, frm, to):
    score = 0.0
    if frm.party_keys & to.party_keys:
        score += 2.0
    else:
        score += name_similarity(frm.party_name, to.party_name)
    score += 2.0 * text_mentions(frm.ref_text, to.number)
    if frm.amount is not None and to.amount and to.amount > 0:
        ratio = float(min(frm.amount, to.amount) / max(frm.amount, to.amount)) if max(frm.amount, to.amount) > 0 else 0.0
        score += ratio
    if frm.date and to.date:
        gap = (frm.date - to.date).days
        if kind == "SETTLES":  # payments follow invoices by roughly the credit period
            score -= min(abs(gap - (to.credit_days or 45)), 365) / 365 + (1.0 if gap < -5 else 0.0)
        else:
            score -= min(abs(gap), 365) / 365
    return score


def candidates(kind, from_docs, to_docs, max_candidates=None):
    """Return {from_id: [(to_doc, blocks:set)]} pre-ranked and capped."""
    want_from, want_to = FROM_TYPES[kind], TO_TYPES[kind]
    tos = [d for d in to_docs if d.type == want_to]
    index = Index(tos)
    out = {}
    for frm in from_docs:
        if frm.type != want_from and not (kind == "SETTLES" and frm.type in {"ADVANCE_OUT", "BANK_LINE"}):
            continue
        found = {}
        for key in sorted(frm.party_keys):
            for to in index.by_party.get(key, []):
                if _in_window(kind, frm, to):
                    found.setdefault(to.id, (to, set()))[1].add("party")
        for to in _ref_hits(frm, index):
            found.setdefault(to.id, (to, set()))[1].add("ref")
        if kind == "SETTLES" and frm.amount is not None and frm.amount > 0:
            lo = bisect.bisect_left(index.amounts, frm.amount * D("0.99") - 1)
            hi = bisect.bisect_right(index.amounts, frm.amount / D("0.9") * D("1.01") + 1)
            for to in index.by_amount[lo:hi]:
                if _in_window(kind, frm, to) and _amount_close(frm, to):
                    found.setdefault(to.id, (to, set()))[1].add("amount")
        ranked = sorted(found.values(), key=lambda pair: (-prescore(kind, frm, pair[0]), pair[0].id))
        out[frm.id] = ranked[:max_candidates or MAX_CANDIDATES[kind]]
    return out


def completeness(cands, true_pairs, n_from, n_to):
    """Pair completeness (recall of true pairs) and reduction ratio."""
    kept = {(f, t.id) for f, lst in cands.items() for t, _ in lst}
    hit = sum(1 for p in true_pairs if p in kept)
    total_space = max(n_from * n_to, 1)
    return {"pairCompleteness": round(hit / len(true_pairs), 4) if true_pairs else None,
            "reductionRatio": round(1 - len(kept) / total_space, 4),
            "truePairs": len(true_pairs), "candidatePairs": len(kept)}
