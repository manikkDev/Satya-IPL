"""Live linking: normalisation, blocking, calibration/LTT, service + endpoints."""
import json
from pathlib import Path

import numpy as np
import pytest

from satya_engine.linking import calibration as cal
from satya_engine.linking.blocking import candidates
from satya_engine.linking.decide import amount_consistent, per_doc
from satya_engine.linking.docs import to_link_doc
from satya_engine.linking.normalize import core_number, name_similarity, number_similarity, text_mentions
from satya_engine.linking.service import LinkSuggestRequest, suggest
from tests.test_engine_api import call

DEMO = json.loads((Path(__file__).resolve().parents[1] / "data" / "linking" / "demo_holdout.json").read_text())


def test_number_normalisation_indian_styles():
    assert core_number("SIS/26-27/0067") == core_number("sis 67") == core_number("SIS-26-27-OO67")
    assert number_similarity("SATYAD/PO/26-27/000045", "PO 45") >= 0.9
    assert number_similarity("INV-2026-00123", "INV-2026-00124") < 0.95
    assert text_mentions("NEFT/HDFC/SHAKTI INV SIS/26-27/0071", "SIS/26-27/0071") == 1.0


def test_name_normalisation_transliteration_and_variants():
    assert name_similarity("M/s Shree Ganesh Engg. Works Pvt. Ltd.", "Shri Ganesh Engineering Works Private Limited") >= 0.9
    assert name_similarity("शक्ति इंडस्ट्रीज", "Shakti Industries") >= 0.8
    assert name_similarity("Shakti Industries", "Kaveri Polymers") < 0.6


def test_blocking_admits_reference_across_parties():
    po = to_link_doc({"id": "po1", "type": "PO", "number": "PO/26-27/0042", "date": "2026-04-01",
                      "seller": {"name": "Alpha Traders"}, "lines": []})
    inv = to_link_doc({"id": "i1", "type": "INVOICE_IN", "number": "A/1", "date": "2026-04-10",
                       "seller": {"name": "Completely Different"}, "externalRef": "Your PO PO/26-27/0042", "lines": []})
    cands = candidates("BILLS", [inv], [po])
    assert cands["i1"][0][0].id == "po1" and "ref" in cands["i1"][0][1]


def test_explicit_id_refs_are_not_features():
    raw = {"id": "i1", "type": "INVOICE_IN", "number": "X", "date": "2026-04-10", "seller": {"name": "A"},
           "lines": [{"description": "x", "qty": "1", "rate": "1", "refs": {"poId": "po_secret"}}]}
    assert "po_secret" not in to_link_doc(raw).ref_text


def test_calibrators_and_choice():
    rng = np.random.default_rng(0)
    margin = rng.normal(size=3000)
    y = (rng.random(3000) < 1 / (1 + np.exp(-2 * margin))).astype(int)
    groups = rng.integers(0, 30, size=3000)
    fitted, cv = cal.choose_calibrator(margin, y, groups)
    assert fitted["method"] in ("platt", "isotonic") and set(cv) == {"platt", "isotonic"}
    p = cal.apply(fitted, margin)
    assert 0 <= p.min() and p.max() <= 1


def test_ltt_certifies_only_with_enough_clean_decisions():
    scores = np.linspace(0.5, 1.0, 1000)
    wrong = (scores < 0.6).astype(int)  # errors only at the low end
    out = cal.ltt_threshold(scores, wrong, alpha=0.01, delta=0.05)
    assert out["threshold"] is not None and out["threshold"] >= 0.59
    assert cal.ltt_threshold(scores[:100], wrong[:100])["threshold"] is None  # n < 299


