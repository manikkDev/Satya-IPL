import base64

from satya_engine.anomaly import isolation_forest_scores
from satya_engine.contracts_v2 import AnomalyScoreRequest, MatchRecord
from satya_engine.data.generator import generate
from satya_engine.docs import parse


def test_csv_parse_is_deterministic():
    csv_text = "number,amount,vendor\nINV-1,1000,Siddhi\nINV-2,2000,Bharat\n"
    result = parse(csv_text.encode(), "text/csv")
    assert result["method"] == "csv"
    assert result["needsLlm"] is False
    assert any(i["code"] == "CSV_STRUCTURED" for i in result["issues"])


def test_isolation_forest_honest_without_history():
    d = MatchRecord.model_validate({"id": "X-1", "type": "INVOICE_IN",
                                    "amount": {"amount": "100", "currency": "INR"}, "qty": "1"})
    req = AnomalyScoreRequest.model_validate({"documents": [d], "history": [d]})
    result = isolation_forest_scores(req)
    assert "insufficient history" in result["scores"][0]["explanation"]


def test_isolation_forest_scores_with_history():
    hist = [MatchRecord.model_validate({"id": f"H-{i}", "type": "INVOICE_IN",
                                        "amount": {"amount": str(100 + i), "currency": "INR"},
                                        "qty": "1"}) for i in range(60)]
    outlier = MatchRecord.model_validate({"id": "X-1", "type": "INVOICE_IN",
                                          "amount": {"amount": "999999", "currency": "INR"}, "qty": "1"})
    normal = MatchRecord.model_validate({"id": "X-2", "type": "INVOICE_IN",
                                         "amount": {"amount": "130", "currency": "INR"}, "qty": "1"})
    req = AnomalyScoreRequest.model_validate({"documents": [outlier, normal], "history": hist})
    scores = {s["documentId"]: s["score"] for s in isolation_forest_scores(req)["scores"]}
    assert float(scores["X-1"]) > float(scores["X-2"])  # outlier scores higher


def test_new_injectors_emit_labels():
    _, _, labels = generate(seed=9, n_pos=60, suppliers=10)
    types = {l["type"] for l in labels}
    assert "MASTER_NAME_VARIANT" in types or "PAY_BANK_ACCOUNT_CHANGED" in types or "DUP_CROSS_ENTITY" in types
