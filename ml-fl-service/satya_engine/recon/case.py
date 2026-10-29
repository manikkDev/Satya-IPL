"""Case orchestration: docs+links → snapshot response for /v2/reconcile/case."""
import hashlib
import json
from collections import defaultdict
from decimal import Decimal

from .ledger import build_ledger
from .detectors.core import run_all
from ..contracts_v2 import BusinessDocument, DocumentLink

D = Decimal


def _canonical_docs(documents):
    """Group invoices confirmed as duplicates; canonical = earliest."""
    return documents


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
    knowledge = request.knowledgeTime
    ledger = build_ledger(docs, links, knowledge)
    findings = run_all(ledger, docs, links)
    snapshot_input = {"caseId": request.caseId, "docs": sorted(d["id"] for d in docs),
                      "links": len(links), "knowledgeTime": knowledge}
    snapshot_id = "snap-" + hashlib.sha256(json.dumps(snapshot_input, sort_keys=True, default=str).encode()).hexdigest()[:20]
    return {
        "snapshotId": snapshot_id, "caseId": request.caseId,
        "ledger": _lines_view(ledger),
        "balances": _balances(ledger, docs, findings),
        "findings": findings,
        "graph": _graph(docs, links, findings),
        "ambiguities": [], "recommendation": {"action": "REVIEW", "scope": "case",
                                              "reasons": [f["code"] for f in findings[:5]]},
    }
