from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import app
from settings import settings

client = TestClient(app)
INTERNAL_HEADERS = {"x-internal-token": settings.NODE_INTERNAL_TOKEN}


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["service"] == "ml-fl-service"
    assert body["phase"] == "demo-complete"
    assert body["port"] == 8000
    assert isinstance(body["model_ready"], bool)


def test_internal_endpoints_reject_missing_token() -> None:
    for path in ("/datasets", "/fl/runs", "/fl/summary", "/privacy/epsilon"):
        assert client.get(path).status_code == 401
    assert client.post("/predict", json={"rows": []}).status_code == 401


def test_datasets() -> None:
    response = client.get("/datasets", headers=INTERNAL_HEADERS)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_epsilon_endpoint_and_target_solve() -> None:
    response = client.get("/privacy/epsilon", params={"noise": 0.8, "rounds": 8}, headers=INTERNAL_HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["epsilon"] > 0
    solved = client.get("/privacy/epsilon", params={"rounds": 8, "target_epsilon": 10}, headers=INTERNAL_HEADERS).json()
    assert solved["noise_multiplier"] > 0
    assert solved["epsilon"] == pytest.approx(10, rel=0.15)


def test_predict_unknown_run_is_404() -> None:
    response = client.post("/predict", json={"run_id": "definitely_missing", "rows": [{"amount": 10.0, "type": "PAYMENT"}]}, headers=INTERNAL_HEADERS)
    assert response.status_code == 404


def test_fl_status_unknown_run_is_404() -> None:
    response = client.get("/fl/status/definitely_missing", headers=INTERNAL_HEADERS)
    assert response.status_code == 404


def test_fl_runs_returns_list() -> None:
    response = client.get("/fl/runs", headers=INTERNAL_HEADERS)
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.skipif(not (Path(settings.RUNS_DIR) / "default_run.txt").exists(), reason="no seeded artifacts")
def test_predict_with_default_model() -> None:
    response = client.post(
        "/predict",
        json={"rows": [{"amount": 50000.0, "type": "TRANSFER", "oldbalanceOrg": 60000.0, "oldbalanceDest": 0.0}], "explain": True},
        headers=INTERNAL_HEADERS,
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["risk_scores"]) == 1
    assert 0.0 <= body["risk_scores"][0] <= 1.0
    assert body["risk_band"][0] in {"low", "medium", "high"}
    assert body["explanations"] and len(body["explanations"][0]) > 0
