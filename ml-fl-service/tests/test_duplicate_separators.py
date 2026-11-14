from satya_engine.recon.detectors.core import duplicate_invoice_suspect, _canonical_invoice_number


def _inv(id_, number, observed):
    return {"id": id_, "type": "INVOICE_IN", "status": "posted", "number": number,
            "seller": {"name": "Meridian Pump Supply"}, "totals": {"grand": "70800.00"},
            "observedAt": observed}


def test_canonical_number_ignores_separators_and_case():
    assert _canonical_invoice_number("MPS/26-27/041") == _canonical_invoice_number("mps 26-27-041")


def test_same_bill_keyed_with_different_separators_is_a_suspected_duplicate():
    findings = duplicate_invoice_suspect([
        _inv("a", "MPS/26-27/041", "2026-10-01T10:00:00+05:30"),
        _inv("b", "MPS-26-27-041", "2026-10-02T10:00:00+05:30"),
    ])
    assert len(findings) == 1
    assert {e["documentId"] for e in findings[0]["evidence"]} == {"a", "b"}


def test_different_bills_are_not_duplicates():
    assert duplicate_invoice_suspect([
        _inv("a", "MPS/26-27/041", "2026-10-01T10:00:00+05:30"),
        _inv("b", "MPS/26-27/042", "2026-10-02T10:00:00+05:30"),
    ]) == []
