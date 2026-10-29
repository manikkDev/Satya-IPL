"""Price/UOM/terms detectors — deterministic rules over lines and links."""
from decimal import Decimal

from .core import _finding

D = Decimal


def price_variance(docs, tolerance="0.01"):
    """PRICE_VARIANCE — billed rate differs from PO rate beyond tolerance."""
    by_id = {d["id"]: d for d in docs}
    findings = []
    tol = D(tolerance)
    for d in docs:
        if d["type"] != "INVOICE_IN" or d["status"] in {"reversed", "cancelled"}:
            continue
        for line in d["lines"]:
            po_ref = (line.get("refs") or {}).get("poId")
            po = by_id.get(po_ref)
            if not po or not line.get("rate"):
                continue
            po_line = next((l for l in po["lines"]
                            if l["lineNo"] == (line.get("refs") or {}).get("poLineNo")), None)
            if not po_line or not po_line.get("rate"):
                continue
            diff = abs(D(line["rate"]) - D(po_line["rate"]))
            if diff > tol:
                findings.append(_finding(
                    "PRICE_VARIANCE", "high", "CONFIRMED",
                    f"{d['id']} line {line['lineNo']}: rate {line['rate']} vs PO {po_ref} {po_line['rate']}",
                    [{"documentId": d["id"], "lineNo": line["lineNo"]},
                     {"documentId": po_ref, "lineNo": po_line["lineNo"]}], str(diff)))
    return findings


def uom_unknown_conversion(docs):
    """QTY_UOM_UNKNOWN_CONVERSION — UOM differs without an approved pack size."""
    by_id = {d["id"]: d for d in docs}
    findings = []
    for d in docs:
        if d["type"] not in {"GRN", "INVOICE_IN"} or d["status"] in {"reversed", "cancelled"}:
            continue
        for line in d["lines"]:
            po_ref = (line.get("refs") or {}).get("poId")
            po = by_id.get(po_ref)
            if not po:
                continue
            po_line = next((l for l in po["lines"]
                            if l["lineNo"] == (line.get("refs") or {}).get("poLineNo")), None)
            if po_line and line["uom"] != po_line["uom"]:
                findings.append(_finding(
                    "QTY_UOM_UNKNOWN_CONVERSION", "medium", "INSUFFICIENT_EVIDENCE",
                    f"{d['id']} line {line['lineNo']}: UOM {line['uom']} != PO {po_ref} {po_line['uom']}; no approved pack size",
                    [{"documentId": d["id"], "lineNo": line["lineNo"]},
                     {"documentId": po_ref, "lineNo": po_line["lineNo"]}]))
    return findings


def challan_vs_grn(docs):
    """QTY_CHALLAN_VS_GRN — delivery challan qty differs from recorded receipt."""
    by_id = {d["id"]: d for d in docs}
    findings = []
    for grn in docs:
        if grn["type"] != "GRN" or grn["status"] in {"reversed", "cancelled"}:
            continue
        for line in grn["lines"]:
            challan = (line.get("refs") or {}).get("challanId")
            ch = by_id.get(challan)
            if not ch:
                continue
            ch_line = next((l for l in ch["lines"] if l["lineNo"] == (line.get("refs") or {}).get("challanLineNo")), None)
            if ch_line and D(ch_line["qty"]) != D(line["qty"]):
                findings.append(_finding(
                    "QTY_CHALLAN_VS_GRN", "medium", "CONFIRMED",
                    f"GRN {grn['id']} line {line['lineNo']}: received {line['qty']} vs challan {challan} {ch_line['qty']}",
                    [{"documentId": grn["id"], "lineNo": line["lineNo"]},
                     {"documentId": challan, "lineNo": ch_line["lineNo"]}]))
    return findings


def unauthorised_charges(docs):
    """PRICE_UNAUTHORISED_CHARGES — charges present but PO terms don't allow them."""
    by_id = {d["id"]: d for d in docs}
    findings = []
    for d in docs:
        if d["type"] != "INVOICE_IN" or not d.get("charges") or d["status"] in {"reversed", "cancelled"}:
            continue
        po_ref = next((l.get("refs", {}).get("poId") for l in d["lines"] if l.get("refs")), None)
        po = by_id.get(po_ref)
        delivery_terms = ((po or {}).get("terms") or {}).get("deliveryTerms") or ""
        if "inclusive" in delivery_terms.lower() or "included" in delivery_terms.lower():
            continue
        total = sum(D(c["amount"]) for c in d["charges"])
        if total > 0:
            findings.append(_finding(
                "PRICE_UNAUTHORISED_CHARGES", "medium", "PROBABLE",
                f"{d['id']}: {len(d['charges'])} charges totalling {total} not evident in PO {po_ref} terms",
                [{"documentId": d["id"]}], str(total)))
    return findings


