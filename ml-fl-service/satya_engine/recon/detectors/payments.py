"""Payment-side detectors — UTR dedupe, overpayment, timing, LUT."""
from decimal import Decimal

from .core import _finding

D = Decimal


def utr_repeated_observation(docs):
    """DUP_REPEATED_OBSERVATION — same UTR appears in multiple payment records."""
    from collections import defaultdict
    by_utr = defaultdict(list)
    for d in docs:
        if d["type"] in {"PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT"} and (d.get("payment") or {}).get("utr"):
            by_utr[d["payment"]["utr"].strip().upper()].append(d)
    findings = []
    for utr, group in by_utr.items():
        if len(group) > 1:
            findings.append(_finding(
                "DUP_REPEATED_OBSERVATION", "low", "CONFIRMED",
                f"UTR {utr} appears in {len(group)} records — likely a repeated import, not new cash",
                [{"documentId": d["id"]} for d in group]))
    return findings


def pay_overpayment(ledger, docs):
    """PAY_OVERPAYMENT — paid value exceeds invoiced minus credited."""
    return [
        _finding("PAY_OVERPAYMENT", "high", "PROBABLE",
                 f"PO {po_id} line {no}: paid {c.paid_value} exceeds net billed {c.invoiced_value - c.credited_value}",
                 [{"documentId": po_id, "lineNo": no}], str(c.paid_value - (c.invoiced_value - c.credited_value)))
        for po_id, lines in ledger.items()
        for no, c in lines.items()
        if no != "__doc__" and c.invoiced_qty > 0 and c.paid_value > c.invoiced_value - c.credited_value
    ]


def pay_before_receipt(docs, ledger):
    """PAY_BEFORE_RECEIPT — non-advance payment before goods delivered."""
    first_grn = {}
    for d in docs:
        if d["type"] == "GRN":
            for line in d["lines"]:
                po = (line.get("refs") or {}).get("poId")
                if po:
                    first_grn[po] = min(first_grn.get(po, d["date"]), d["date"])
    findings = []
    for d in docs:
        if d["type"] != "PAYMENT_OUT" or d["status"] in {"reversed", "cancelled"}:
            continue
        po = next((l.get("refs", {}).get("poId") for l in d["lines"] if l.get("refs")), None)
        earliest = first_grn.get(po)
        if po and (earliest is None or d["date"] < earliest):
            findings.append(_finding(
                "PAY_BEFORE_RECEIPT", "medium", "CONFIRMED",
                f"Payment {d['id']} dated {d['date']} {'before any receipt' if earliest is None else f'before first GRN {earliest}'} on {po}",
                [{"documentId": d["id"]}, {"documentId": po}]))
    return findings


def tax_lut_missing(docs):
    """TAX_LUT_MISSING — zero-rated export/SEZ invoice without a valid FY LUT."""
    return [
        _finding("TAX_LUT_MISSING", "high", "CONFIRMED",
                 f"{d['id']}: {(d.get('gst') or {}).get('supplyType')} billed with no LUT valid for its financial year",
                 [{"documentId": d["id"]}])
        for d in docs
        if d["type"] == "INVOICE_IN" and (d.get("gst") or {}).get("supplyType") in {"EXPWOP", "SEZWOP"}
        and d["status"] not in {"reversed", "cancelled"}
        and not (lambda g: g.get("lut") and g["lut"].get("arn") and g["lut"].get("fy"))(d.get("gst") or {})
    ]


def run_payments(ledger, docs, links):
    return (utr_repeated_observation(docs) + pay_overpayment(ledger, docs)
            + pay_before_receipt(docs, ledger) + tax_lut_missing(docs))
