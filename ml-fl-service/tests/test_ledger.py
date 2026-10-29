from datetime import datetime

from satya_engine.recon.ledger import build_ledger, events


def doc(doc_id, doc_type, lines, **kw):
    data = dict(
        id=doc_id, groupId="grp-1", entityId="ent-1", type=doc_type,
        number=doc_id, date="2026-10-01", fy="2026-27",
        status="posted", revision=1,
        seller={"name": "Fixture Supplier"}, buyer={"name": "Fixture Buyer"},
        currency="INR",
        source={"channel": "created_in_satya"},
        provenance="CONSTRUCTED_DEMO",
        observedAt="2026-10-01T09:00:00Z",
        createdAt="2026-10-01T09:00:00Z",
        createdBy="test",
        updatedAt="2026-10-01T09:00:00Z",
        lines=lines,
    )
    data.update(kw)
    return data


def line(no, qty, price, po="PO-1", po_line=1):
    return dict(lineNo=no, description="Fixture", qty=str(qty), uom="EA",
                rate=str(price), lineTotal=str(qty * price),
                refs={"poId": po, "poLineNo": po_line})


def test_event_ordering_and_knowledge_cutoff():
    early = doc("I-1", "INVOICE_IN", [line(1, 10, 100)], observedAt="2026-10-01T10:00:00Z")
    late = doc("G-1", "GRN", [line(1, 5, 100)], observedAt="2026-10-02T10:00:00Z")
    stream = events([late, early], [])
    assert [e["docId"] for e in stream] == ["I-1", "G-1"]
    cutoff = events([early, late], [], datetime.fromisoformat("2026-10-01T12:00:00+00:00"))
    assert [e["docId"] for e in cutoff] == ["I-1"]


def test_line_counters_fold():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100, "PO-1", 1)]),
        doc("G-1", "GRN", [line(1, 6, 100)]),
        doc("G-2", "GRN", [line(1, 4, 100)]),
        doc("Q-1", "QC", [line(1, 8, 100)]),
        doc("R-1", "RETURN", [line(1, 2, 100)]),
        doc("I-1", "INVOICE_IN", [line(1, 10, 100)]),
        doc("C-1", "CREDIT_NOTE_IN", [line(1, 1, 100)]),
        doc("P-1", "PAYMENT_OUT", [line(1, 5, 100)]),
    ]
    counters = build_ledger(docs, [])["PO-1"]["1"]
    assert counters.ordered == 10
    assert counters.received == 10
    assert counters.delivered == 8
    assert counters.accepted == 8
    assert counters.returned == 2
    assert counters.invoiced_qty == 10
    assert counters.invoiced_value == 1000
    assert counters.credited_value == 100
    assert counters.paid_value == 500


def test_reversed_and_unknown_docs_ignored():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100)]),
        doc("G-X", "GRN", [line(1, 99, 100)], status="reversed"),
        doc("X-1", "PR", [line(1, 99, 100)]),
    ]
    counters = build_ledger(docs, [])["PO-1"]["1"]
    assert counters.received == 0
    assert counters.ordered == 10


def test_confirmed_link_resolves_without_explicit_ref():
    po = doc("PO-1", "PO", [line(1, 10, 100)])
    invoice = doc("I-1", "INVOICE_IN",
                  [dict(lineNo=1, description="Fixture", qty="10", uom="EA",
                        rate="100", lineTotal="1000")])
    links = [dict(fromId="I-1", toId="PO-1", kind="BILLS",
                  certainty="CONFIRMED", basis="reference")]
    counters = build_ledger([po, invoice], links)["PO-1"]["__doc__"]
    assert counters.invoiced_qty == 10


def test_model_link_never_moves_counters():
    po = doc("PO-1", "PO", [line(1, 10, 100)])
    invoice = doc("I-1", "INVOICE_IN",
                  [dict(lineNo=1, description="Fixture", qty="10", uom="EA",
                        rate="100", lineTotal="1000")])
    links = [dict(fromId="I-1", toId="PO-1", kind="BILLS",
                  certainty="PROBABLE", basis="model", confidence="0.9")]
    counters = build_ledger([po, invoice], links)["PO-1"]["1"]
    assert counters.invoiced_qty == 0
    assert counters.invoiced_value == 0


def test_order_invariance():
    docs = [
        doc("PO-1", "PO", [line(1, 10, 100)]),
        doc("G-1", "GRN", [line(1, 6, 100)]),
        doc("I-1", "INVOICE_IN", [line(1, 4, 100)]),
    ]
    a = build_ledger(docs, [])
    b = build_ledger(list(reversed(docs)), [])
    assert {k: c.as_dict() for k, c in a["PO-1"].items()} == \
           {k: c.as_dict() for k, c in b["PO-1"].items()}
