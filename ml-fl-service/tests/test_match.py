from satya_engine.contracts_v2 import MatchCandidatesRequest
from satya_engine.match.candidates import candidates
from tests.test_engine_api import call


def rec(doc_id, **kw):
    base = {"id": doc_id, "type": "INVOICE_IN"}
    base.update(kw)
    return base


def _req(anchors, pool, task="invoice_po_line"):
    return MatchCandidatesRequest.model_validate({"task": task, "anchors": anchors, "pool": pool})


def test_explicit_ref_gets_near_certain_match():
    anchor = rec("I-1", refs={"poId": "PO-9"}, party={"name": "S", "gstin": "27AAACR5055K1Z7"})
    result = candidates(_req([anchor], [rec("PO-9")]))
    entry = result["results"][0]
    assert entry["certainty"] == "PROBABLE"
    assert entry["predictionSet"][0]["candidateId"] == "PO-9"
    assert entry["predictionSet"][0]["probability"] == "0.98"


def test_similar_number_and_amount_match():
    anchor = rec("I-1", number="INV-1001", description="Centrifugal pump 5HP",
                 amount={"amount": "70800", "currency": "INR"})
    pool = [
        rec("PO-1", number="PO-1001", description="Pump", amount={"amount": "70800", "currency": "INR"}),
        rec("PO-2", number="PO-9999", amount={"amount": "100", "currency": "INR"}),
    ]
    result = candidates(_req([anchor], pool))
    assert result["results"][0]["predictionSet"][0]["candidateId"] == "PO-1"


def test_no_candidates_abstains_honestly():
    anchor = rec("I-1", number="INV-9", amount={"amount": "500", "currency": "INR"})
    result = candidates(_req([anchor], [rec("PO-1", amount={"amount": "999999", "currency": "INR"})]))
    entry = result["results"][0]
    assert entry["certainty"] == "INSUFFICIENT_EVIDENCE"
    assert entry["abstainReason"] == "no candidate above threshold"


def test_ambiguous_set_returns_all_members():
    anchor = rec("I-1", number="INV-1", amount={"amount": "1000", "currency": "INR"})
    pool = [rec(f"PO-{i}", number="PO-1", amount={"amount": "1000", "currency": "INR"}) for i in range(3)]
    result = candidates(_req([anchor], pool))
    entry = result["results"][0]
    assert entry["certainty"] == "AMBIGUOUS"
    assert len(entry["predictionSet"]) == 3


def test_contributions_are_human_readable():
    anchor = rec("I-1", refs={"poId": "PO-1"})
    result = candidates(_req([anchor], [rec("PO-1")]))
    assert result["results"][0]["predictionSet"][0]["contributions"][0]["impact"] == "document states the link"


def test_endpoint_auth(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = _req([rec("I-1")], [rec("PO-1")]).model_dump()
    assert call("POST", "/v2/match/candidates", json=payload).status_code == 401
    assert call("POST", "/v2/match/candidates", json=payload, headers=auth).status_code == 200
