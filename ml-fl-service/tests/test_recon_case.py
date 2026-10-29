from satya_engine.contracts_v2 import ReconcileCaseRequest
from satya_engine.recon.case import reconcile_case
from tests.test_engine_api import call


def doc(doc_id, doc_type, lines, **kw):
    data = dict(
        id=doc_id, groupId="grp-1", entityId="ent-1", type=doc_type,
        number=doc_id, date="2026-10-01", fy="2026-27", status="posted", revision=1,
        seller={"name": "Siddhi Equipments"}, buyer={"name": "Acme Distributors"},
        currency="INR", source={"channel": "created_in_satya"},
        provenance="CONSTRUCTED_DEMO",
        observedAt="2026-10-01T09:00:00Z", createdAt="2026-10-01T09:00:00Z",
        createdBy="test", updatedAt="2026-10-01T09:00:00Z", lines=lines,
    )
    data.update(kw)
    return data


def line(no, qty, price, po="PO-1001", po_line=1):
    return dict(lineNo=no, description="Pump", qty=str(qty), uom="EA",
                rate=str(price), lineTotal=str(qty * price),
                refs={"poId": po, "poLineNo": po_line})


def flagship():
    return ReconcileCaseRequest.model_validate({
        "caseId": "case-pumps", "entityPolicy": {"entityId": "ent-1"},
        "documents": [
            doc("PO-1001", "PO", [line(1, 4, 15000)], number="PO-1001"),
            doc("GRN-01", "GRN", [line(1, 2, 15000)]),
            doc("INV-041", "INVOICE_IN", [line(1, 4, 15000)],
                totals={"taxable": "60000", "cgst": "5400", "sgst": "5400",
                        "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"}),
            doc("AP-992", "INVOICE_IN", [line(1, 4, 15000)], number="INV-041",
                observedAt="2026-10-02T09:00:00Z",
                totals={"taxable": "60000", "cgst": "5400", "sgst": "5400",
                        "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"}),
        ],
        "links": [
            {"fromId": "AP-992", "toId": "INV-041", "kind": "DUPLICATE_OF",
             "certainty": "PROBABLE", "basis": "rule"},
        ],
    })


def test_flagship_case_balances_and_findings():
    result = reconcile_case(flagship())
    assert result["snapshotId"].startswith("snap-")
    assert result["balances"]["recordedPayable"] == "141600"
    codes = {f["code"] for f in result["findings"]}
    assert "DUPLICATE_INVOICE_SUSPECT" in codes
    assert "INVOICE_QTY_EXCEEDS_RECEIVED" in codes  # 8 invoiced vs 2 delivered per posting
    ledger_row = next(l for l in result["ledger"] if l["poId"] == "PO-1001")
    assert ledger_row["ordered"] == "4"
    assert ledger_row["received"] == "2"
    assert ledger_row["invoicedQty"] == "8"  # both postings counted until duplicate confirmed


def test_confirmed_duplicate_resolves_ledger():
    request = flagship().model_copy(update={
        "reviews": {"confirmedDuplicates": {"INV-041": ["AP-992"]}}})
    result = reconcile_case(request)
    assert result["balances"]["recordedPayable"] == "70800"
    row = next(l for l in result["ledger"] if l["poId"] == "PO-1001")
    assert row["invoicedQty"] == "4"
    assert not any(f["code"] == "DUPLICATE_INVOICE_SUSPECT" for f in result["findings"])


def test_accepted_variance_suppresses_finding():
    request = flagship().model_copy(update={
        "reviews": {"acceptedVariances": {"INV-041": [
            {"findingCode": "INVOICE_QTY_EXCEEDS_RECEIVED",
             "amount": {"amount": "30000.00", "currency": "INR"},
             "reason": "Supplier confirmed pending GRN"}]}}})
    codes = {f["code"] for f in reconcile_case(request)["findings"]}
    assert "INVOICE_QTY_EXCEEDS_RECEIVED" not in codes


def test_scenario_add_and_remove_document_ephemeral():
    base = flagship().model_dump()
    extra = doc("I-NEW", "INVOICE_IN", [line(1, 1, 15000)],
                totals={"taxable": "15000", "cgst": "1350", "sgst": "1350",
                        "igst": "0", "cess": "0", "roundOff": "0", "grand": "17700"})
    request = ReconcileCaseRequest.model_validate({**base, "scenario": {"changes": [
        {"op": "add_document", "document": extra},
        {"op": "remove_document", "documentId": "AP-992"},
    ]}})
    result = reconcile_case(request)
    assert result["balances"]["recordedPayable"] == "88500"  # 70800 + 17700
    # Scenario is ephemeral — the base request is unchanged.
    assert reconcile_case(flagship())["balances"]["recordedPayable"] == "141600"


def test_unallocated_payment_creates_ambiguity():
    request = flagship().model_copy(update={"documents": flagship().documents + [
        type(flagship().documents[0]).model_validate(
            doc("P-1", "PAYMENT_OUT", [line(1, 1, 15000)]))
    ]})
    result = reconcile_case(request)
    assert any(a["documentId"] == "P-1" for a in result["ambiguities"])


def test_snapshot_id_is_deterministic():
    assert reconcile_case(flagship())["snapshotId"] == reconcile_case(flagship())["snapshotId"]


def test_endpoint_auth_and_flag(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = flagship().model_dump(exclude_none=True)
    assert call("POST", "/v2/reconcile/case", json=payload).status_code == 401
    response = call("POST", "/v2/reconcile/case", json=payload, headers=auth)
    assert response.status_code == 200
    assert response.json()["balances"]["recordedPayable"] == "141600"
    monkeypatch.delenv("FEATURE_V2_RECON_V2")
    assert call("POST", "/v2/reconcile/case", json=payload, headers=auth).status_code == 404
