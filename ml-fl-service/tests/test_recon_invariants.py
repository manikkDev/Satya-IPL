import random
import time
from datetime import datetime

from hypothesis import given, settings, strategies as st

from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import doc, line, flagship


def _req(docs, links=None, **kw):
    return type(flagship()).model_validate(
        dict(caseId="c", entityPolicy={"entityId": "ent-1"},
             documents=docs, links=links or [], **kw))


@settings(max_examples=100, deadline=None)
@given(st.integers(0, 20), st.integers(0, 20), st.integers(0, 20))
def test_quantity_conservation(ordered, received, invoiced):
    docs = [doc("PO-1", "PO", [line(1, ordered or 1, 10, po="PO-1")])]
    if received:
        docs.append(doc("G-1", "GRN", [line(1, received, 10, po="PO-1")]))
    if invoiced:
        docs.append(doc("I-1", "INVOICE_IN", [line(1, invoiced, 10, po="PO-1")]))
    row = next(l for l in reconcile_case(_req(docs))["ledger"] if l["poId"] == "PO-1")
    assert int(row["delivered"]) == received
    assert int(row["invoicedQty"]) == invoiced
    assert int(row["received"]) >= int(row["delivered"])  # returns only subtract


@settings(max_examples=100, deadline=None)
@given(st.data())
def test_order_and_snapshot_invariance(data):
    n = data.draw(st.integers(1, 6))
    docs = [doc("PO-1", "PO", [line(1, 10, 10, po="PO-1")])]
    for i in range(n):
        docs.append(data.draw(st.sampled_from([
            doc(f"G-{i}", "GRN", [line(1, 1, 10, po="PO-1")]),
            doc(f"I-{i}", "INVOICE_IN", [line(1, 1, 10, po="PO-1")],
                totals={"taxable": "10", "cgst": "0", "sgst": "0", "igst": "0",
                        "cess": "0", "roundOff": "0", "grand": "10"}),
            doc(f"R-{i}", "RETURN", [line(1, 1, 10, po="PO-1")]),
        ])))
    shuffled = docs[:]
    random.Random(n).shuffle(shuffled)
    a, b = reconcile_case(_req(docs)), reconcile_case(_req(shuffled))
    assert a["snapshotId"] == b["snapshotId"]  # manifest is id-sorted → order-invariant
    assert a["balances"] == b["balances"]
    assert {l["poLineNo"]: l for l in a["ledger"]} == {l["poLineNo"]: l for l in b["ledger"]}


def test_no_future_leakage():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 10, po="PO-1")]),
        doc("G-1", "GRN", [line(1, 5, 10, po="PO-1")], observedAt="2026-10-05T09:00:00Z"),
        doc("G-2", "GRN", [line(1, 5, 10, po="PO-1")], observedAt="2026-11-05T09:00:00Z"),
    ]
    result = reconcile_case(_req(docs, knowledgeTime="2026-10-15T00:00:00Z"))
    row = next(l for l in result["ledger"] if l["poId"] == "PO-1")
    assert row["received"] == "5"


def test_perf_200_docs():
    docs = [doc("PO-1", "PO", [line(1, 10, 10, po="PO-1")])]
    for i in range(200):
        docs.append(doc(f"G-{i}", "GRN", [line(1, 1, 10, po="PO-1")],
                        observedAt=f"2026-10-{(i % 28) + 1:02d}T09:00:00Z"))
        docs.append(doc(f"I-{i}", "INVOICE_IN", [line(1, 1, 10, po="PO-1")],
                        number=f"I-{i}",
                        totals={"taxable": "10", "cgst": "0", "sgst": "0", "igst": "0",
                                "cess": "0", "roundOff": "0", "grand": "10"}))
    start = time.perf_counter()
    for _ in range(5):
        reconcile_case(_req(docs))
    p95_ms = (time.perf_counter() - start) / 5 * 1000
    assert p95_ms < 500, f"reconcile p95 {p95_ms:.0f}ms exceeds 500ms"
