"""Runtime link suggestion: block -> featurize -> score -> calibrate -> decide -> explain.

POST /v2/link/suggest takes a tenant's candidate documents (raw-ish
BusinessDocument dicts) and returns auto / review suggestions with
calibrated scores and plain-English reasons. Model links are never
CONFIRMED: the caller writes auto-zone links as PROBABLE with basis "model".
"""
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .blocking import candidates
from .decide import per_doc
from .docs import FROM_TYPES, KINDS, TASK_OF, TO_TYPES, to_link_doc
from .features import featurize, vectorize
from .model import load, reasons

D = Decimal
Kind = Literal["BILLS", "RECEIVES", "SETTLES"]


class LinkRef(BaseModel):
    model_config = ConfigDict(extra="ignore")
    fromId: str
    toId: str
    kind: str


class LinkSuggestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    documents: list[dict[str, Any]] = Field(max_length=5000)
    fromIds: list[str] | None = Field(default=None, max_length=2000)
    kinds: list[Kind] | None = None
    existingLinks: list[LinkRef] = Field(default_factory=list, max_length=20000)
    rejected: list[LinkRef] = Field(default_factory=list, max_length=20000)
    includeReview: bool = True


def _paise(value):
    return None if value is None else int((value * 100).to_integral_value())


def suggest(request):
    docs = []
    for raw in request.documents:
        if not isinstance(raw, dict) or not raw.get("id") or not raw.get("type"):
            continue
        if str(raw.get("status") or "") in {"cancelled", "reversed", "draft"}:
            continue
        docs.append(to_link_doc(raw))
    by_id = {d.id: d for d in docs}
    raw_by_id = {r["id"]: r for r in request.documents if isinstance(r, dict) and r.get("id")}
    wanted = set(request.fromIds) if request.fromIds else None
    rejected = {(l.fromId, l.toId, l.kind) for l in request.rejected}
    out, models, stats = [], {}, {}
    for kind in request.kinds or KINDS:
        model = load(kind)
        if model is None:
            models[kind] = {"available": False, "reason": f"no artifact for {TASK_OF[kind]}"}
            continue
        models[kind] = {"available": True, "version": model.version, "algorithm": model.algorithm,
                        "thresholds": model.thresholds}
        linked_from = {l.fromId for l in request.existingLinks if l.kind == kind}
        frm = []
        for d in docs:
            if d.type != FROM_TYPES[kind] or d.id in linked_from or (wanted is not None and d.id not in wanted):
                continue
            raw = raw_by_id.get(d.id, {})
            if kind == "SETTLES" and (raw.get("payment") or {}).get("allocations"):
                continue  # already allocated by a person or an import
            if kind != "SETTLES" and any((l.get("refs") or {}).get("poId") for l in raw.get("lines") or []):
                continue  # explicit reference already links it
            frm.append(d)
        to = [d for d in docs if d.type == TO_TYPES[kind]]
        cands = candidates(kind, frm, to)
        n_pairs = 0
        for f in frm:
            lst = [(t, b) for t, b in cands.get(f.id, []) if (f.id, t.id, kind) not in rejected]
            if not lst:
                continue
            rows = featurize(kind, f, lst)
            probs, _margin, contrib = model.predict(vectorize(kind, rows))
            n_pairs += len(rows)
            order = sorted(range(len(lst)), key=lambda i: (-probs[i], lst[i][0].id))
            ranked = []
            for i in order:
                t = lst[i][0]
                target = t.open_amount if t.open_amount is not None else t.amount
                ranked.append((t.id, float(probs[i]), _paise(target), _paise(t.taxable or target)))
            pay = _paise(f.amount + (f.tds or D("0"))) if f.amount is not None else None
            decided = per_doc(kind, ranked, model.thresholds, pay)
            index_of = {lst[i][0].id: i for i in range(len(lst))}
            auto_ids = [d[0] for d in decided if d[2] == "auto"]
            for to_id, p, zone, basis in decided:
                if zone == "review" and not request.includeReview:
                    continue
                i = index_of[to_id]
                t = lst[i][0]
                why = reasons(kind, rows[i], contrib[i], model.keys, f, t)
                texts = [w["text"] for w in why]
                if basis:
                    texts.insert(0, f"Payment reconciles with {'these invoices' if len(auto_ids) > 1 else 'this invoice'} ({basis})")
                runner = [r for r in ranked if r[0] != to_id]
                if zone == "review" and runner and runner[0][1] >= model.thresholds["review"]:
                    texts.append(f"{len(runner)} other candidate(s) also plausible — a person should choose")
                entry = {"fromId": f.id, "toId": to_id, "kind": kind, "score": round(p, 4), "zone": zone,
                         "reasons": texts, "explanation": why, "modelVersion": model.version,
                         "blocks": sorted(lst[i][1])}
                if kind == "SETTLES" and zone == "auto":
                    entry["amount"] = _settle_amount(f, t, [by_id[x] for x in auto_ids], basis)
                if kind != "SETTLES":
                    entry["lineRefs"] = _line_refs(f, t)
                out.append(entry)
        stats[kind] = {"fromDocuments": len(frm), "pairsScored": n_pairs}
    return {"suggestions": out, "models": models, "stats": stats,
            "policy": "auto-zone links are PROBABLE (never CONFIRMED) and reversible; review-zone links need a person"}


def _line_refs(frm, to, floor=0.6):
    from .features import _line_sim
    out = []
    for a in frm.lines:
        best = max(((_line_sim(a, b), b) for b in to.lines), key=lambda x: x[0], default=(0, None))
        if best[1] is not None and best[0] >= floor and a.line_no is not None and best[1].line_no is not None:
            out.append({"fromLineNo": int(a.line_no), "toLineNo": int(best[1].line_no)})
    return out


def _settle_amount(payment, invoice, chosen, basis):
    """Cash this payment applies to one invoice of its auto set (2-dp string)."""
    target = invoice.open_amount if invoice.open_amount is not None else invoice.amount
    if len(chosen) == 1:
        return str(min(payment.amount, target).quantize(D("0.01")))
    if basis and "TDS" in basis:
        total_tax = sum(((c.taxable or c.amount) for c in chosen), D("0"))
        share = (invoice.taxable or target) / total_tax if total_tax else D("0")
        gross = sum(((c.open_amount if c.open_amount is not None else c.amount) for c in chosen), D("0"))
        tds_total = gross - payment.amount
        return str((target - tds_total * share).quantize(D("0.01")))
    if basis and "bank" in basis and chosen[-1].id == invoice.id:
        gross = sum(((c.open_amount if c.open_amount is not None else c.amount) for c in chosen), D("0"))
        return str((target - (gross - payment.amount)).quantize(D("0.01")))
    return str(target.quantize(D("0.01")))
