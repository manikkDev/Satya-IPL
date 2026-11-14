"""Supplier-master duplicate detection: Fellegi-Sunter + union-find.

Records: {id, name, tradeNames?, gstins?[str], pan?, bankHashes?[str],
pincode?, stateCode?, email?, phone?}.
1. Blocking (union): PAN, GSTIN, bank-account hash, phonetic name key prefix,
   phone/email.
2. Comparison vector per pair, field levels:
     pan     agree / disagree / missing
     gstin   any-agree / disagree / missing
     bank    any-agree / disagree / missing
     name    exact (normalised) / >=0.92 / >=0.80 / below  (transliteration-
             tolerant: Devanagari->Latin, honorifics & legal forms dropped,
             Engg/Inds/Trdrs variants folded, phonetic folding)
     pin     agree / disagree / missing
     contact (email or phone) agree / disagree / missing
3. Match weight W = sum log2(m/u) (Fellegi & Sunter 1969). m/u start from
   documented priors and are re-estimated by EM over the blocked pairs when
   there are enough of them (fastLink / Splink, label-free).
4. Decisions: W >= upper -> duplicate (clustered with union-find),
   lower <= W < upper -> possible (review), else none. Two special cases:
   same PAN with *different* GSTINs = branches of one legal entity (reported
   as a "same_legal_entity" group, not a duplicate); a different PAN with
   both present caps the pair at "possible" whatever the name says.
Never merges anything: output is suggestions with reasons.
"""
import math
from collections import defaultdict
from itertools import combinations

from pydantic import BaseModel, ConfigDict, Field

from ..linking.normalize import name_key, name_similarity, norm_name


class SupplierRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    tradeNames: list[str] | None = None
    gstins: list[str] | None = None
    pan: str | None = None
    bankHashes: list[str] | None = None
    pincode: str | None = None
    stateCode: str | None = None
    email: str | None = None
    phone: str | None = None


class SupplierDuplicatesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suppliers: list[SupplierRecord] = Field(max_length=10000)

LEVELS = {
    "pan": ["agree", "disagree", "missing"],
    "gstin": ["agree", "disagree", "missing"],
    "bank": ["agree", "disagree", "missing"],
    "name": ["exact", "high", "medium", "low"],
    "pin": ["agree", "disagree", "missing"],
    "contact": ["agree", "disagree", "missing"],
}
# P(level | match) and P(level | non-match) priors (rough, documented; EM refines)
M_PRIOR = {
    "pan": {"agree": 0.80, "disagree": 0.02, "missing": 0.18},
    "gstin": {"agree": 0.70, "disagree": 0.12, "missing": 0.18},
    "bank": {"agree": 0.55, "disagree": 0.10, "missing": 0.35},
    "name": {"exact": 0.55, "high": 0.30, "medium": 0.12, "low": 0.03},
    "pin": {"agree": 0.60, "disagree": 0.10, "missing": 0.30},
    "contact": {"agree": 0.45, "disagree": 0.15, "missing": 0.40},
}
U_PRIOR = {
    "pan": {"agree": 0.002, "disagree": 0.80, "missing": 0.198},
    "gstin": {"agree": 0.001, "disagree": 0.80, "missing": 0.199},
    "bank": {"agree": 0.001, "disagree": 0.60, "missing": 0.399},
    "name": {"exact": 0.004, "high": 0.02, "medium": 0.08, "low": 0.896},
    "pin": {"agree": 0.05, "disagree": 0.65, "missing": 0.30},
    "contact": {"agree": 0.002, "disagree": 0.60, "missing": 0.398},
}
UPPER, LOWER = 8.0, 3.0
EM_MIN_PAIRS = 200


def _set(values):
    return {str(v).strip().upper() for v in values or [] if v}


def _prep(s):
    gstins = _set(s.get("gstins"))
    pan = (s.get("pan") or "").strip().upper() or next((g[2:12] for g in sorted(gstins) if len(g) == 15), "")
    names = [s.get("name") or s.get("legalName") or ""] + list(s.get("tradeNames") or [])
    return {"id": s["id"], "name": names[0], "names": [n for n in names if n], "pan": pan, "gstins": gstins,
            "bank": _set(s.get("bankHashes")), "pin": str(s.get("pincode") or "").strip(),
            "contact": _set([s.get("email"), s.get("phone")]), "key": name_key(names[0])}


def _cmp_set(a, b):
    if not a or not b:
        return "missing"
    return "agree" if a & b else "disagree"


def compare(a, b):
    best = max((name_similarity(x, y) for x in a["names"] for y in b["names"]), default=0.0)
    exact = any(norm_name(x) == norm_name(y) for x in a["names"] for y in b["names"] if norm_name(x))
    gamma = {
        "pan": "missing" if not a["pan"] or not b["pan"] else ("agree" if a["pan"] == b["pan"] else "disagree"),
        "gstin": _cmp_set(a["gstins"], b["gstins"]),
        "bank": _cmp_set(a["bank"], b["bank"]),
        "name": "exact" if exact else "high" if best >= 0.92 else "medium" if best >= 0.80 else "low",
        "pin": "missing" if not a["pin"] or not b["pin"] else ("agree" if a["pin"] == b["pin"] else "disagree"),
        "contact": _cmp_set(a["contact"], b["contact"]),
    }
    return gamma, best


def weight(gamma, m, u):
    parts = {f: math.log2(m[f][lvl] / u[f][lvl]) for f, lvl in gamma.items()}
    return sum(parts.values()), parts


