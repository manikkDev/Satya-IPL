from satya_engine.contracts_v2 import MatchCandidatesRequest, MatchRecord
from satya_engine.match.active import suggest_pairs
from satya_engine.match.pairs import train
from tests.test_engine_api import call


def rec(doc_id, **kw):
    return MatchRecord.model_validate(dict(id=doc_id, type="INVOICE_IN", **kw))


def test_suggest_pairs_ranks_by_informativeness():
    anchors = [rec(f"I-{i}", number=f"INV-{i}", amount={"amount": str(1000 * (i + 1)), "currency": "INR"}) for i in range(3)]
    pool = [rec(f"P-{i}", number=f"PO-{i}", amount={"amount": str(1000 * (i + 1)), "currency": "INR"}) for i in range(3)]
    result = suggest_pairs(anchors, pool)
    assert result["pairs"]
    assert all("informativeness" in p for p in result["pairs"])
    assert result["pairs"] == sorted(result["pairs"], key=lambda p: -float(p["informativeness"]))


def test_train_accepts_labelled_pairs(tmp_path):
    labelled = [{"anchor": {"id": "I-9", "type": "INVOICE_IN", "number": "INV-9"},
                 "candidate": {"id": "PO-9", "type": "PO", "number": "PO-9"}, "label": 1}]
    result = train(task="invoice_po_line", seed=42, n_pos=25, out_dir=tmp_path,
                   labelled_pairs=labelled)
    assert result["pairs"] > 0


def test_train_endpoint_allow_train_name(monkeypatch, auth, tmp_path):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    monkeypatch.setenv("ALLOW_TRAIN", "1")
    import satya_engine.match.pairs as pairs
    monkeypatch.setattr(pairs, "MODEL_DIR", tmp_path)
    labelled = [{"anchor": {"id": "I-1", "type": "INVOICE_IN", "number": "INV-1"},
                 "candidate": {"id": "PO-1", "type": "PO", "number": "PO-1"}, "label": 1}]
    response = call("POST", "/v2/train", json={"task": "invoice_po_line", "seed": 42,
                                             "n_pos": 20, "labelledPairs": labelled}, headers=auth)
    assert response.status_code == 200
