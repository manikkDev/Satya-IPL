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


def _settles(pid, amount, inv="I-1"):
    return {"fromId": pid, "toId": inv, "kind": "SETTLES", "certainty": "CONFIRMED", "basis": "reference",
            "amount": {"amount": str(amount), "currency": "INR"}}


def _payment(pid, amount, utr, date="2026-10-05"):
    return doc(pid, "PAYMENT_OUT", [], date=date,
               payment={"amount": str(amount), "utr": utr, "mode": "NEFT", "valueDate": date})


def _invoice(grand=118):
    return doc("I-1", "INVOICE_IN", [line(1, 1, 100)], totals=totals(100, 9, 9, 0, grand))


def _codes(docs, links):
    return [f["code"] for f in reconcile_case(type(flagship()).model_validate(req(docs, links)))["findings"]]


def test_same_amount_paid_twice_beyond_invoice_is_duplicate():
    docs = [_invoice(), _payment("P-1", 118, "UTR1"), _payment("P-2", 118, "UTR2", "2026-10-07")]
    codes = _codes(docs, [_settles("P-1", 118), _settles("P-2", 118)])
    assert "DUP_PAYMENT" in codes


def test_same_utr_on_two_payments_is_duplicate():
    docs = [_invoice(), _payment("P-1", 59, "UTRX"), _payment("P-2", 59, "utrx")]
    codes = _codes(docs, [_settles("P-1", 59), _settles("P-2", 59)])
    assert "DUP_PAYMENT" in codes


def test_split_payment_within_invoice_is_not_duplicate():
    # two equal halves of one invoice: a legitimate split, not a double pay
    docs = [_invoice(), _payment("P-1", 59, "UTR1"), _payment("P-2", 59, "UTR2")]
    codes = _codes(docs, [_settles("P-1", 59), _settles("P-2", 59)])
    assert "DUP_PAYMENT" not in codes
    assert "PAY_SPLIT" in codes


def test_unequal_split_within_invoice_is_not_duplicate():
    docs = [_invoice(), _payment("P-1", 100, "UTR1"), _payment("P-2", 18, "UTR2")]
    codes = _codes(docs, [_settles("P-1", 100), _settles("P-2", 18)])
    assert "DUP_PAYMENT" not in codes


def test_same_amount_far_apart_beyond_invoice_is_not_duplicate():
    docs = [_invoice(), _payment("P-1", 118, "UTR1", "2026-10-01"), _payment("P-2", 118, "UTR2", "2026-12-01")]
    codes = _codes(docs, [_settles("P-1", 118), _settles("P-2", 118)])
    assert "DUP_PAYMENT" not in codes
