import pytest

from satya_engine.contracts_v2 import AllocatePaymentRequest
from satya_engine.recon.allocate import AllocationInputError, allocate
from tests.test_engine_api import call


def req(payment_amount, invoices, **kw):
    return AllocatePaymentRequest.model_validate(dict(
        payment={"id": "P-1", "amount": {"amount": str(payment_amount), "currency": "INR"}},
        openInvoices=[{"id": f"I-{i}", "openAmount": {"amount": str(a), "currency": "INR"}}
                      for i, a in enumerate(invoices)],
        **kw))


def test_unique_exact_match():
    result = allocate(req(15000, [10000, 5000, 7000]))
    assert result["unique"] is True
    assert result["certainty"] == "CONFIRMED"
    assert len(result["solutions"]) == 1
    ids = {a["documentId"] for a in result["solutions"][0]["allocations"]}
    assert ids == {"I-0", "I-1"}
    assert result["solutions"][0]["residual"]["amount"] == "0.00"


def test_multiple_solutions_not_unique():
    result = allocate(req(10000, [10000, 4000, 6000]))
    assert result["unique"] is False
    assert len(result["solutions"]) == 2
    assert result["certainty"] in {"PROBABLE", "POSSIBLE"}


def test_no_exact_solution():
    result = allocate(req(15000, [10000, 4000]))
    assert result["solutions"] == []
    assert result["unique"] is False


def test_credits_join_the_pool():
    result = allocate(req(15000, [10000], credits=[
        {"id": "C-1", "amount": {"amount": "5000", "currency": "INR"}}]))
    assert result["unique"] is True
    ids = {a["documentId"] for a in result["solutions"][0]["allocations"]}
    assert ids == {"I-0", "C-1"}


def test_tds_net_expands_target():
    # Pay 9,990 with 0.1% TDS → covers a 10,000 invoice.
    result = allocate(req(9990, [10000, 5000],
                        tdsPolicy={"deductOnPayment": True, "rate": "0.1"}))
    assert result["unique"] is True
    assert result["solutions"][0]["allocations"][0]["documentId"] == "I-0"


def test_too_many_candidates_errors():
    from satya_engine.contracts_v2 import OpenInvoice
    request = AllocatePaymentRequest.model_validate(dict(
        payment={"id": "P-1", "amount": {"amount": "100", "currency": "INR"}},
        openInvoices=[{"id": f"I-{i}", "openAmount": {"amount": "1", "currency": "INR"}}
                      for i in range(21)]))
    with pytest.raises(AllocationInputError):
        allocate(request)


def test_endpoint_auth(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = req(15000, [10000, 5000]).model_dump()
    assert call("POST", "/v2/allocate/payment", json=payload).status_code == 401
    assert call("POST", "/v2/allocate/payment", json=payload, headers=auth).status_code == 200
