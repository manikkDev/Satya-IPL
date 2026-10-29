from decimal import Decimal

import pytest
from hypothesis import given, settings, strategies as st

from satya_engine.contracts_v2 import TaxComputeRequest
from satya_engine.india.hsn_master import HsnMaster
from satya_engine.india.tax import TaxInputError, compute_tax
from tests.test_engine_api import call


def request(**changes):
    data = dict(
        seller={"stateCode": "27"}, buyer={"stateCode": "27"}, placeOfSupply="27",
        docDate="2026-10-01", currency="INR", roundOff=False, charges=[],
        lines=[dict(lineNo=1, hsn="84010000", qty="10", rate="100", uom="EA", gstRateOverride="18")],
    )
    data.update(changes)
    return TaxComputeRequest.model_validate(data)


def master(rate="18", cess=None, conditional=False):
    # Artificial arithmetic fixture; not a real GST schedule or notification.
    rule = dict(prefix="8401", description="Synthetic fixture only", rate=rate,
                schedule="TEST", sNo="1", effectiveFrom="2000-01-01",
                notificationRef="SYNTHETIC-NOT-LAW", conditional=conditional)
    if cess is not None:
        rule["cessRate"] = cess
    return HsnMaster(dict(
        version="fixture", builtAt="2000-01-01T00:00:00Z", sources=[],
        codes=[dict(code="84010000", description="Test item", chapter="84")],
        rateRules=[rule],
    ))


def calculate(payload=None, reference=None):
    return compute_tax(payload or request(), master=reference or master())


def test_intra_state_split_and_words():
    result = calculate()
    assert result["totals"]["cgst"] == "90.00"
    assert result["totals"]["sgst"] == "90.00"
    assert result["totals"]["igst"] == "0.00"
    assert result["totals"]["grand"] == "1180.00"
    assert result["amountInWords"] == "Rupees One Thousand One Hundred Eighty Only"


def test_inter_state_igst():
    result = calculate(request(placeOfSupply="29"))
    assert result["totals"]["igst"] == "180.00"
    assert result["totals"]["cgst"] == "0.00"
    assert result["totals"]["sgst"] == "0.00"


@pytest.mark.parametrize("state", ["04", "25", "26", "31", "35", "38", "97"])
def test_utgst_not_mislabelled_as_sgst(state):
    result = calculate(request(seller={"stateCode": state}, buyer={"stateCode": state}, placeOfSupply=state))
    assert result["totals"]["utgst"] == "90.00"
    assert result["totals"]["sgst"] == "0.00"
    assert result["totals"]["cgst"] == "90.00"


@pytest.mark.parametrize("state", ["01", "07", "34"])
def test_ut_with_legislature_uses_sgst(state):
    result = calculate(request(seller={"stateCode": state}, buyer={"stateCode": state}, placeOfSupply=state))
    assert result["totals"]["utgst"] == "0.00"
    assert result["totals"]["sgst"] == "90.00"


def test_discount_taxable_rounds_before_tax():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="3", rate="33.335",
                                 discountPct="10", uom="EA", gstRateOverride="18")])
    result = calculate(payload)
    assert result["lines"][0]["taxableValue"] == "90.00"
    assert result["totals"]["grand"] == "106.20"


def test_round_off_is_separate_and_half_up():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate="100.50",
                                 uom="EA", gstRateOverride="0")], roundOff=True)
    result = calculate(payload)
    assert result["totals"]["roundOff"] == "0.50"
    assert result["totals"]["grand"] == "101.00"


@pytest.mark.parametrize("supply", ["EXPWOP", "SEZWOP"])
def test_lut_zero_rated_only_for_supplied_fy(supply):
    result = calculate(request(supplyType=supply, lut={"arn": "DEMO-LUT-NOT-VERIFIED", "fy": "2026-27"}))
    assert result["lines"][0]["gstRate"] == "0"
    assert result["totals"]["grand"] == "1000.00"
    assert result["zeroRated"] is True


@pytest.mark.parametrize("lut", [None, {"arn": "DEMO-LUT", "fy": "2025-26"}])
def test_missing_or_wrong_fy_lut_does_not_invent_zero_tax(lut):
    result = calculate(request(supplyType="EXPWOP", lut=lut, placeOfSupply="99"))
    assert result["totals"]["igst"] == "180.00"
    assert any(item["code"] == "LUT_MISSING_OR_INVALID" for item in result["warnings"])


def test_reverse_charge_excluded_from_supplier_payable_not_erased():
    result = calculate(request(reverseCharge=True))
    assert result["totals"]["grand"] == "1000.00"
    assert result["totals"]["cgst"] == "90.00"
    assert result["payableBy"] == "recipient"


