"""Score-then-solve allocation: tolerances, ambiguity, many candidates, N:M."""
import pytest
from hypothesis import given, settings, strategies as st

from satya_engine.contracts_v2 import AllocateBatchRequest, AllocatePaymentRequest
from satya_engine.recon.allocate import allocate, allocate_batch
from tests.test_engine_api import call


def req(amount, invoices, **kw):
    return AllocatePaymentRequest.model_validate(dict(
        payment={"id": "P-1", "amount": {"amount": str(amount), "currency": "INR"}, **kw.pop("payment", {})},
        openInvoices=[{"id": f"I-{i}", "openAmount": {"amount": str(a), "currency": "INR"}, **extra}
                      for i, (a, extra) in enumerate((x if isinstance(x, tuple) else (x, {})) for x in invoices)],
        **kw))


@pytest.mark.parametrize("rate", ["0.1", "1", "2", "0.10", "1.0"])
def test_decimal_tds_rates_never_crash(rate):
    # regression: 15000 / (1 - 0.001) has a non-terminating expansion -> used to 500
    result = allocate(req("15000.00", ["15000.00", "9000.00"], tdsPolicy={"deductOnPayment": True, "rate": rate}))
    assert result["certainty"] in {"CONFIRMED", "PROBABLE", "POSSIBLE", "INSUFFICIENT_EVIDENCE"}


def test_policy_tds_point_one_percent_endpoint(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = req("117882.00", ["118000.00", "50000.00"],
                  tdsPolicy={"deductOnPayment": True, "rate": "0.1"}).model_dump()
    response = call("POST", "/v2/allocate/payment", json=payload, headers=auth)
    assert response.status_code == 200
    body = response.json()
    assert body["certainty"] == "CONFIRMED"
    best = body["solutions"][0]
    assert best["mode"] == "policy_tds" and best["tdsAmount"]["amount"] == "118.00"
    assert [a["documentId"] for a in best["allocations"]] == ["I-0"]


def test_tds_tolerance_without_policy_is_probable_not_confirmed():
    # 1% TDS (194C) on taxable 100000 grossed 118000 -> but rate applies to the gross here
    result = allocate(req("116820.00", ["118000.00"]))
    assert result["solutions"][0]["mode"] == "tds"
    assert result["certainty"] == "PROBABLE"
    assert result["needsReview"] is True


def test_bank_charges_tolerance_configurable():
    loose = allocate(req("49970.50", ["50000.00"]))
    assert loose["solutions"][0]["mode"] == "bank_charges"
    assert loose["solutions"][0]["bankCharges"]["amount"] == "29.50"
    strict = allocate(req("49970.50", ["50000.00"], tolerance={"bankChargeMax": "10"}))
    assert strict["solutions"] == []


def test_ambiguity_margin_refuses_to_guess():
    result = allocate(req("5000", ["5000", "5000"]))
    assert result["ambiguous"] is True and result["certainty"] == "POSSIBLE"
    assert result["alternatives"] == 1


def test_narration_reference_breaks_tie():
    result = allocate(req("5000", [("5000", {"number": "SIS/26-27/0067"}), ("5000", {"number": "SIS/26-27/0071"})],
                          payment={"narration": "NEFT/HDFC/SHAKTI INV SIS/26-27/0071"}))
    assert result["ambiguous"] is False
    assert result["solutions"][0]["allocations"][0]["documentId"] == "I-1"
    assert any("quotes" in r for r in result["solutions"][0]["reasons"])


def test_many_candidates_beyond_old_cap():
    amounts = [100000 + i * i * 13 + i for i in range(60)]
    result = allocate(req(str(amounts[7] + amounts[33]), [str(a) for a in amounts],
                          tolerance={"tdsRates": [], "bankChargeMax": "0"}))
    ids = [{a["documentId"] for a in s["allocations"]} for s in result["solutions"]]
    assert {"I-7", "I-33"} in ids


def test_amounts_are_exact_paise():
    result = allocate(req("0.30", ["0.10", "0.20", "0.25"],
                          tolerance={"roundingPaise": 0, "tdsRates": [], "bankChargeMax": "0"}))
    assert result["certainty"] == "CONFIRMED"
    best = {a["documentId"] for a in result["solutions"][0]["allocations"]}
    assert best == {"I-0", "I-1"}


@settings(max_examples=40, deadline=None)
@given(st.lists(st.integers(min_value=1, max_value=10 ** 7), min_size=1, max_size=8), st.data())
def test_every_solution_balances(amounts, data):
    chosen = data.draw(st.lists(st.sampled_from(range(len(amounts))), min_size=1, max_size=len(amounts), unique=True))
    pay = sum(amounts[i] for i in chosen)
    result = allocate(req(f"{pay // 100}.{pay % 100:02d}", [f"{a // 100}.{a % 100:02d}" for a in amounts],
                          tolerance={"tdsRates": [], "bankChargeMax": "0"}))
    assert result["solutions"], "a feasible exact allocation exists"
    for sol in result["solutions"]:
        total = sum(int(a["amount"]["amount"].replace(".", "")) for a in sol["allocations"])
        assert abs(total - pay) <= 100


def test_batch_hungarian_and_milp():
    request = AllocateBatchRequest.model_validate({
        "payments": [{"id": "P1", "amount": {"amount": "1000", "currency": "INR"}},
                     {"id": "P2", "amount": {"amount": "2500", "currency": "INR"}},
                     {"id": "P3", "amount": {"amount": "700", "currency": "INR"}}],
        "openInvoices": [{"id": "A", "openAmount": {"amount": "1000", "currency": "INR"}},
                         {"id": "B", "openAmount": {"amount": "1200", "currency": "INR"}},
                         {"id": "C", "openAmount": {"amount": "1300", "currency": "INR"}},
                         {"id": "D", "openAmount": {"amount": "700", "currency": "INR"}}],
        "tolerance": {"tdsRates": [], "bankChargeMax": "0"}})
    out = allocate_batch(request)
    pairs = {(x["paymentId"], x["allocations"][0]["documentId"]) for x in out["oneToOne"]}
    assert ("P1", "A") in pairs and ("P3", "D") in pairs
    m2m = out["manyToMany"]
    assert {a["documentId"] for a in m2m["allocations"]} == {"B", "C"}


def test_batch_endpoint(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = {"payments": [{"id": "P1", "amount": {"amount": "1000", "currency": "INR"}}],
               "openInvoices": [{"id": "A", "openAmount": {"amount": "1000", "currency": "INR"}}]}
    assert call("POST", "/v2/allocate/batch", json=payload, headers=auth).status_code == 200