def payment_split_combined(docs, links):
    """PAY_SPLIT / PAY_COMBINED — payment↔invoice many-to-many patterns."""
    settled = {}
    for l in links:
        if l["kind"] == "SETTLES" and l["certainty"] == "CONFIRMED":
            settled.setdefault(l["fromId"], []).append(l["toId"])
    findings = []
    invoice_payers = {}
    for payment, invoices in settled.items():
        if len(invoices) > 1:
            findings.append(_finding(
                "PAY_COMBINED", "low", "CONFIRMED",
                f"Payment {payment} settles {len(invoices)} invoices — verify allocation splits",
                [{"documentId": payment}] + [{"documentId": i} for i in invoices]))
        for i in invoices:
            invoice_payers.setdefault(i, []).append(payment)
    for invoice, payers in invoice_payers.items():
        if len(payers) > 1:
            findings.append(_finding(
                "PAY_SPLIT", "low", "CONFIRMED",
                f"Invoice {invoice} settled by {len(payers)} payments",
                [{"documentId": invoice}] + [{"documentId": p} for p in payers]))
    return findings


def invoice_before_grn(docs):
    """DOC_INVOICE_BEFORE_GRN — invoice dated before first receipt."""
    pos = {}
    first_grn = {}
    for d in docs:
        for line in d["lines"]:
            po = (line.get("refs") or {}).get("poId")
            if not po:
                continue
            if d["type"] == "GRN":
                first_grn[po] = min(first_grn.get(po, d["date"]), d["date"])
            pos.setdefault(po, []).append(d)
    findings = []
    for po, invoices in pos.items():
        earliest = first_grn.get(po)
        if not earliest:
            continue
        for d in invoices:
            if d["type"] == "INVOICE_IN" and d["date"] < earliest:
                findings.append(_finding(
                    "DOC_INVOICE_BEFORE_GRN", "low", "CONFIRMED",
                    f"Invoice {d['id']} dated {d['date']} before first GRN {earliest} on {po}",
                    [{"documentId": d["id"]}, {"documentId": po}]))
    return findings


def ewaybill_missing(docs):
    """TAX_EWAYBILL_MISSING — consignment >50k moved without e-way bill ref."""
    return [
        _finding("TAX_EWAYBILL_MISSING", "medium", "CONFIRMED",
                 f"{d['id']}: grand {d['totals']['grand']} exceeds ₹50,000 with no e-way bill number",
                 [{"documentId": d["id"]}], d["totals"]["grand"])
        for d in docs
        if d["type"] in {"INVOICE_IN", "DELIVERY_CHALLAN"} and d.get("totals")
        and D(d["totals"]["grand"]) > 50000 and not d.get("ewayBillNo")
        and d["status"] not in {"reversed", "cancelled"}
    ]


def _reference_date(docs):
    """Latest document date in the set — deterministic 'now' for deadline risk."""
    dates = [d["date"] for d in docs if d.get("date")]
    return max(dates) if dates else None


def rule37_risk(docs, links):
    """TAX_RULE37_RISK — unpaid invoice past or near the 180-day ITC window."""
    from datetime import date, timedelta
    settled = {l["toId"] for l in links if l["kind"] == "SETTLES"}
    ref = _reference_date(docs)
    findings = []
    for d in docs:
        if d["type"] != "INVOICE_IN" or d["id"] in settled or d["status"] in {"reversed", "cancelled"}:
            continue
        if not ref or not d.get("date"):
            continue
        due = date.fromisoformat(d["date"]) + timedelta(days=180)
        days_left = (due - date.fromisoformat(ref)).days
        if days_left <= 30:
            severity = "high" if days_left < 0 else "medium"
            findings.append(_finding(
                "TAX_RULE37_RISK", severity, "POSSIBLE",
                f"Invoice {d['id']} unpaid {'past' if days_left < 0 else f'{days_left}d short of'} the 180-day mark — ITC reversal risk under CGST Rule 37",
                [{"documentId": d["id"]}]))
    return findings


