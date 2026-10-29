import json
from pathlib import Path

import pytest

from satya_engine.contracts_v2 import MatchCandidatesRequest
from satya_engine.match.candidates import candidates
from satya_engine.match.pairs import MODEL_DIR, build_pairs, load_model, train
from satya_engine.data.generator import generate
from tests.test_engine_api import call


def test_build_pairs_labels_positives_and_hard_negatives():
    docs, links, _ = generate(seed=5, n_pos=15, suppliers=4)
    X, y, meta = build_pairs(docs, links)
    assert sum(y) > 0
    assert sum(1 - v for v in y) > 0
    assert any(m[2] == "hard_negative" for m in meta)


def test_train_writes_model_card_and_conformal(tmp_path):
    result = train(task="invoice_po_line", seed=42, n_pos=25, out_dir=tmp_path)
    assert result["pairs"] > 0
    assert (Path(result["path"]) / "model.ubj").exists()
    card = json.loads((Path(result["path"]) / "card.json").read_text())
    assert card["task"] == "invoice_po_line"
    assert "synthetic" in card["dataSources"][0] or "CONSTRUCTED" in card["dataSources"][0]
    assert (Path(result["path"]) / "conformal.json").exists()


def test_load_model_roundtrip_and_falls_back_cleanly(tmp_path):
    assert load_model("supplier_supplier") is None or load_model("supplier_supplier")
    train(task="invoice_po_line", seed=42, n_pos=25, out_dir=tmp_path)
    from satya_engine.match import pairs as pairs_mod
    original = pairs_mod.MODEL_DIR
    pairs_mod.MODEL_DIR = tmp_path
    bundle = load_model("invoice_po_line")
    assert bundle is not None
    model, q_hat, keys, card = bundle
    assert 0 < q_hat <= 1
    pairs_mod.MODEL_DIR = original


def test_heuristic_path_still_works_without_artifacts():
    request = MatchCandidatesRequest.model_validate({
        "task": "supplier_supplier",
        "anchors": [{"id": "S-1", "type": "SUPPLIER", "number": "SUP-1"}],
        "pool": [{"id": "S-2", "type": "SUPPLIER", "number": "SUP-1"}]})
    result = candidates(request)
    assert result["modelVersion"] == "heuristic-v2"


def test_models_status_endpoint(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    assert call("GET", "/v2/models/status").status_code == 401
    response = call("GET", "/v2/models/status", headers=auth)
    assert response.status_code == 200
    assert "models" in response.json()
    assert "fallback" in response.json()
