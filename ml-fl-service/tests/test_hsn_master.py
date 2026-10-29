import csv
import gzip
import hashlib
import json
from datetime import date

import pytest

from satya_engine.india.hsn_master import HsnMaster
from satya_engine.data.hsn_build import build_hsn as build


def build_hsn(*args, **kwargs):
    return build(*args, retrieved_at="2000-01-01T00:00:00Z", **kwargs)


def write_csv(path, rows):
    with path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def synthetic_master():
    # Deliberately artificial: not a GST notification or an actual rate change.
    return {
        "version": "synthetic-test-only", "builtAt": "2000-01-01T00:00:00Z",
        "sources": [],
        "codes": [{"code": "84010000", "description": "Fictional fixture item", "chapter": "84"}],
        "rateRules": [
            dict(prefix="84", description="Test broad rule", rate="7.25", schedule="TEST",
                 sNo="1", effectiveFrom="2000-01-01", effectiveTo="2000-02-01", notificationRef="TEST-NOT-LAW"),
            dict(prefix="8401", description="Test narrow rule", rate="8.25", schedule="TEST",
                 sNo="2", effectiveFrom="2000-01-01", effectiveTo="2000-02-01", notificationRef="TEST-NOT-LAW"),
            dict(prefix="8401", description="Test replacement", rate="9.25", schedule="TEST",
                 sNo="3", effectiveFrom="2000-02-01", notificationRef="TEST-NOT-LAW"),
        ],
    }


def test_prefix_and_effective_date_resolution():
    master = HsnMaster(synthetic_master())
    assert master.lookup("84010000", date(2000, 1, 31))["rate"] == "8.25"
    assert master.lookup("84010000", "2000-02-01")["rate"] == "9.25"
    assert master.lookup("84010000", "1999-12-31") is None
    assert master.lookup("99999999", "2000-02-01") is None


def test_unknown_code_not_inferred_from_chapter_rule():
    assert HsnMaster(synthetic_master()).lookup("84019999", "2000-02-01") is None


def test_conditional_or_conflicting_rules_cannot_assert_one_rate():
    payload = synthetic_master()
    payload["rateRules"][-1]["conditional"] = True
    result = HsnMaster(payload).lookup("84010000", "2000-02-01")
    assert result["rate"] is None
    assert result["conditional"] is True
    assert "confirm" in result["warning"].lower()
    payload["rateRules"][-1].pop("conditional")
    payload["rateRules"].append({**payload["rateRules"][-1], "rate": "11.25"})
    assert HsnMaster(payload).lookup("84010000", "2000-02-01")["rate"] is None


def test_missing_master_is_unavailable_not_a_fabricated_rate(tmp_path):
    master = HsnMaster.load(tmp_path / "missing.json.gz")
    assert master.version is None
    assert master.lookup("84010000", "2026-10-29") is None
    assert master.search("pump") == []


def test_search_by_prefix_or_description():
    master = HsnMaster(synthetic_master())
    assert master.search("8401")[0]["code"] == "84010000"
    assert master.search("fictional")[0]["code"] == "84010000"


def test_csv_builder_preserves_codes_and_hashes_sources(tmp_path):
    directory = tmp_path / "directory.csv"
    write_csv(directory, [{"HSN Code": "01010000", "Description": "Synthetic item, not official"}])
    output = tmp_path / "hsn.json.gz"
    result = build_hsn(directory, output, code_column="HSN Code", description_column="Description",
                       directory_url="https://services.gst.gov.in/services/searchhsnsac")
    assert result["codes"][0]["code"] == "01010000"
    assert result["codes"][0]["chapter"] == "01"
    assert result["rateRules"] == []
    assert result["sources"][0]["sha256"] == hashlib.sha256(directory.read_bytes()).hexdigest()
    with gzip.open(output, "rt") as stream:
        assert json.load(stream) == result
    assert HsnMaster(result).lookup("01010000", "2026-10-29") is None


