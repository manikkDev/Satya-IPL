from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import doc, line, flagship


def req(docs, links=None):
    return {"caseId": "c", "entityPolicy": {"entityId": "ent-1"},
            "documents": docs, "links": links or []}


def totals(taxable, cgst, sgst, igst, grand, **kw):
    return dict(taxable=str(taxable), cgst=str(cgst), sgst=str(sgst), igst=str(igst),
                cess="0", roundOff="0", grand=str(grand), **kw)


def test_tax_arithmetic_fires():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)],
                totals=totals(100, 9, 9, 0, 200))]  # 118 != 200
    codes = {f["code"] for f in reconcile_case(type(flagship()).model_validate(req(docs)))["findings"]}
    assert "TAX_ARITHMETIC" in codes


def test_gstin_invalid_and_state_mismatch():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)],
                seller={"name": "S", "gstin": "27AAACR5055K1Z0", "stateCode": "27"})]
    codes = {f["code"] for f in reconcile_case(type(flagship()).model_validate(req(docs)))["findings"]}
    assert "TAX_GSTIN_INVALID" in codes


def test_igst_on_intrastate_flagged():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)],
                seller={"name": "S", "stateCode": "27"},
                buyer={"name": "B", "stateCode": "27"}, placeOfSupply="27",
                totals=totals(100, 0, 0, 18, 118))]
    codes = {f["code"] for f in reconcile_case(type(flagship()).model_validate(req(docs)))["findings"]}
    assert "TAX_TYPE_MISMATCH" in codes


def test_two_payments_same_invoice_flagged():
    docs = [doc("I-1", "INVOICE_IN", [line(1, 1, 100)])]
    links = [
        {"fromId": "P-1", "toId": "I-1", "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference"},
        {"fromId": "P-2", "toId": "I-1", "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference"},
    ]
    codes = {f["code"] for f in reconcile_case(type(flagship()).model_validate(req(docs, links)))["findings"]}
    assert "DUP_PAYMENT" in codes
