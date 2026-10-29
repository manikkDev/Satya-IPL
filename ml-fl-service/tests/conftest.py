import pytest


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.setenv("NODE_INTERNAL_TOKEN", "owner-test-token-not-a-production-secret")
    return {"x-internal-token": "owner-test-token-not-a-production-secret"}
