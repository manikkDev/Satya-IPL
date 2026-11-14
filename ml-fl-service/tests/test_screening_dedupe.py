"""Anomaly screening findings and Fellegi-Sunter supplier dedupe."""
from satya_engine.linking.datasets.common import make_gstin
from satya_engine.match.supplier_fs import duplicates
from satya_engine.screening import run_screening
from tests.test_engine_api import call


def inv(i, rate, day="2026-05-01", grand=None, supplier="sup1", qty="10"):
    return {"id": f"inv{i}", "type": "INVOICE_IN", "number": f"I/{i}", "date": day, "status": "posted", "fy": "2026-27",
            "seller": {"name": "Shakti", "supplierId": supplier},
            "lines": [{"lineNo": 1, "sku": "PMP-5HP", "description": "pump", "qty": qty, "rate": str(rate)}],
            "totals": {"grand": str(grand or rate * 10)}}


def test_price_outlier_needs_history_and_is_possible_low_or_medium():
    docs = [inv(i, 21400 + i * 50) for i in range(6)] + [inv(99, 29000)]
    flags = [f for f in run_screening(docs) if f["code"] == "SCREEN_PRICE_OUTLIER"]
    assert len(flags) == 1 and flags[0]["certainty"] == "POSSIBLE" and flags[0]["severity"] in ("low", "medium")
    assert flags[0]["evidence"][0]["documentId"] == "inv99"
    assert not [f for f in run_screening(docs[:3] + [inv(99, 29000)]) if f["code"] == "SCREEN_PRICE_OUTLIER"]


def test_below_approval_limit_pattern():
    docs = [inv(i, 1, day=f"2026-05-0{i + 1}", grand=99000 + i) for i in range(3)]
    flags = [f for f in run_screening(docs) if f["code"] == "SCREEN_BELOW_APPROVAL_LIMIT"]
    assert flags and flags[0]["severity"] == "medium"


def test_new_bank_account_payment():
    def pay(i, acct, day, amt="1000"):
        return {"id": f"p{i}", "type": "PAYMENT_OUT", "date": day, "status": "posted", "seller": {"name": "S", "supplierId": "s"},
                "lines": [], "payment": {"amount": amt, "bankAccountMasked": acct}}
    docs = [pay(1, "****1111", "2026-04-01"), pay(2, "****1111", "2026-05-01"), pay(3, "****9999", "2026-05-10", "5000")]
    flags = [f for f in run_screening(docs) if f["code"] == "SCREEN_NEW_BANK_ACCOUNT_PAYMENT"]
    assert len(flags) == 1 and flags[0]["evidence"][0]["documentId"] == "p3" and flags[0]["severity"] == "medium"


def test_screening_never_drives_recommendation_and_model_links_count():
    from satya_engine.contracts_v2 import ReconcileCaseRequest, ReconcileCaseResponse
    from satya_engine.recon.case import reconcile_case
    from tests.test_recon_case import doc

    def ln(no, qty, rate, po=None):
        out = dict(lineNo=no, description="Pump", qty=str(qty), uom="EA", rate=str(rate), lineTotal=str(qty * rate))
        if po:
            out["refs"] = {"poId": po, "poLineNo": no}
        return out
    totals = {"taxable": "60000", "cgst": "5400", "sgst": "5400", "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"}
    docs = [doc("PO-1", "PO", [ln(1, 4, 15000)]), doc("GRN-1", "GRN", [ln(1, 4, 15000, "PO-1")]),
            doc("INV-1", "INVOICE_IN", [ln(1, 4, 15000)], totals=totals)]
    model_link = {"fromId": "INV-1", "toId": "PO-1", "kind": "BILLS", "certainty": "PROBABLE", "basis": "model",
                  "confidence": "0.97", "lineRefs": [{"fromLineNo": 1, "toLineNo": 1}]}
    request = ReconcileCaseRequest.model_validate({"caseId": "c", "entityPolicy": {"entityId": "ent-1"},
                                                   "documents": docs, "links": [model_link]})
    out = reconcile_case(request)
    ReconcileCaseResponse.model_validate(out)
    codes = {f["code"] for f in out["findings"]}
    assert "INVOICE_NO_PO_LINK" not in codes  # certified model link resolves the PO
    row = next(r for r in out["ledger"] if r["poId"] == "PO-1" and r["poLineNo"] == 1)
    assert row["invoicedQty"] == "4"
    assert not any(r.startswith("SCREEN_") for r in out["recommendation"]["reasons"])
    unlinked = reconcile_case(ReconcileCaseRequest.model_validate(
        {"caseId": "c", "entityPolicy": {"entityId": "ent-1"}, "documents": docs,
         "links": [dict(model_link, certainty="POSSIBLE")]}))
    assert "INVOICE_NO_PO_LINK" in {f["code"] for f in unlinked["findings"]}  # review-zone links never count


def test_dedupe_duplicates_branches_and_name_only():
    pan = "AAHCS6742Q"
    sups = [
        {"id": "a", "name": "Shree Ganesh Engineering Works Pvt Ltd", "pan": pan, "gstins": [make_gstin("27", pan)], "pincode": "411019"},
        {"id": "b", "name": "M/s SHRI GANESH ENGG. WORKS PRIVATE LIMITED", "pan": pan, "gstins": [make_gstin("27", pan)]},
        {"id": "c", "name": "Shree Ganesh Engineering Works Pvt Ltd", "pan": pan, "gstins": [make_gstin("29", pan, 2)]},
        {"id": "d", "name": "Kaveri Polymers", "pan": "BBBPK1234L"},
        {"id": "e", "name": "Kaveri Polymer", "pincode": "560001"},
    ]
    out = duplicates(sups)
    assert any(set(c["supplierIds"]) == {"a", "b"} for c in out["clusters"])
    assert not any("c" in c["supplierIds"] for c in out["clusters"])  # branch, not duplicate
    assert out["sameLegalEntity"] and set(out["sameLegalEntity"][0]["supplierIds"]) >= {"a", "c"}
    assert any({v["a"], v["b"]} == {"d", "e"} for v in out["possible"])  # name-only -> review


def test_dedupe_endpoint(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    body = {"suppliers": [{"id": "a", "name": "Alpha Traders", "pan": "AAAPA1111A"},
                          {"id": "b", "name": "Alpha Trdrs", "pan": "AAAPA1111A"}]}
    r = call("POST", "/v2/suppliers/duplicates", json=body, headers=auth)
    assert r.status_code == 200 and r.json()["clusters"]
