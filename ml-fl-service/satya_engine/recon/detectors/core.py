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


def exact_duplicate(docs):
    """DUP_EXACT_INVOICE — identical seller+number+FY+total recorded twice."""
    from collections import defaultdict
    groups = defaultdict(list)
    for d in docs:
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"}:
            key = (d["seller"]["name"].lower(), (d["seller"].get("gstin") or "").upper(),
                   d["number"].strip().lower(), d.get("fy"),
                   d.get("totals", {}).get("grand") if d.get("totals") else None)
            groups[key].append(d)
    findings = []
    for (seller, gstin, number, fy, _grand), group in groups.items():
        if len(group) >= 2:
            findings.append(_finding(
                "DUP_EXACT_INVOICE", "high", "CONFIRMED",
                f"Invoice {number} from {seller} recorded {len(group)} times with identical totals — one obligation recorded twice",
                [{"documentId": d["id"]} for d in group]))
    return findings


def cross_entity_duplicate(docs):
    """DUP_CROSS_ENTITY — same seller+number+FY billed in more than one entity."""
    from collections import defaultdict
    entities_of = defaultdict(set)
    members = defaultdict(list)
    for d in docs:
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"}:
            key = (d["seller"]["name"].lower(), (d["seller"].get("gstin") or "").upper(),
                   d["number"].strip().lower(), d.get("fy"))
            entities_of[key].add(d.get("entityId"))
            members[key].append(d)
    findings = []
    for (seller, gstin, number, fy), entities in entities_of.items():
        if len(entities) > 1:
            findings.append(_finding(
                "DUP_CROSS_ENTITY", "high", "PROBABLE",
                f"Invoice {number} from {seller} appears under {len(entities)} entities ({sorted(entities)}) — check whether the same supply was recorded across the group",
                [{"documentId": d["id"]} for d in members[seller, gstin, number, fy]]))
    return findings


def invoiced_exceeds_accepted(ledger):
    """QTY_INVOICED_EXCEEDS_ACCEPTED — billed past QC-accepted quantity."""
    return [
        _finding("QTY_INVOICED_EXCEEDS_ACCEPTED", "high", "CONFIRMED",
                 f"PO {po_id} line {line_no}: invoiced {c.invoiced_qty} exceeds QC-accepted {c.accepted}",
                 [{"documentId": po_id, "lineNo": line_no}])
        for po_id, lines in ledger.items()
        for line_no, c in lines.items()
        if line_no != "__doc__" and c.accepted > 0 and c.invoiced_qty > c.accepted
    ]


def over_delivery(ledger):
    """QTY_OVER_DELIVERY — received more than ordered."""
    return [
        _finding("QTY_OVER_DELIVERY", "medium", "CONFIRMED",
                 f"PO {po_id} line {line_no}: received {c.delivered} beyond ordered {c.ordered} — confirm whether authorised",
                 [{"documentId": po_id, "lineNo": line_no}])
        for po_id, lines in ledger.items()
        for line_no, c in lines.items()
        if line_no != "__doc__" and c.ordered > 0 and c.delivered > c.ordered
    ]


def fy_cutoff(docs):
    """DOC_FY_CUTOFF — document date falls outside its declared financial year."""
    findings = []
    for d in docs:
        fy, doc_date = d.get("fy"), d.get("date")
        if not fy or not doc_date:
            continue
        start_year = int(fy.split("-")[0])
        year, month, _ = (int(p) for p in doc_date.split("-"))
        actual_fy = year if month >= 4 else year - 1
        if actual_fy != start_year:
            findings.append(_finding(
                "DOC_FY_CUTOFF", "medium", "CONFIRMED",
                f"{d['id']}: date {doc_date} falls in FY{actual_fy}-{(actual_fy + 1) % 100:02d}, not declared FY{fy} — likely a cut-off or tagging error",
                [{"documentId": d["id"]}]))
    return findings


def credit_note_pending(docs, links):
    """DOC_CREDIT_NOTE_PENDING — credit note issued but not applied to any invoice."""
    applied = {l["fromId"] for l in links if l["kind"] in {"CREDITS", "APPLIES", "SETTLES"}}
    return [
        _finding("DOC_CREDIT_NOTE_PENDING", "medium", "CONFIRMED",
                 f"Credit note {d['id']} is not applied against any invoice",
                 [{"documentId": d["id"]}],
                 d.get("totals", {}).get("grand") if d.get("totals") else None)
        for d in docs
        if d["type"] in {"CREDIT_NOTE_IN", "CREDIT_NOTE_OUT"}
        and d["status"] not in {"reversed", "cancelled"} and d["id"] not in applied
    ]


def run_all(ledger, docs, links, policy=None, master=None):
    from .flows import run_flows
    from .terms import run_terms
    from .payments import run_payments

    findings = []
    findings += billed_above_received(ledger, docs)
    findings += missing_receipt_evidence(ledger)
    findings += delivery_shortfall(ledger)
    findings += duplicate_invoice_suspect(docs)
    findings += exact_duplicate(docs)
    findings += cross_entity_duplicate(docs)
    findings += invoiced_exceeds_accepted(ledger)
    findings += over_delivery(ledger)
    findings += fy_cutoff(docs)
    findings += credit_note_pending(docs, links)
    findings += currency_conflict(docs, ledger)
    findings += unmatched_invoice(docs, links)
    findings += run_flows(ledger, docs, links)
    findings += run_terms(ledger, docs, links, policy=policy, master=master)
    findings += run_payments(ledger, docs, links)
    return findings
