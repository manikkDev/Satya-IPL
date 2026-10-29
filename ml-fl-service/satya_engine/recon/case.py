"""Case orchestration: docs+links → snapshot response for /v2/reconcile/case."""
import hashlib
import json
from collections import defaultdict
from decimal import Decimal

from .ledger import build_ledger
from .detectors.core import run_all
from ..contracts_v2 import BusinessDocument, DocumentLink, Reviews

D = Decimal


def _apply_scenario(docs, links, reviews, scenario):
    """Apply scenario changes ephemerally; returns (docs, links, reviews)."""
    if not scenario:
        return docs, links, reviews
    for change in scenario.changes:
        op = change.op
        if op == "add_document":
            docs = [d for d in docs if d["id"] != change.document.id] + [change.document.model_dump()]
        elif op == "remove_document":
            docs = [d for d in docs if d["id"] != change.documentId]
        elif op == "patch_document":
            docs = [{**d, **change.patch.model_dump(exclude_none=True)} if d["id"] == change.documentId else d for d in docs]
        elif op == "add_link":
            links = links + [change.link.model_dump()]
        elif op == "remove_link":
            links = [l for l in links if not (
                l["fromId"] == change.fromId and l["toId"] == change.toId
                and (change.kind is None or l["kind"] == change.kind))]
        elif op == "set_reviews":
            reviews = change.reviews
    return docs, links, reviews


def _apply_reviews(docs, reviews):
    """Reviewer rulings reshape inputs before reconstruction.

    confirmedDuplicates: drop duplicate docs, keep canonical.
    acceptedVariances: codes to suppress from findings.
    paymentAllocations become reviewer SETTLES links (handled via links).
    """
    suppressed = set()
    if not reviews:
        return docs, suppressed, []
    dup_map = reviews.confirmedDuplicates or {}
    drop = {d for dups in dup_map.values() for d in dups}
    docs = [d for d in docs if d["id"] not in drop]
    for group in reviews.acceptedVariances.values() if reviews.acceptedVariances else []:
        suppressed.update(v.findingCode for v in group)
    settle_links = []
    for payment_id, splits in (reviews.paymentAllocations or {}).items():
        for split in splits:
            settle_links.append({"fromId": payment_id, "toId": split.documentId,
                                 "kind": "SETTLES", "certainty": "CONFIRMED",
                                 "basis": "reviewer", "amount": split.amount})
    return docs, suppressed, settle_links


def _ambiguities(docs, links):
    """Payments with settled cash but no confirmed invoice target."""
    linked = {l["fromId"] for l in links if l["kind"] == "SETTLES"}
    return [
        {"id": f"ambiguity:{d['id']}", "scope": "invoice_settlement",
         "documentId": d["id"],
         "alternatives": [],
         "neededEvidence": "Supplier remittance advice naming the invoice and amount",
         "certainty": "unresolved"}
        for d in docs
        if d["type"] == "PAYMENT_OUT" and d["id"] not in linked
        and d["status"] not in {"reversed", "cancelled"}
    ]


def _balances(ledger, docs, findings):
    recorded = supported = disputed = D("0")
    for d in docs:
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"} and d.get("totals"):
            grand = D(d["totals"]["grand"])
            recorded += grand
    for po_id, lines in ledger.items():
        for c in lines.values():
            supported += min(c.invoiced_value, c.delivered * (c.invoiced_value / c.invoiced_qty) if c.invoiced_qty else D("0"))
    for f in findings:
        if f["amount"] and f["severity"] == "high":
            disputed += D(f["amount"])
    return {"recordedPayable": str(recorded), "evidenceSupportedPayable": str(supported),
            "disputedExposure": str(disputed), "itcAtRisk": str(disputed)}


def _lines_view(ledger):
    return [
        {"poId": po_id, "poLineNo": None if no == "__doc__" else int(no),
         **counter.as_dict()}
        for po_id, lines in ledger.items()
        for no, counter in lines.items()
    ]


def _graph(docs, links, findings):
    nodes = [{"id": d["id"], "type": d["type"], "stage": "document"} for d in docs]
    edges = [{"from": l["fromId"], "to": l["toId"], "kind": l["kind"],
              "certainty": l["certainty"]} for l in links]
    return {"nodes": nodes, "edges": edges,
            "timeline": sorted((d["observedAt"] for d in docs))}


def reconcile_case(request):
    docs = [d.model_dump() if not isinstance(d, dict) else d for d in request.documents]
    links = [l.model_dump() if not isinstance(l, dict) else l for l in request.links]
    reviews = request.reviews
    if isinstance(reviews, dict):
        reviews = Reviews.model_validate(reviews)
    docs, links, reviews = _apply_scenario(docs, links, reviews, request.scenario)
    docs, suppressed, settle_links = _apply_reviews(docs, reviews)
    links = links + settle_links
    knowledge = request.knowledgeTime
    ledger = build_ledger(docs, links, knowledge)
    findings = [f for f in run_all(ledger, docs, links) if f["code"] not in suppressed]
    ambiguities = _ambiguities(docs, links)
    snapshot_input = {"caseId": request.caseId, "docs": sorted(d["id"] for d in docs),
                      "links": len(links), "knowledgeTime": knowledge,
                      "suppressed": sorted(suppressed)}
    snapshot_id = "snap-" + hashlib.sha256(json.dumps(snapshot_input, sort_keys=True, default=str).encode()).hexdigest()[:20]
    return {
        "snapshotId": snapshot_id, "caseId": request.caseId,
        "ledger": _lines_view(ledger),
        "balances": _balances(ledger, docs, findings),
        "findings": findings,
        "graph": _graph(docs, links, findings),
        "ambiguities": ambiguities,
        "recommendation": {"action": "REVIEW" if findings else "APPROVE", "scope": "case",
                           "reasons": [f["code"] for f in findings[:5]]},
    }
