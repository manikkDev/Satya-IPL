import re

import numpy as np
import pandas as pd
import pytest

import graph.ingest as ingest_module
from data.features import _pseudonym, engineer_paysim


def test_pseudonym_is_keyed_hash_not_raw_id():
    pid = _pseudonym("C1234567890")
    assert re.fullmatch(r"[0-9a-f]{32}", pid)
    assert "C1234567890" not in pid
    assert pid == _pseudonym("C1234567890")  # deterministic joins
    assert pid != _pseudonym("C1234567891")


def test_engineered_frame_drops_raw_names():
    raw = pd.DataFrame(
        {
            "step": [1, 2, 3, 4],
            "type": ["TRANSFER", "PAYMENT", "CASH_OUT", "PAYMENT"],
            "amount": [100.0, 50.0, 25.0, 10.0],
            "nameOrig": ["C100", "C200", "C300", "C400"],
            "oldbalanceOrg": [500.0, 300.0, 100.0, 50.0],
            "newbalanceOrig": [400.0, 250.0, 75.0, 40.0],
            "nameDest": ["M1", "M2", "M3", "M4"],
            "oldbalanceDest": [0.0, 10.0, 5.0, 2.0],
            "newbalanceDest": [100.0, 60.0, 30.0, 12.0],
            "isFraud": [1, 0, 1, 0],
            "isFlaggedFraud": [0, 0, 0, 0],
            "BankID": [0, 1, 0, 2],
        }
    )
    out = engineer_paysim(raw, "train")
    assert "nameOrig" not in out.columns
    assert "nameDest" not in out.columns
    for value in out["customer_id"]:
        assert re.fullmatch(r"[0-9a-f]{32}", str(value))


class _RecordingSession:
    def __init__(self):
        self.rows = []
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, query, **kwargs):
        self.queries.append(query)
        if "rows" in kwargs:
            self.rows.extend(kwargs["rows"])


class _RecordingDriver:
    session_instance = _RecordingSession()

    @classmethod
    def session(cls):
        return cls.session_instance

    @staticmethod
    def close():
        pass


def test_ingest_writes_only_pseudonymous_rows(monkeypatch):
    # The frame deliberately still carries raw PaySim columns; ingest must drop
    # them and persist only derived fields keyed by the pseudonymous ids.
    raw_ids = {"C999000111", "M777555333"}
    frame = pd.DataFrame(
        {
            "customer_id": ["ab12" * 8, "cd34" * 8],
            "counterparty_id": ["ef56" * 8, "7890" * 8],
            "institution_id": [0, 1],
            "amount": [100.0, 20.0],
            "nameOrig": ["C999000111", "C000222333"],
            "nameDest": ["M777555333", "M111444555"],
        }
    )
    monkeypatch.setattr(ingest_module.pd, "read_parquet", lambda *a, **k: frame)
    monkeypatch.setattr(
        ingest_module,
        "score_frame",
        lambda frame, run_id=None: {"risk_scores": np.array([0.99, 0.1]), "risk_band": ["high", "low"], "run_id": "t"},
    )
    session = _RecordingDriver.session_instance
    session.rows.clear()
    session.queries.clear()
    monkeypatch.setattr(ingest_module.GraphDatabase, "driver", lambda *a, **k: _RecordingDriver())

    result = ingest_module.ingest(run_id="t", max_rows=10)
    assert result["raw_identifiers_written"] is False
    assert result["selection"] == "uniform_without_target_labels"

    # Flatten every row payload sent to Neo4j and confirm no raw identifier appears.
    serialized = repr(session.rows)
    for raw in raw_ids:
        assert raw not in serialized
    # And the property payloads only carry derived fields.
    allowed = {"pid", "institution_id", "score", "band", "source", "target", "n_tx",
               "total_amt", "max_amt", "avg_risk", "frac_flagged", "cluster",
               "id", "label", "size", "avg_score", "n_high", "pagerank"}
    for row in session.rows:
        assert set(row.keys()) <= allowed
