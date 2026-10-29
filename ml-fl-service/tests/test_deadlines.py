from satya_engine.contracts_v2 import ComplianceDeadlinesRequest
from satya_engine.deadlines import deadlines
from tests.test_engine_api import call
from tests.test_recon_case import doc, line


def _req(docs, suppliers=None, as_of="2026-10-29", policy=None):
    return ComplianceDeadlinesRequest.model_validate(dict(
        documents=docs, suppliers=suppliers or [], policy=policy, asOf=as_of))


def invoice(doc_id, date="2026-10-01", grand="70800", **kw):
    return doc(doc_id, "INVOICE_IN", [line(1, 4, 15000)], date=date,
               seller={"name": "S", "supplierId": "sup-1"},
               totals={"taxable": "60000", "cgst": "5400", "sgst": "5400",
                       "igst": "0", "cess": "0", "roundOff": "0", "grand": grand}, **kw)


def test_msme_supplier_gets_45day_deadline():
    result = deadlines(_req([invoice("I-1")], suppliers=[{"id": "sup-1", "msme": True}]))
    msme = next(d for d in result["deadlines"] if d["kind"] == "MSME_45")
    assert msme["dueDate"] == "2026-11-15"
    assert msme["daysLeft"] == 17
    assert msme["amount"]["amount"] == "70800"


def test_rule37_fires_on_unpaid_invoice():
    result = deadlines(_req([invoice("I-1")]))
    r37 = next(d for d in result["deadlines"] if d["kind"] == "RULE_37_180")
    assert r37["dueDate"] == "2027-03-30"


def test_settled_invoice_skips_deadlines():
    links = [{"fromId": "P-1", "toId": "I-1", "kind": "SETTLES",
              "certainty": "CONFIRMED", "basis": "reference"}]
    result = deadlines(_req([invoice("I-1")],
                            suppliers=[{"id": "sup-1", "msme": True}]), links)
    assert not any(d["kind"] in {"MSME_45", "RULE_37_180"} for d in result["deadlines"])


def test_einvoice_missing_irn_deadline():
    result = deadlines(_req([invoice("I-1", gst={"supplyType": "B2B"})]))
    assert any(d["kind"] == "EINVOICE_30" for d in result["deadlines"])
    result = deadlines(_req([invoice("I-1", gst={"supplyType": "B2B", "irn": "x" * 64})]))
    assert not any(d["kind"] == "EINVOICE_30" for d in result["deadlines"])


def test_po_schedule_deadline():
    po_line = dict(line(1, 10, 100, po="PO-1")); po_line["scheduleDate"] = "2026-12-15"
    result = deadlines(_req([doc("PO-1", "PO", [po_line])]))
    d = next(x for x in result["deadlines"] if x["kind"] == "PO_DELIVERY")
    assert d["dueDate"] == "2026-12-15"
    assert "delivery schedule" in d["basis"]


def test_policy_overrides_days():
    result = deadlines(_req([invoice("I-1")], suppliers=[{"id": "sup-1", "msme": True}],
                            policy={"msmeDays": 30}))
    msme = next(d for d in result["deadlines"] if d["kind"] == "MSME_45")
    assert msme["dueDate"] == "2026-10-31"


def test_udyam_category_counts_as_msme():
    result = deadlines(_req([invoice("I-1")], suppliers=[
        {"id": "sup-1", "udyam": {"number": "UDYAM-XX-00-0000000", "category": "micro"}}]))
    assert any(d["kind"] == "MSME_45" for d in result["deadlines"])


def test_endpoint_auth(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = _req([invoice("I-1")]).model_dump()
    assert call("POST", "/v2/compliance/deadlines", json=payload).status_code == 401
    assert call("POST", "/v2/compliance/deadlines", json=payload, headers=auth).status_code == 200
