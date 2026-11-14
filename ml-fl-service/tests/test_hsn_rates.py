"""Regression: the committed HSN master resolves real post-GST-2.0 rates.

The original extraction labelled most Schedule II (18%) rows as Schedule I
(5%). These checks pin the repaired asset for the goods Satya's demo
distributor actually buys.
"""
from pathlib import Path

import pytest

from satya_engine.india.hsn_master import HsnMaster
from satya_engine.india.hsn_repair import repair_rules

ASSET = Path(__file__).resolve().parents[1] / "assets" / "hsn_master.json.gz"
ON = "2026-10-01"


@pytest.fixture(scope="module")
def master():
    return HsnMaster.load(ASSET)


def first_code(master, heading):
    return sorted(c for c in master.codes if c.startswith(heading) and len(c) == 8)[0]


@pytest.mark.parametrize("heading", ["8482", "8481", "8501", "8537", "7307", "8484", "8415", "8418", "8450"])
def test_schedule_ii_goods_are_18_percent(master, heading):
    result = master.lookup(first_code(master, heading), ON)
    assert result is not None
    assert result["rate"] == "18", (heading, result)


@pytest.mark.parametrize("code", ["84137010", "84135021", "84138130"])
def test_water_pumps_are_5_percent(master, code):
    assert master.lookup(code, ON)["rate"] == "5"


def test_hydraulic_tractor_pump_subheading_is_extended(master):
    result = master.lookup("84138190", ON)
    assert result["rate"] == "5" and result["matchedPrefix"] == "84138190"


def test_other_pumps_are_not_asserted_as_5_percent(master):
    # concrete / rotary positive displacement pumps sit in Schedule II
    result = master.lookup("84134000", ON)
    assert result["rate"] != "5"


def test_repair_relabels_continuing_runs_only():
    base = dict(effectiveFrom="2025-09-22", notificationRef="Notification 9/2025-CT(Rate)", description="x")
    rules = [
        dict(base, prefix="0101", schedule="Schedule I", sNo="1", rate="5"),
        dict(base, prefix="0102", schedule="Schedule I", sNo="2", rate="5"),
        dict(base, prefix="1702", schedule="Schedule II", sNo="1", rate="18"),
        dict(base, prefix="1703", schedule="Schedule II", sNo="2", rate="18"),
        dict(base, prefix="8482", schedule="Schedule I", sNo="3", rate="5"),   # page-header artefact
        dict(base, prefix="2202", schedule="Schedule III", sNo="1", rate="40"),
    ]
    out, log = repair_rules(rules)
    assert [r["schedule"] for r in out] == ["Schedule I", "Schedule I", "Schedule II", "Schedule II", "Schedule II", "Schedule III"]
    assert out[4]["rate"] == "18"
    assert rules[4]["rate"] == "5"  # input not mutated
    assert any("8482" in line for line in log)
