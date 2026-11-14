from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import doc, line, flagship


def _req(docs, links=None):
    return type(flagship()).model_validate(
        dict(caseId="c", entityPolicy={"entityId": "ent-1"}, documents=docs, links=links or []))


def test_qc_accepted_qty_not_inspected_qty():
    qc_line = dict(line(1, 120, 100, po="PO-Q"))
    qc_line["acceptedQty"] = "108"
    qc_line["rejectedQty"] = "12"
    docs = [doc("PO-Q", "PO", [line(1, 120, 100, po="PO-Q")]), doc("G-Q", "GRN", [line(1, 120, 100, po="PO-Q")]),
            doc("QC-Q", "QC", [qc_line]), doc("I-Q", "INVOICE_IN", [line(1, 120, 100, po="PO-Q")])]
    result = reconcile_case(_req(docs))
    row = next(l for l in result["ledger"] if l["poId"] == "PO-Q")
    assert row["accepted"] == "108" and row["rejected"] == "12"
    assert "QTY_INVOICED_EXCEEDS_ACCEPTED" in {f["code"] for f in result["findings"]}


def test_qc_rejected_only_derives_accepted():
    qc_line = dict(line(1, 50, 100, po="PO-R"))
    qc_line["rejectedQty"] = "5"
    docs = [doc("PO-R", "PO", [line(1, 50, 100, po="PO-R")]), doc("QC-R", "QC", [qc_line])]
    row = next(l for l in reconcile_case(_req(docs))["ledger"] if l["poId"] == "PO-R")
    assert row["accepted"] == "45"


def test_shortfall_waits_for_future_schedule_date():
    future = dict(line(1, 10, 100, po="PO-F"))
    future["scheduleDate"] = "2099-01-01"
    past = dict(line(1, 10, 100, po="PO-P"))
    past["scheduleDate"] = "2020-01-01"
    docs = [doc("PO-F", "PO", [future]), doc("G-F", "GRN", [line(1, 4, 100, po="PO-F")]),
            doc("PO-P", "PO", [past]), doc("G-P", "GRN", [line(1, 4, 100, po="PO-P")])]
    shortfalls = [f for f in reconcile_case(_req(docs))["findings"] if f["code"] == "DELIVERY_SHORTFALL"]
    assert [f["evidence"][0]["documentId"] for f in shortfalls] == ["PO-P"]