@pytest.mark.parametrize("row", [
    {"code": "8401.0", "description": "lost Excel formatting"},
    {"code": "BAD", "description": "invalid"},
    {"code": "8401", "description": ""},
])
def test_builder_rejects_bad_directory_rows(tmp_path, row):
    source = tmp_path / "hsn.csv"
    write_csv(source, [row])
    with pytest.raises(ValueError):
        build_hsn(source, tmp_path / "out.gz", code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac")
    assert not (tmp_path / "out.gz").exists()


def test_builder_requires_exactly_mapped_columns(tmp_path):
    source = tmp_path / "hsn.csv"
    write_csv(source, [{"not_code": "8401", "text": "Fixture"}])
    with pytest.raises(ValueError, match="column"):
        build_hsn(source, tmp_path / "out.gz", code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac")


def test_builder_requires_provenance_for_rate_rules(tmp_path):
    source = tmp_path / "hsn.csv"
    write_csv(source, [{"code": "84010000", "description": "Synthetic test"}])
    rules = tmp_path / "rates.json"
    rules.write_text(json.dumps({"rateRules": synthetic_master()["rateRules"]}))
    with pytest.raises(ValueError, match="source"):
        build_hsn(source, tmp_path / "out.gz", code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac", rates_path=rules)


def test_xlsx_builder_uses_read_only_and_rejects_numeric_codes(tmp_path):
    from openpyxl import Workbook

    source = tmp_path / "hsn.xlsx"
    workbook = Workbook()
    workbook.active.append(["code", "description"])
    workbook.active.append(["01010000", "Synthetic string code"])
    workbook.save(source)
    result = build_hsn(source, tmp_path / "out.gz", code_column="code", description_column="description",
                       directory_url="https://services.gst.gov.in/services/searchhsnsac")
    assert result["codes"][0]["code"] == "01010000"
    workbook.active.cell(2, 1, 1010000)
    workbook.save(source)
    with pytest.raises(ValueError, match="text"):
        build_hsn(source, tmp_path / "out2.gz", code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac")


def test_reviewed_rate_hash_and_locator_are_enforced(tmp_path):
    directory = tmp_path / "hsn.csv"
    write_csv(directory, [{"code": "84010000", "description": "Synthetic test"}])
    primary = tmp_path / "primary.txt"
    primary.write_text("SYNTHETIC TEST ONLY - not a government notification")
    sha = hashlib.sha256(primary.read_bytes()).hexdigest()
    rate = {**synthetic_master()["rateRules"][2], "sourceSha256": sha, "sourceLocator": "fixture page 1"}
    extraction = dict(
        extractionReviewed=True, taxBasis="total_gst",
        sources=[dict(name="Synthetic test", url="https://taxinformation.cbic.gov.in/",
                      localPath=primary.name, retrievedAt="2000-01-01T00:00:00Z", sha256=sha)],
        rateRules=[rate],
    )
    rates_path = tmp_path / "rates.json"
    rates_path.write_text(json.dumps(extraction))
    result = build_hsn(directory, tmp_path / "good.gz", code_column="code", description_column="description",
                       directory_url="https://services.gst.gov.in/services/searchhsnsac", rates_path=rates_path)
    assert HsnMaster(result).lookup("84010000", "2000-02-01")["rate"] == "9.25"
    primary.write_text("Changed after extraction")
    with pytest.raises(ValueError, match="checksum"):
        build_hsn(directory, tmp_path / "bad.gz", code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac", rates_path=rates_path)


def test_builder_never_overwrites_existing_artifact(tmp_path):
    target = tmp_path / "version.gz"
    target.write_bytes(b"existing")
    with pytest.raises(ValueError, match="overwrite"):
        build_hsn(tmp_path / "missing.csv", target, code_column="code", description_column="description",
                  directory_url="https://services.gst.gov.in/services/searchhsnsac")
    assert target.read_bytes() == b"existing"


def test_cli_builds_from_explicit_local_csv(tmp_path, capsys):
    from satya_engine.cli import main

    source = tmp_path / "hsn.csv"
    write_csv(source, [{"code": "84010000", "description": "Synthetic test"}])
    main(["build-hsn", "--hsn-csv", str(source), "--output", str(tmp_path / "out.gz"),
          "--code-column", "code", "--description-column", "description",
          "--retrieved-at", "2000-01-01T00:00:00Z"])
    result = json.loads(capsys.readouterr().out)
    assert result["rateRules"] == 0
    assert "null" in result["warning"]
