from satya_engine.match.assign import assign
from satya_engine.match.vendor_dedupe import dedupe, pair_score


def test_assign_unique_pairs_only():
    anchors = [{"id": "A1"}, {"id": "A2"}]
    pool = [{"id": "P1"}, {"id": "P2"}]
    probs = {("A1", "P1"): 0.95, ("A1", "P2"): 0.6,
             ("A2", "P1"): 0.7, ("A2", "P2"): 0.9}
    result = assign(probs, anchors, pool)
    assert len(result["assignments"]) == 2
    assert {a["anchorId"] for a in result["assignments"]} == {"A1", "A2"}
    assert all(a["candidateId"] in {"P1", "P2"} for a in result["assignments"])


def test_assign_leaves_ambiguous_unassigned():
    anchors = [{"id": "A1"}, {"id": "A2"}]
    pool = [{"id": "P1"}]
    probs = {("A1", "P1"): 0.8, ("A2", "P1"): 0.85}
    result = assign(probs, anchors, pool)
    assert len(result["assignments"]) == 1  # only one can take P1
    assert len(result["unassigned_anchors"]) == 1


def test_assign_below_threshold_unassigned():
    result = assign({("A1", "P1"): 0.5}, [{"id": "A1"}], [{"id": "P1"}])
    assert result["assignments"] == []
    assert result["unassigned_anchors"] == ["A1"]


def test_dedupe_same_pan_clusters():
    suppliers = [
        {"id": "S-1", "name": "Siddhi Equipments Pvt Ltd", "pan": "AAACS1234A",
         "gstin": "27AAACS1234A1Z5"},
        {"id": "S-2", "name": "Siddhi Equipments Private Limited", "pan": "AAACS1234A",
         "gstin": "27AAACS1234A1Z5"},
        {"id": "S-3", "name": "Bharat Industries Corp", "pan": "AAACB9999A",
         "gstin": "29AAACB9999A1Z3"},
    ]
    result = dedupe(suppliers)
    assert len(result["clusters"]) == 1
    assert set(result["clusters"][0]["supplierIds"]) == {"S-1", "S-2"}
    assert "never auto-merged" in result["note"]


def test_dedupe_name_only_possible_not_clustered():
    suppliers = [
        {"id": "S-1", "name": "Siddhi Equipments"},
        {"id": "S-2", "name": "Siddhi Equipment Co"},
    ]
    verdict = pair_score(suppliers[0], suppliers[1])
    assert verdict["certainty"] in {"POSSIBLE", "INSUFFICIENT_EVIDENCE"}  # name alone never PROBABLE
    result = dedupe(suppliers)
    assert result["clusters"] == []


def test_dedupe_gstin_with_name_probable():
    a = {"id": "S-1", "name": "Siddhi Equipments Pvt Ltd", "gstin": "27AAACS1234A1Z5"}
    b = {"id": "S-2", "name": "Siddhi Equipments", "gstin": "27AAACS1234A1Z5"}
    verdict = pair_score(a, b)
    assert verdict["certainty"] == "PROBABLE"
    assert "same GSTIN" in verdict["reasons"]