def _blocks(recs):
    index = defaultdict(set)
    for r in recs:
        keys = [f"pan:{r['pan']}"] if r["pan"] else []
        keys += [f"g:{g}" for g in r["gstins"]] + [f"b:{h}" for h in r["bank"]] + [f"c:{c}" for c in r["contact"]]
        if len(r["key"]) >= 4:
            keys.append(f"n:{r['key'][:5]}")
        for k in keys:
            index[k].add(r["id"])
    pairs = set()
    for ids in index.values():
        if len(ids) > 200:
            continue
        pairs.update(combinations(sorted(ids), 2))
    return sorted(pairs)


def em(gammas, m, u, p=0.05, iters=30):
    """Classic two-class EM over comparison vectors (conditional independence)."""
    m = {f: dict(v) for f, v in m.items()}
    u = {f: dict(v) for f, v in u.items()}
    for _ in range(iters):
        resp = []
        for g in gammas:
            lm = math.log(p) + sum(math.log(m[f][l]) for f, l in g.items())
            lu = math.log(1 - p) + sum(math.log(u[f][l]) for f, l in g.items())
            resp.append(1 / (1 + math.exp(min(50, lu - lm))))
        total = sum(resp)
        p = min(max(total / len(gammas), 1e-4), 0.5)
        for f, levels in LEVELS.items():
            for lvl in levels:
                mm = sum(r for r, g in zip(resp, gammas) if g[f] == lvl)
                uu = sum(1 - r for r, g in zip(resp, gammas) if g[f] == lvl)
                m[f][lvl] = (mm + 0.5) / (total + 0.5 * len(levels))
                u[f][lvl] = (uu + 0.5) / (len(gammas) - total + 0.5 * len(levels))
    return m, u, p


REASON = {
    ("pan", "agree"): "same PAN (legal entity)", ("pan", "disagree"): "different PAN",
    ("gstin", "agree"): "same GSTIN", ("bank", "agree"): "same bank account",
    ("bank", "disagree"): "different bank accounts", ("pin", "agree"): "same PIN code",
    ("contact", "agree"): "same email/phone", ("gstin", "disagree"): "different GSTINs",
}


def duplicates(suppliers, use_em=False):
    recs = {s["id"]: _prep(s) for s in suppliers if s.get("id")}
    pairs = _blocks(list(recs.values()))
    compared = [(a, b, *compare(recs[a], recs[b])) for a, b in pairs]
    m, u, est = M_PRIOR, U_PRIOR, "priors"
    if use_em and len(compared) >= EM_MIN_PAIRS:
        m, u, _p = em([c[2] for c in compared], M_PRIOR, U_PRIOR)
        est = f"EM over {len(compared)} blocked pairs"
    parent = {i: i for i in recs}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    verdicts, entities = [], defaultdict(set)
    for a, b, gamma, sim in compared:
        w, parts = weight(gamma, m, u)
        ra, rb = recs[a], recs[b]
        branch = gamma["pan"] == "agree" and gamma["gstin"] == "disagree" and \
            {g[:2] for g in ra["gstins"]} != {g[:2] for g in rb["gstins"]}
        if branch:
            entities[ra["pan"]].update([a, b])
        decision = "duplicate" if w >= UPPER else "possible" if w >= LOWER else None
        if decision == "duplicate" and (gamma["pan"] == "disagree" or branch):
            decision = "possible"  # identifiers say different entity/branch: never auto-cluster
        if not decision:
            continue
        reasons = [REASON[(f, l)] for f, l in gamma.items() if (f, l) in REASON]
        reasons.append(f"name similarity {sim:.2f}" + (" (after transliteration/normalisation)" if gamma["name"] in ("exact", "high") else ""))
        if branch:
            reasons.append("same PAN, GSTINs in different states — likely branches of one legal entity, not a duplicate")
        verdicts.append({"a": a, "b": b, "decision": decision, "weight": round(w, 2),
                         "contributions": {f: round(v, 2) for f, v in parts.items()}, "reasons": reasons})
        if decision == "duplicate":
            ra_, rb_ = find(a), find(b)
            if ra_ != rb_:
                parent[rb_] = ra_
    clusters = defaultdict(list)
    for i in recs:
        clusters[find(i)].append(i)
    out_clusters = []
    for ids in clusters.values():
        if len(ids) < 2:
            continue
        ids = sorted(ids)
        members = [v for v in verdicts if v["a"] in ids and v["b"] in ids]
        reasons = sorted({r for v in members if v["decision"] == "duplicate" for r in v["reasons"]})
        out_clusters.append({"supplierIds": ids, "kind": "duplicate", "certainty": "PROBABLE",
                             "maxWeight": max(v["weight"] for v in members), "reasons": reasons})
    possible = [v for v in verdicts if v["decision"] == "possible"]
    return {
        "clusters": sorted(out_clusters, key=lambda c: -c["maxWeight"]),
        "possible": sorted(possible, key=lambda v: -v["weight"]),
        "sameLegalEntity": [{"pan": pan, "supplierIds": sorted(ids),
                             "reasons": ["same PAN across GSTINs of different states (branches)"]}
                            for pan, ids in sorted(entities.items())],
        "thresholds": {"duplicate": UPPER, "possible": LOWER},
        "parameters": est, "pairsCompared": len(compared),
        "method": "Fellegi-Sunter match weights (log2 m/u) over blocked pairs + union-find; suggestions only, never auto-merged",
    }
