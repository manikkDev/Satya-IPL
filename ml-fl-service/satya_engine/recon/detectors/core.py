"""Core detectors — pure functions over (ledger, documents, links).

Each returns finding dicts. Findings cite evidence via docIds/line refs.
"""
from decimal import Decimal

D = Decimal
RULE = "recon-detectors-v1"


def _finding(code, severity, certainty, message, evidence, amount=None):
    return {"code": code, "severity": severity, "certainty": certainty,
            "message": message, "evidence": evidence, "amount": amount,
            "ruleVersion": RULE}


def billed_above_received(ledger, docs):
    """INVOICE_QTY_EXCEEDS_RECEIVED — per PO line."""
    po_docs = {d["id"]: d for d in docs if d["type"] == "PO"}
    findings = []
    for po_id, lines in ledger.items():
        po = po_docs.get(po_id, {})
        for line_no, c in lines.items():
            if line_no == "__doc__" or c.invoiced_qty <= c.delivered:
                continue
            over_qty = c.invoiced_qty - c.delivered
            rate = next((D(l["rate"]) for l in po.get("lines", []) if str(l["lineNo"]) == line_no and l.get("rate")), None)
            amount = str(over_qty * rate) if rate else None
            findings.append(_finding(
                "INVOICE_QTY_EXCEEDS_RECEIVED", "high", "CONFIRMED",
                f"PO {po_id} line {line_no}: invoiced {c.invoiced_qty} exceeds delivered {c.delivered}",
                [{"documentId": po_id, "lineNo": line_no}], amount))
    return findings


def missing_receipt_evidence(ledger):
    """RECEIPT_EVIDENCE_MISSING — invoiced but nothing delivered."""
    return [
        _finding("RECEIPT_EVIDENCE_MISSING", "high", "CONFIRMED",
                 f"PO {po_id} line {line_no}: invoiced {c.invoiced_qty} with no recorded receipt",
                 [{"documentId": po_id, "lineNo": line_no}], str(c.invoiced_value))
        for po_id, lines in ledger.items()
        for line_no, c in lines.items()
        if line_no != "__doc__" and c.delivered == 0 and c.invoiced_qty > 0
    ]


def delivery_shortfall(ledger):
    """DELIVERY_SHORTFALL — delivered below ordered."""
    return [
        _finding("DELIVERY_SHORTFALL", "medium", "CONFIRMED",
                 f"PO {po_id} line {line_no}: delivered {c.delivered} of ordered {c.ordered}",
                 [{"documentId": po_id, "lineNo": line_no}])
        for po_id, lines in ledger.items()
        for line_no, c in lines.items()
        if line_no != "__doc__" and c.ordered > 0 and c.delivered < c.ordered
    ]


def duplicate_invoice_suspect(docs):
    """DUPLICATE_INVOICE_SUSPECT — same seller+number+amount twice."""
    from collections import defaultdict
    groups = defaultdict(list)
    for d in docs:
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"}:
            key = (d["seller"]["name"].lower(), d["number"].lower(),
                   d.get("totals", {}).get("grand") if d.get("totals") else None)
            groups[key].append(d)
    findings = []
    for (seller, number, _amount), group in groups.items():
        if len(group) < 2:
            continue
        original, *dups = sorted(group, key=lambda d: d["observedAt"])
        findings.append(_finding(
            "DUPLICATE_INVOICE_SUSPECT", "high", "PROBABLE",
            f"Invoice {number} from {seller} appears {len(group)} times — confirm whether one obligation or revised billing",
            [{"documentId": d["id"]} for d in group],
            str(D(group[0]["totals"]["grand"]) * (len(group) - 1)) if group[0].get("totals") else None))
        original_id = original["id"]
    return findings


def currency_conflict(docs, ledger):
    """CURRENCY_CONFLICT — invoice currency differs from its PO."""
    by_id = {d["id"]: d for d in docs}
    findings = []
    for po_id in ledger:
        po = by_id.get(po_id)
        if not po:
            continue
        for d in docs:
            if d["type"] == "INVOICE_IN" and d["currency"] != po["currency"] and any(
                    l.get("refs", {}).get("poId") == po_id for l in d["lines"]):
                findings.append(_finding(
                    "CURRENCY_CONFLICT", "high", "CONFIRMED",
                    f"Invoice {d['id']} is in {d['currency']} but PO {po_id} is {po['currency']}; not converted",
                    [{"documentId": d["id"]}, {"documentId": po_id}]))
    return findings


def unmatched_invoice(docs, links):
    """INVOICE_NO_PO_LINK — invoice with no confirmed PO reference."""
    linked_from = {l["fromId"] for l in links if l["certainty"] == "CONFIRMED"}
    return [
        _finding("INVOICE_NO_PO_LINK", "medium", "CONFIRMED",
                 f"Invoice {d['id']} has no explicit or confirmed PO reference",
                 [{"documentId": d["id"]}], d.get("totals", {}).get("grand") if d.get("totals") else None)
        for d in docs
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"}
        and not any(l.get("refs", {}).get("poId") for l in d["lines"])
        and d["id"] not in linked_from
    ]


def run_all(ledger, docs, links):
    from .flows import run_flows
    from .terms import run_terms

    findings = []
    findings += billed_above_received(ledger, docs)
    findings += missing_receipt_evidence(ledger)
    findings += delivery_shortfall(ledger)
    findings += duplicate_invoice_suspect(docs)
    findings += currency_conflict(docs, ledger)
    findings += unmatched_invoice(docs, links)
    findings += run_flows(ledger, docs, links)
    findings += run_terms(ledger, docs, links)
    return findings
