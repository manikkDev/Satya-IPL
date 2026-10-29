"""Payment, tax and document-flow detectors — deterministic rules only."""
from decimal import Decimal

from ...india.gstin import validate_gstin
from .core import _finding

D = Decimal


def tax_arithmetic(docs):
    """TAX_ARITHMETIC — declared totals don't equal sum of parts."""
    findings = []
    for d in docs:
        t = d.get("totals")
        if not t or d["status"] in {"reversed", "cancelled"}:
            continue
        computed = sum(D(t[k]) for k in ("taxable", "cgst", "sgst", "igst", "cess")) + D(t["roundOff"])
        if computed != D(t["grand"]):
            findings.append(_finding(
                "TAX_ARITHMETIC", "high", "CONFIRMED",
                f"{d['type']} {d['id']}: declared grand {t['grand']} != parts {computed}; no repair guessed",
                [{"documentId": d["id"]}], str(abs(computed - D(t["grand"])))))
    return findings


def gstin_invalid(docs):
    """TAX_GSTIN_INVALID — checksum fails or state code mismatches address."""
    findings = []
    for d in docs:
        if d["status"] in {"reversed", "cancelled"}:
            continue
        for role in ("seller", "buyer"):
            party = d.get(role) or {}
            gstin = party.get("gstin")
            if not gstin:
                continue
            check = validate_gstin(gstin)
            if not (check["wellFormed"] and check["checksumValid"]):
                findings.append(_finding(
                    "TAX_GSTIN_INVALID", "high", "CONFIRMED",
                    f"{d['id']} {role} GSTIN fails format or checksum",
                    [{"documentId": d["id"], "field": f"{role}.gstin"}]))
            elif party.get("stateCode") and check["stateCode"] != party["stateCode"]:
                findings.append(_finding(
                    "TAX_GSTIN_INVALID", "medium", "CONFIRMED",
                    f"{d['id']} {role} GSTIN state {check['stateCode']} != declared {party['stateCode']}",
                    [{"documentId": d["id"], "field": f"{role}.gstin"}]))
    return findings


def tax_type_mismatch(docs):
    """TAX_TYPE_MISMATCH — IGST charged intra-state or CGST/SGST inter-state."""
    findings = []
    for d in docs:
        if d["type"] not in {"INVOICE_IN", "CREDIT_NOTE_IN"} or d["status"] in {"reversed", "cancelled"}:
            continue
        t = d.get("totals")
        seller_state = (d.get("seller") or {}).get("stateCode")
        place = d.get("placeOfSupply") or (d.get("buyer") or {}).get("stateCode")
        if not t or not seller_state or not place:
            continue
        intra = seller_state == place
        igst, cgst_sgst = D(t["igst"]), D(t["cgst"]) + D(t["sgst"])
        if intra and igst > 0:
            findings.append(_finding(
                "TAX_TYPE_MISMATCH", "high", "CONFIRMED",
                f"{d['id']}: IGST {t['igst']} charged on intra-state supply ({seller_state}) — ITC risk",
                [{"documentId": d["id"]}], t["igst"]))
        elif not intra and cgst_sgst > 0:
            findings.append(_finding(
                "TAX_TYPE_MISMATCH", "high", "CONFIRMED",
                f"{d['id']}: CGST/SGST charged on inter-state supply ({seller_state}→{place}) — ITC risk",
                [{"documentId": d["id"]}], str(cgst_sgst)))
    return findings


def duplicate_payment(docs, links):
    """DUP_PAYMENT — two settled payments targeting the same invoice."""
    settled = {}
    for l in links:
        if l["kind"] == "SETTLES" and l["certainty"] == "CONFIRMED":
            settled.setdefault(l["toId"], []).append(l["fromId"])
    findings = []
    for invoice_id, payers in settled.items():
        if len(payers) > 1:
            findings.append(_finding(
                "DUP_PAYMENT", "high", "PROBABLE",
                f"Invoice {invoice_id} settled by {len(payers)} payments — verify not a double pay",
                [{"documentId": invoice_id}] + [{"documentId": p} for p in payers]))
    return findings


def advance_not_adjusted(docs):
    """DUP_ADVANCE_NOT_ADJUSTED — advance paid and full invoice also paid."""
    findings = []
    advance_by_po = {}
    paid_by_po = {}
    for d in docs:
        po = next((l.get("refs", {}).get("poId") for l in d["lines"] if l.get("refs")), None)
        if not po or d["status"] in {"reversed", "cancelled"}:
            continue
        if d["type"] == "ADVANCE_OUT" and d.get("payment"):
            advance_by_po[po] = advance_by_po.get(po, D("0")) + D(d["payment"]["amount"])
        if d["type"] == "PAYMENT_OUT" and d.get("payment"):
            paid_by_po[po] = paid_by_po.get(po, D("0")) + D(d["payment"]["amount"])
    for po, advance in advance_by_po.items():
        if advance > 0 and paid_by_po.get(po, D("0")) > 0:
            findings.append(_finding(
                "DUP_ADVANCE_NOT_ADJUSTED", "medium", "PROBABLE",
                f"PO {po}: advance {advance} paid but payment also posted — check advance was adjusted",
                [{"documentId": po}], str(advance)))
    return findings


def doc_missing_invoice(ledger):
    """DOC_MISSING_INVOICE — goods delivered, nothing billed."""
    return [
        _finding("DOC_MISSING_INVOICE", "low", "CONFIRMED",
                 f"PO {po_id} line {no}: {c.delivered} units delivered, none invoiced",
                 [{"documentId": po_id, "lineNo": no}])
        for po_id, lines in ledger.items()
        for no, c in lines.items()
        if no != "__doc__" and c.delivered > 0 and c.invoiced_qty == 0
    ]


def po_amended_after_supply(docs):
    """DOC_PO_AMENDED_AFTER_SUPPLY — PO revision after GRN/invoice observed."""
    pos = {d["id"]: d for d in docs if d["type"] == "PO"}
    events_after = {}
    for d in docs:
        po_ref = next((l.get("refs", {}).get("poId") for l in d["lines"] if l.get("refs")), None)
        if po_ref and d["type"] in {"GRN", "INVOICE_IN"}:
            events_after.setdefault(po_ref, []).append(d["observedAt"])
    findings = []
    for d in docs:
        if d["type"] == "PO_AMENDMENT":
            target = d.get("supersedes") or next(
                (l.get("refs", {}).get("poId") for l in d["lines"] if l.get("refs")), None)
            earlier = events_after.get(target, [])
            if earlier and d["observedAt"] > min(earlier):
                findings.append(_finding(
                    "DOC_PO_AMENDED_AFTER_SUPPLY", "medium", "CONFIRMED",
                    f"PO amendment {d['id']} observed after supply/invoice events on {target}",
                    [{"documentId": d["id"]}, {"documentId": target}]))
    return findings


def run_flows(ledger, docs, links):
    return (tax_arithmetic(docs) + gstin_invalid(docs) + tax_type_mismatch(docs)
            + duplicate_payment(docs, links) + advance_not_adjusted(docs)
            + doc_missing_invoice(ledger) + po_amended_after_supply(docs))
