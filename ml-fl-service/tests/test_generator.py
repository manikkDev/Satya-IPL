import json

from satya_engine.data.generator import generate, write_jsonl
from satya_engine.recon.case import reconcile_case
from tests.test_recon_case import flagship


def test_generation_is_deterministic():
    a, la, ga = generate(seed=42, n_pos=10, suppliers=4)
    b, lb, gb = generate(seed=42, n_pos=10, suppliers=4)
    assert a == b and la == lb and ga == gb
    c, _, _ = generate(seed=43, n_pos=10, suppliers=4)
    assert a != c


def test_every_record_is_constructed_demo():
    docs, _, _ = generate(seed=42, n_pos=15, suppliers=4)
    assert all(d["provenance"] == "CONSTRUCTED_DEMO" for d in docs)


def test_labels_cover_injected_findings():
    docs, links, labels = generate(seed=7, n_pos=40, suppliers=8)
    assert any(l["type"] == "DUPLICATE_INVOICE_SUSPECT" for l in labels)
    assert any(l["type"] == "INVOICE_QTY_EXCEEDS_RECEIVED" for l in labels)
    assert any(l["type"] == "PAY_UNALLOCATED" for l in labels)


def test_engine_detects_injected_findings():
    docs, links, labels = generate(seed=11, n_pos=30, suppliers=6)
    result = reconcile_case(type(flagship()).model_validate(
        dict(caseId="gen", entityPolicy={"entityId": "ent-1"},
             documents=docs, links=links)))
    codes = {f["code"] for f in result["findings"]}
    assert "DUPLICATE_INVOICE_SUSPECT" in codes or "INVOICE_QTY_EXCEEDS_RECEIVED" in codes


def test_write_jsonl_roundtrip(tmp_path):
    docs, links, labels = generate(seed=5, n_pos=5, suppliers=3)
    write_jsonl(docs, links, labels, str(tmp_path / "demo"))
    lines = (tmp_path / "demo.jsonl").read_text().strip().split("\n")
    assert len(lines) == len(docs)
    assert json.loads(lines[0])["provenance"] == "CONSTRUCTED_DEMO"
    label_lines = (tmp_path / "demo.labels.jsonl").read_text().strip().split("\n")
    assert len(label_lines) == len(labels) + len(links)