def test_freight_has_own_explicit_rate():
    result = calculate(request(charges=[dict(kind="freight", description="Declared freight",
                                            amount="100", gstRate="5")]))
    assert result["charges"][0]["lineTotal"] == "105.00"
    assert result["totals"]["grand"] == "1285.00"


def test_unknown_charge_rate_warns_instead_of_inventing_tax():
    result = calculate(request(charges=[dict(kind="freight", description="Unknown rate", amount="100")]))
    assert result["charges"][0]["lineTotal"] == "100.00"
    assert result["totals"]["grand"] == "1280.00"
    assert any(item["code"] == "CHARGE_RATE_MISSING" for item in result["warnings"])


def test_missing_rate_never_assumes_standard_or_zero_rate():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate="100", uom="EA")])
    with pytest.raises(TaxInputError, match="verified"):
        compute_tax(payload, master=HsnMaster())
    assert calculate(payload)["lines"][0]["rateSource"]["notificationRef"] == "SYNTHETIC-NOT-LAW"


def test_conditional_master_rate_requires_explicit_override():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate="100", uom="EA")])
    with pytest.raises(TaxInputError):
        calculate(payload, master(conditional=True))


def test_cess_and_multi_rate_summary():
    payload = request(lines=[
        dict(lineNo=1, hsn="84010000", qty="1", rate="100", uom="EA", gstRateOverride="18"),
        dict(lineNo=2, hsn="84010000", qty="1", rate="100", uom="EA", gstRateOverride="5"),
    ])
    result = calculate(payload, master(cess="2"))
    assert result["totals"]["cess"] == "4.00"
    assert len(result["taxSummary"]) == 2
    assert result["totals"]["grand"] == "227.00"


def test_special_percentage_is_fixture_not_legal_claim():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate="100", uom="EA")])
    assert calculate(payload, master(rate="40"))["totals"]["grand"] == "140.00"


def test_nullable_policy_flags_and_hsn_warning():
    result = calculate()
    assert result["flags"]["einvoiceExpected"] is None
    assert result["flags"]["hsnDigitsRequired"] is None
    assert result["flags"]["tds194qApplicable"] is None


def test_explicit_einvoice_policy_and_hsn_band():
    result = calculate(request(policy={"aatoBand": ">=10cr", "einvoiceApplicable": False}))
    assert result["flags"]["einvoiceExpected"] is False
    assert result["flags"]["hsnDigitsRequired"] == 6


def test_eway_bill_threshold_strictly_exceeds_and_uses_tax():
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate="50000",
                                 uom="EA", gstRateOverride="0")])
    assert calculate(payload)["flags"]["ewayBillRequired"] is False
    payload.lines[0].rate = "50000.01"
    assert calculate(payload)["flags"]["ewayBillRequired"] is True


def test_invalid_gstin_and_address_state_mismatch_warnings():
    result = calculate(request(seller={"stateCode": "29", "gstin": "27AAACR5055K1Z0"}))
    assert {"GSTIN_INVALID", "GSTIN_STATE_MISMATCH"} <= {item["code"] for item in result["warnings"]}


def test_place_of_supply_derivation_and_visible_assumption():
    payload = request(buyer={}, placeOfSupply=None)
    assert any(item["code"] == "PLACE_OF_SUPPLY_ASSUMED" for item in calculate(payload)["warnings"])


@pytest.mark.parametrize("field,value", [("qty", "-1"), ("rate", "-1"), ("discountPct", "101"), ("gstRateOverride", "-1")])
def test_invalid_line_values_rejected(field, value):
    payload = request()
    setattr(payload.lines[0], field, value)
    with pytest.raises(TaxInputError):
        calculate(payload)


@given(st.integers(0, 1000000), st.integers(0, 100), st.booleans())
@settings(max_examples=200, deadline=None)
def test_sum_conservation_and_equal_state_split(paise, rate_percent, rounded):
    payload = request(lines=[dict(lineNo=1, hsn="84010000", qty="1", rate=f"{Decimal(paise) / 100:.2f}",
                                 uom="EA", gstRateOverride=str(rate_percent))], roundOff=rounded)
    result = calculate(payload)
    assert result["totals"]["cgst"] == result["totals"]["sgst"]
    assert sum(Decimal(line["lineTotal"]) for line in result["lines"]) + Decimal(result["totals"]["roundOff"]) == Decimal(result["totals"]["grand"])


def test_tax_endpoint_token_validation_and_error_envelope(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = request().model_dump(exclude_none=True)
    assert call("POST", "/v2/tax/compute", json=payload).status_code == 401
    response = call("POST", "/v2/tax/compute", json=payload, headers=auth)
    assert response.status_code == 200
    payload["lines"][0].pop("gstRateOverride")
    response = call("POST", "/v2/tax/compute", json=payload, headers=auth)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert response.json()["error"]["requestId"]
