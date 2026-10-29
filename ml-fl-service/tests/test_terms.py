from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import doc, line, flagship


def _req(docs, links=None):
    return type(flagship()).model_validate(
        dict(caseId="c", entityPolicy={"entityId": "ent-1"}, documents=docs, links=links or []))


def test_price_variance_fires():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100, po="PO-1")]),
        doc("I-1", "INVOICE_IN", [line(1, 10, 110, po="PO-1")]),
    ]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "PRICE_VARIANCE" in codes


def test_uom_mismatch_flagged():
    po_line = dict(line(1, 10, 100, po="PO-1")); po_line["uom"] = "BOX"
    inv_line = dict(line(1, 10, 100, po="PO-1")); inv_line["uom"] = "EA"
    docs = [doc("PO-1", "PO", [po_line]), doc("I-1", "INVOICE_IN", [inv_line])]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "QTY_UOM_UNKNOWN_CONVERSION" in codes


def test_ewaybill_missing_above_50k():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 60000)],
                totals={"taxable": "60000", "cgst": "5400", "sgst": "5400",
                        "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"})]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "TAX_EWAYBILL_MISSING" in codes


def test_pay_combined_flagged():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)]), doc("I-2", "INVOICE_IN", [line(1, 1, 100)])]
    links = [
        {"fromId": "P-1", "toId": "I-1", "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference"},
        {"fromId": "P-1", "toId": "I-2", "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference"},
    ]
    codes = {f["code"] for f in reconcile_case(_req(docs, links))["findings"]}
    assert "PAY_COMBINED" in codes