def einvoice_missing(docs, policy):
    """TAX_EINVOICE_MISSING — outgoing invoice without IRN when entity AATO >= 10cr."""
    aato = ((policy or {}).get("tax") or {}).get("aatoBand") if isinstance(policy, dict) else getattr(policy, "aatoBand", None)
    findings = []
    if aato not in {">=10cr", "5-10cr"}:
        return findings
    if aato == "5-10cr":
        return findings  # not yet compulsory; advisory only, no finding
    for d in docs:
        if d["type"] == "INVOICE_OUT" and (d.get("gst") or {}).get("supplyType") and \
           not (d["gst"] or {}).get("irn") and d["status"] not in {"reversed", "cancelled"}:
            findings.append(_finding(
                "TAX_EINVOICE_MISSING", "high", "POSSIBLE",
                f"Invoice {d['id']} has no IRN — e-invoicing is mandatory at this entity's AATO band (>=10cr)",
                [{"documentId": d["id"]}]))
    return findings


def not_in_gstr2b(docs):
    """TAX_NOT_IN_GSTR2B — purchase invoice absent from the GSTR-2B feed."""
    gstr2b = [d for d in docs if d["type"] == "GSTR2B_ENTRY"]
    if not gstr2b:
        return []
    covered = {(e["seller"]["name"].lower(), e["number"].strip().lower()) for e in gstr2b}
    findings = []
    for d in docs:
        if d["type"] == "INVOICE_IN" and d["status"] not in {"reversed", "cancelled"}:
            key = (d["seller"]["name"].lower(), d["number"].strip().lower())
            if key not in covered:
                findings.append(_finding(
                    "TAX_NOT_IN_GSTR2B", "medium", "POSSIBLE",
                    f"Invoice {d['id']} ({d['number']}) not found in the GSTR-2B feed — supplier may not have filed; ITC at risk",
                    [{"documentId": d["id"]}]))
    return findings


def ims_rejected_paid(docs, links):
    """TAX_IMS_REJECTED_BUT_PAID — IMS shows the invoice rejected yet a payment settles it."""
    settled = {l["toId"] for l in links if l["kind"] == "SETTLES"}
    rejected = {d["refs"]["invoiceId"] for d in docs
                if d["type"] == "IMS_ACTION" and (d.get("refs") or {}).get("invoiceId")
                and "reject" in str(d.get("action", d.get("status", ""))).lower()}
    findings = []
    for invoice_id in rejected & settled:
        findings.append(_finding(
            "TAX_IMS_REJECTED_BUT_PAID", "high", "PROBABLE",
            f"Invoice {invoice_id} is rejected in IMS yet a payment settles it — confirm the payment was released knowingly",
            [{"documentId": invoice_id}]))
    return findings


def rate_mismatch(docs, master):
    """TAX_RATE_MISMATCH — declared GST rate disagrees with the verified HSN rate."""
    findings = []
    for d in docs:
        if d["type"] not in {"INVOICE_IN", "INVOICE_OUT"} or not d.get("totals"):
            continue
        taxable = D(d["totals"].get("taxable") or "0")
        if taxable <= 0:
            continue
        tax_total = D(d["totals"].get("cgst") or "0") + D(d["totals"].get("sgst") or "0") + \
                    D(d["totals"].get("igst") or "0")
        effective = (tax_total / taxable * 100).quantize(D("0.01"))
        for line in d.get("lines", []):
            hsn = line.get("hsn")
            if not hsn or not master:
                continue
            hit = master.lookup(hsn, d.get("date"))
            if hit and hit.get("rate") is not None and not hit.get("uncertain"):
                if D(str(hit["rate"])) != effective:
                    findings.append(_finding(
                        "TAX_RATE_MISMATCH", "high", "POSSIBLE",
                        f"{d['id']} line {line['lineNo']}: HSN {hsn} verified rate {hit['rate']}% but invoice effective rate {effective}%",
                        [{"documentId": d["id"], "lineNo": line["lineNo"]}]))
                    break  # one per invoice is enough
    return findings


def run_terms(ledger, docs, links, policy=None, master=None):
    return (price_variance(docs) + uom_unknown_conversion(docs) + challan_vs_grn(docs)
            + unauthorised_charges(docs) + payment_split_combined(docs, links)
            + invoice_before_grn(docs) + ewaybill_missing(docs)
            + rule37_risk(docs, links) + einvoice_missing(docs, policy)
            + not_in_gstr2b(docs) + ims_rejected_paid(docs, links)
            + rate_mismatch(docs, master))
