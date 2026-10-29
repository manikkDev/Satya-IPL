"""Vendor/supplier dedupe — Fellegi–Sunter scoring + union-find clustering.

Never merges automatically: clusters of PROBABLE pairs are surfaced for a
reviewer. Identifiers (PAN, GSTIN, bank hash) dominate; name similarity is
supporting evidence, never sufficient alone.
"""
import re
from difflib import SequenceMatcher

LEGAL = re.compile(r"\b(pvt\.?|private|ltd\.?|limited|llp|inc|co\.?|corporation|&?\s*sons|enterprises|industries)\b", re.I)


def _norm_name(name):
    text = LEGAL.sub("", (name or "").lower())
    return re.sub(r"[^a-z0-9 ]", "", text).strip()


def _name_sim(a, b):
    a_n, b_n = _norm_name(a), _norm_name(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 1.0
    ratio = SequenceMatcher(None, a_n, b_n).ratio()
    tokens_a, tokens_b = set(a_n.split()), set(b_n.split())
    jaccard = len(tokens_a & tokens_b) / max(len(tokens_a | tokens_b), 1)
    return max(ratio, jaccard)


def pair_score(a, b):
    """Return {score 0-1, certainty, reasons} — no merge, just a suggestion."""
    reasons = []
    if a.get("pan") and a["pan"] == b.get("pan"):
        reasons.append("same PAN")
    if a.get("gstin") and a["gstin"] == b.get("gstin"):
        reasons.append("same GSTIN")
    if a.get("bankAccountMasked") and a["bankAccountMasked"] == b.get("bankAccountMasked"):
        reasons.append("same bank account")
    name_sim = _name_sim(a.get("name", ""), b.get("name", ""))
    if name_sim > 0.85:
        reasons.append(f"name similarity {name_sim:.2f}")
    if a.get("pincode") and a["pincode"] == b.get("pincode"):
        reasons.append("same pincode")

    identity = (a.get("pan") and a["pan"] == b.get("pan")) or \
        (a.get("gstin") and a["gstin"] == b.get("gstin")) or \
        (a.get("bankAccountMasked") and a["bankAccountMasked"] == b.get("bankAccountMasked"))
    score = 0.0
    if identity:
        score += 0.7
    score += 0.3 * name_sim
    if a.get("pincode") and a["pincode"] == b.get("pincode"):
        score += 0.05
    certainty = "PROBABLE" if identity and name_sim > 0.7 else (
        "POSSIBLE" if score >= 0.4 else "INSUFFICIENT_EVIDENCE")
    return {"score": round(min(score, 1.0), 4), "certainty": certainty, "reasons": reasons}


def dedupe(suppliers):
    """Cluster suppliers by PROBABLE pair scores (union-find)."""
    parent = {s["id"]: s["id"] for s in suppliers}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    edges = []
    for i, a in enumerate(suppliers):
        for b in suppliers[i + 1:]:
            verdict = pair_score(a, b)
            if verdict["certainty"] == "PROBABLE":
                union(a["id"], b["id"])
                edges.append({"a": a["id"], "b": b["id"], **verdict})
    clusters = {}
    for s in suppliers:
        clusters.setdefault(find(s["id"]), []).append(s["id"])
    groups = [{"supplierIds": sorted(ids), "pairs": [
        e for e in edges if e["a"] in ids]} for ids in clusters.values() if len(ids) > 1]
    return {"clusters": groups, "pairs": edges,
            "note": "Suggestions only — never auto-merged; a reviewer confirms"}
