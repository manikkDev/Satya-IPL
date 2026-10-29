from satya_engine.anomaly import score
from satya_engine.contracts_v2 import AnomalyScoreRequest
from tests.test_engine_api import call


def record(doc_id, amount, qty, hsn="8401"):
    return {"id": doc_id, "type": "INVOICE_IN", "hsn": hsn,
            "amount": {"amount": str(amount), "currency": "INR"}, "qty": str(qty)}


def _req(docs, history):
    return AnomalyScoreRequest.model_validate({"documents": docs, "history": history})


def test_outlier_gets_high_z():
    history = [record(f"H-{i}", 100 + i, 1) for i in range(8)]  # rates ~100-107
    result = score(_req([record("X-1", 500, 1)], history))
    entry = result["scores"][0]
    assert float(entry["score"]) > 3
    assert "median" in entry["explanation"]
    assert entry["baseline"] is not None


def test_normal_price_low_z():
    history = [record(f"H-{i}", 100 + i, 1) for i in range(8)]
    result = score(_req([record("X-1", 103, 1)], history))
    assert float(result["scores"][0]["score"]) < 1


def test_insufficient_baseline_is_honest():
    result = score(_req([record("X-1", 500, 1)], [record("H-1", 100, 1)]))
    entry = result["scores"][0]
    assert entry["score"] is None
    assert "insufficient baseline" in entry["explanation"]


def test_missing_rate_is_honest():
    result = score(_req([{"id": "X-1", "type": "INVOICE_IN", "hsn": "8401"}], []))
    assert result["scores"][0]["explanation"] == "no computable unit rate"


def test_zero_mad_identical_baseline():
    history = [record(f"H-{i}", 100, 1) for i in range(5)]
    result = score(_req([record("X-1", 200, 1)], history))
    assert float(result["scores"][0]["score"]) >= 10  # capped outlier


def test_endpoint_auth(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = _req([record("X-1", 100, 1)], [record("H-1", 100, 1)]).model_dump()
    assert call("POST", "/v2/anomaly/score", json=payload).status_code == 401
    assert call("POST", "/v2/anomaly/score", json=payload, headers=auth).status_code == 200