def test_decision_rule_margin_and_settlement_consistency():
    th = {"auto": 0.9, "review": 0.1, "margin": 0.1}
    assert per_doc("BILLS", [("a", 0.97, None, None), ("b", 0.2, None, None)], th)[0][2] == "auto"
    ambiguous = per_doc("BILLS", [("a", 0.97, None, None), ("b", 0.93, None, None)], th)
    assert {z for *_, z, _ in ambiguous} == {"review"}
    assert amount_consistent(11800000 - 10000, 11800000, 10000000) == "net of 0.1% TDS"
    two = per_doc("SETTLES", [("i1", 0.95, 50000, 50000), ("i2", 0.94, 70000, 70000), ("i3", 0.01, 9, 9)], th, 120000)
    assert [(t, z) for t, _, z, _ in two] == [("i1", "auto"), ("i2", "auto")]


def _demo_without_links():
    docs = []
    for d in DEMO["documents"]:
        d = json.loads(json.dumps(d))
        for line in d.get("lines") or []:
            line.pop("refs", None)
        if d.get("payment"):
            d["payment"].pop("allocations", None)
        docs.append(d)
    return docs


def test_service_recovers_demo_links_with_reasons():
    truth = {(l["fromId"], l["toId"], l["kind"]) for l in DEMO["links"] if l["kind"] in ("BILLS", "RECEIVES")}
    out = suggest(LinkSuggestRequest(documents=_demo_without_links(), kinds=["BILLS", "RECEIVES"]))
    auto = [s for s in out["suggestions"] if s["zone"] == "auto"]
    assert auto, "trained artifacts should auto-link most of the demo"
    correct = sum((s["fromId"], s["toId"], s["kind"]) in truth for s in auto)
    assert correct / len(auto) >= 0.9
    assert all(s["reasons"] and 0 <= s["score"] <= 1 for s in out["suggestions"])
    assert all(s["modelVersion"].startswith("link_") for s in auto)


def test_service_skips_existing_and_rejected():
    docs = _demo_without_links()
    first = suggest(LinkSuggestRequest(documents=docs, kinds=["BILLS"]))
    s = first["suggestions"][0]
    again = suggest(LinkSuggestRequest(documents=docs, kinds=["BILLS"],
                                       rejected=[{"fromId": s["fromId"], "toId": s["toId"], "kind": "BILLS"}],
                                       existingLinks=[]))
    assert not any((x["fromId"], x["toId"]) == (s["fromId"], s["toId"]) for x in again["suggestions"])
    linked = suggest(LinkSuggestRequest(documents=docs, kinds=["BILLS"],
                                        existingLinks=[{"fromId": s["fromId"], "toId": "x", "kind": "BILLS"}]))
    assert not any(x["fromId"] == s["fromId"] for x in linked["suggestions"])


def test_link_and_card_endpoints(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    body = {"documents": _demo_without_links()[:40], "kinds": ["BILLS"]}
    assert call("POST", "/v2/link/suggest", json=body).status_code == 401
    r = call("POST", "/v2/link/suggest", json=body, headers=auth)
    assert r.status_code == 200 and "suggestions" in r.json()
    card = call("GET", "/v2/models/card", headers=auth).json()
    assert {m["task"] for m in card["models"]} == {"link_invoice_po", "link_grn_po", "link_payment_invoice"}
    m = card["models"][0]
    for key in ("precision", "recall", "f1", "prAuc", "rocAuc", "brier", "ece", "ci"):
        assert key in m["metrics"]
    assert m["reliability"] and m["coverageCurve"] and m["confusion"] and m["bySource"]
    assert card["allocation"] and card["extraction"] and card["anomaly"] and card["references"]
    rep = call("GET", "/v2/evaluation/report?task=invoice_po_line", headers=auth)
    assert rep.status_code == 200 and rep.json()["task"] == "link_invoice_po"


@pytest.mark.parametrize("task", ["link_invoice_po", "link_grn_po", "link_payment_invoice"])
def test_artifacts_are_small_and_consistent(task):
    root = Path(__file__).resolve().parents[1] / "models" / task
    card = json.loads((root / "model_card.json").read_text())
    assert (root / "model.json").stat().st_size < 5_000_000
    assert card["operatingPoint"]["targetPrecision"] == 0.99
    assert all(s["provenance"] for s in card["data"]["sources"])
