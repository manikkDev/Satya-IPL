from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_EVEN

import pytest

from satya_engine.india.fy import fy_boundaries, fy_of
from satya_engine.india.gstin import checksum, make_fictional_gstin, validate_gstin
from satya_engine.india.states import state_for
from satya_engine.india.tds import estimate_purchase_tds
from satya_engine.money import amount_in_words_inr, money, round_rupee
from tests.test_engine_api import call


@pytest.mark.parametrize("value,expected", [
    ("70800.00", "Rupees Seventy Thousand Eight Hundred Only"),
    ("118000.50", "Rupees One Lakh Eighteen Thousand and Fifty Paise Only"),
    ("10000000", "Rupees One Crore Only"),
    ("0", "Rupees Zero Only"),
    ("0.01", "Rupees Zero and One Paisa Only"),
    ("-1", "Minus Rupees One Only"),
])
def test_indian_amount_words(value, expected):
    assert amount_in_words_inr(Decimal(value)) == expected


def test_money_rounding_is_explicit_and_exact():
    assert money("2.345") == Decimal("2.35")
    assert money("2.345", rounding=ROUND_HALF_EVEN) == Decimal("2.34")
    assert round_rupee("118000.50") == Decimal("118001")
    assert round_rupee("118000.49") == Decimal("118000")
    with pytest.raises(TypeError):
        money(2.345)
    with pytest.raises(ValueError):
        amount_in_words_inr(Decimal("NaN"))


@pytest.mark.parametrize("day,expected", [
    ("2026-03-31", "2025-26"), ("2026-04-01", "2026-27"),
    ("2027-01-01", "2026-27"), ("2099-04-01", "2099-00"),
])
def test_indian_financial_year(day, expected):
    assert fy_of(date.fromisoformat(day)) == expected


def test_fiscal_boundaries_are_exclusive_and_timestamps_use_ist():
    assert fy_boundaries("2026-27") == (date(2026, 4, 1), date(2027, 4, 1))
    assert fy_of(datetime.fromisoformat("2026-03-31T20:00:00+00:00")) == "2026-27"
    with pytest.raises(ValueError):
        fy_boundaries("2026-28")
    with pytest.raises(ValueError):
        fy_of(datetime(2026, 4, 1))


def test_checksum_known_arithmetic_vector():
    # Arithmetic vector only; not a GST registry/active-status assertion.
    assert checksum("27AAACR5055K1Z") == "7"
    result = validate_gstin("27AAACR5055K1Z7")
    assert result["wellFormed"] and result["checksumValid"]
    assert result["panEmbedded"] == "AAACR5055K"
    assert result["stateCode"] == "27"
    assert result["entityTypeHint"] == "company"
    assert "active" not in result


def test_demo_gstin_is_explicitly_synthetic_and_checksum_only():
    value = make_fictional_gstin("29", "DEMCX1234A")
    assert validate_gstin(value)["checksumValid"] is True
    assert validate_gstin(value[:-1] + ("0" if value[-1] != "0" else "1"))["checksumValid"] is False
    with pytest.raises(ValueError):
        make_fictional_gstin("00", "DEMCX1234A")


@pytest.mark.parametrize("value", ["", "27AAACR5055K1Z", "not a GSTIN", "99AAACR5055K1Z7", "27aaacr5055k1z7"])
def test_invalid_regular_gstin_format_is_not_asserted_well_formed(value):
    result = validate_gstin(value)
    assert result["wellFormed"] is False


def test_official_state_table_ut_flag_and_pseudo_codes():
    assert state_for("27")["name"] == "MAHARASHTRA"
    assert state_for("38")["utWithoutLegislature"] is True
    assert state_for("04")["utWithoutLegislature"] is True
    assert state_for("07")["utWithoutLegislature"] is False
    assert state_for("34")["utWithoutLegislature"] is False
    assert state_for("99")["registrationState"] is False
    assert state_for("00") is None


def tds(**overrides):
    return estimate_purchase_tds(**dict(
        transaction_date="2026-10-29", transaction_base="2000000.00",
        prior_eligible_base="4000000.00", buyer_prior_business_turnover="100000001.00",
        seller_resident=True, other_tds_or_tcs_applies=False, buyer_exempt=False,
        **overrides,
    ))


def test_tds_cumulative_threshold_only_excess_not_entire_payment():
    result = tds()
    assert result["tds393Applicable"] is True
    assert result["estimatedTds"] == "1000.00"
    assert "393" in result["legalReference"]
    assert result["informationalOnly"] is True


def test_tds_legacy_reference_and_strict_buyer_threshold():
    args = dict(transaction_date="2025-10-29", transaction_base="2000000",
                prior_eligible_base="4000000", buyer_prior_business_turnover="100000000",
                seller_resident=True, other_tds_or_tcs_applies=False, buyer_exempt=False)
    result = estimate_purchase_tds(**args)
    assert result["tds393Applicable"] is False
    assert result["estimatedTds"] == "0.00"
    assert "194Q" in result["legalReference"]


def test_tds_unknown_policy_does_not_assume_residency_or_turnover():
    args = dict(transaction_date="2026-10-29", transaction_base="2000000",
                prior_eligible_base="4000000", buyer_prior_business_turnover=None,
                seller_resident=None, other_tds_or_tcs_applies=None, buyer_exempt=None)
    result = estimate_purchase_tds(**args)
    assert result["tds393Applicable"] is None
    assert result["estimatedTds"] is None


def test_gstin_endpoint_is_authenticated_and_flagged(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    payload = {"gstin": "27AAACR5055K1Z7"}
    assert call("POST", "/v2/validate/gstin", json=payload).status_code == 401
    response = call("POST", "/v2/validate/gstin", json=payload, headers=auth)
    assert response.status_code == 200
    assert response.json()["checksumValid"]
