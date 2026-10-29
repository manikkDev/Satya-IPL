from satya_engine.evaluate import report
from tests.test_engine_api import call


def test_report_shape_and_honesty():
    r = report(seed=42)
    assert r["provenance"].startswith("CONSTRUCTED_DEMO")
    assert "blocking" in r and "model" in r and "limitations" in r
    assert r["blocking"]["positives"] > 0


def test_eval_endpoint_auth(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    assert call("GET", "/v2/evaluation/report").status_code == 401
    assert call("GET", "/v2/evaluation/report", headers=auth).status_code == 200


def test_train_disabled_by_default(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    monkeypatch.delenv("ALLOW_ENGINE_TRAIN", raising=False)
    response = call("POST", "/v2/train", json={"task": "invoice_po_line"}, headers=auth)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "TRAINING_DISABLED"


def test_train_enabled(monkeypatch, auth, tmp_path):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    monkeypatch.setenv("ALLOW_ENGINE_TRAIN", "1")
    import satya_engine.match.pairs as pairs
    monkeypatch.setattr(pairs, "MODEL_DIR", tmp_path)
    response = call("POST", "/v2/train", json={"task": "invoice_po_line", "seed": 42, "n_pos": 25}, headers=auth)
    assert response.status_code == 200
    assert response.json()["pairs"] > 0
