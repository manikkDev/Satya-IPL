import asyncio
import importlib

import httpx
import pytest

from app import app
from satya_engine.business_contracts import ReconcileRequest
from satya_engine.business_demo import demo_bundle
from satya_engine.business_reconcile import reconcile


def call(method, path, **kwargs):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://engine") as client:
            return await client.request(method, path, **kwargs)

    return asyncio.run(request())


@pytest.fixture
def auth(monkeypatch):
    monkeypatch.setenv("NODE_INTERNAL_TOKEN", "owner-test-token-not-a-production-secret")
    return {"x-internal-token": "owner-test-token-not-a-production-secret"}


def test_public_health_and_root():
    assert call("GET", "/").status_code == 200
    for path in ("/health", "/ready"):
        response = call("GET", path)
        assert response.status_code == 200
        assert response.json()["engineVersion"] == "2.0.0"
        assert response.json()["rulesReady"] is True


@pytest.mark.parametrize("path", ["/internal/demo", "/internal/evaluation", "/internal/import-preview", "/internal/reconcile"])
def test_internal_routes_require_auth(path):
    method = "POST" if path.endswith(("preview", "reconcile")) else "GET"
    assert call(method, path, json={} if method == "POST" else None).status_code == 401


def test_legacy_reconcile_contract_unchanged(auth):
    bundle = demo_bundle()
    for case in bundle["cases"]:
        payload = dict(caseId=case["id"], companyId="satya-demo", poId=case["poId"],
                       records=case["records"], observedBefore=bundle["clock"])
        expected = reconcile(ReconcileRequest(**payload))
        response = call("POST", "/internal/reconcile", headers=auth, json=payload)
        assert response.status_code == 200
        assert response.json() == expected
    assert call("GET", "/internal/demo", headers=auth).json() == bundle
    assert call("GET", "/internal/evaluation", headers=auth).status_code == 200


@pytest.mark.parametrize("module", ["contracts", "demo", "imports", "matching", "reconcile", "training"])
def test_compatibility_import_identity(module):
    assert importlib.import_module(f"business_{module}") is importlib.import_module(f"satya_engine.business_{module}")
