from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import doc, line, flagship


def _req(docs, links=None):
    return type(flagship()).model_validate(
        dict(caseId="c", entityPolicy={"entityId": "ent-1"}, documents=docs, links=links or []))


def test_utr_repeated_observation():
    docs = [
        doc("P-1", "PAYMENT_OUT", [line(1, 1, 100)], payment={"amount": "100", "utr": "UTR123"}),
        doc("P-2", "PAYMENT_OUT", [line(1, 1, 100)], payment={"amount": "100", "utr": "UTR123"}),
    ]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "DUP_REPEATED_OBSERVATION" in codes


def test_pay_overpayment():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100, po="PO-1")]),
        doc("I-1", "INVOICE_IN", [line(1, 10, 100, po="PO-1")]),
        doc("P-1", "PAYMENT_OUT", [line(1, 15, 100, po="PO-1")]),
    ]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "PAY_OVERPAYMENT" in codes


def test_pay_before_receipt():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100, po="PO-1")]),
        doc("G-1", "GRN", [line(1, 5, 100, po="PO-1")], date="2026-10-10"),
        doc("P-1", "PAYMENT_OUT", [line(1, 10, 100, po="PO-1")], date="2026-10-05"),
    ]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "PAY_BEFORE_RECEIPT" in codes


def test_lut_missing():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)],
                gst={"supplyType": "EXPWOP"})]
    codes = {f["code"] for f in reconcile_case(_req(docs))["findings"]}
    assert "TAX_LUT_MISSING" in codes
