from copy import deepcopy

import pytest
from pydantic import TypeAdapter, ValidationError

from satya_engine.api import create_app
from satya_engine.business_demo import demo_bundle
from satya_engine.contracts_v2 import BusinessDocument, DecimalString, GraphPayload, Money, TaxComputeRequest
from tests.test_engine_api import call


@pytest.mark.parametrize("value", [
    1, 1.5, True, None, "NaN", "Infinity", "1e3", "+1", "1,000", "1.1234567",
    "1000000000000000", " 1", "1\n",
])
def test_decimal_rejects_non_contract_values(value):
    with pytest.raises(ValidationError):
        TypeAdapter(DecimalString).validate_python(value)


@pytest.mark.parametrize("value", ["0", "-1", "70800.00", "999999999999999.123456"])
def test_decimal_strings_are_preserved(value):
    assert Money(amount=value, currency="INR").model_dump()["amount"] == value


def flagship_documents():
    # Explicit fixture adapter, not production inference or an auto-approved link.
    bundle = demo_bundle()
    families = {"INVOICE": "INVOICE_IN", "PAYMENT": "PAYMENT_OUT"}
    for record in bundle["cases"][0]["records"]:
        stamp = record["observedAt"]
        document = dict(
            id=record["id"], groupId="grp_fixture", entityId="ent_fixture",
            type=families.get(record["type"], record["type"]), number=record["reference"],
            externalRef=record["id"], date=record["occurredAt"][:10], fy="2026-27",
            status="posted" if record.get("status") == "settled" else record.get("status", "posted"),
            revision=1, seller={"name": record["supplier"]}, buyer={"name": "Fixture buyer"},
            currency=record["currency"], lines=[
                dict(lineNo=int(line["id"]), description=line["description"],
                     qty=line["quantity"], rate=line["unitPrice"], uom=line["uom"])
                for line in record.get("lines", [])
            ], source={"channel": "json", "sourceSystem": record["source"]},
            provenance="CONSTRUCTED_DEMO", observedAt=stamp, createdAt=stamp,
            createdBy="usr_fixture", updatedAt=stamp,
        )
        if record["type"] == "PAYMENT":
            document["payment"] = dict(amount=record["amount"], utr=record.get("utr"))
        yield document


def test_flagship_domain_round_trip():
    for document in flagship_documents():
        assert BusinessDocument.model_validate(document).model_dump(exclude_unset=True) == document


@pytest.mark.parametrize("stamp", ["2026-10-01", "2026-10-01T10:00:00", "2026-13-01T10:00:00Z", 1790000000])
def test_offset_required_on_observations(stamp):
    document = next(flagship_documents())
    document["observedAt"] = stamp
    with pytest.raises(ValidationError):
        BusinessDocument.model_validate(document)


@pytest.mark.parametrize("field,value", [
    ("date", "2026-02-30"), ("date", "2026-10-01T00:00:00Z"),
    ("provenance", "PUBLIC_REAL"), ("type", "MYSTERY"), ("unknown", "value"),
])
def test_domain_validation(field, value):
    document = next(flagship_documents())
    document[field] = value
    with pytest.raises(ValidationError):
        BusinessDocument.model_validate(document)


def test_nested_unknown_fields_and_numeric_money_rejected():
    document = next(flagship_documents())
    bad = deepcopy(document)
    bad["seller"]["unscoped"] = "unexpected"
    with pytest.raises(ValidationError):
        BusinessDocument.model_validate(bad)
    bad = deepcopy(document)
    bad["lines"][0]["rate"] = 1000.0
    with pytest.raises(ValidationError):
        BusinessDocument.model_validate(bad)


def test_tax_request_preserves_exact_values():
    request = dict(seller={"stateCode": "27"}, buyer={"stateCode": "29"},
                   placeOfSupply="29", docDate="2026-10-01", supplyType="B2B",
                   reverseCharge=False, currency="INR",
                   lines=[dict(lineNo=1, hsn="fixture", qty="1", rate="70800.00", uom="EA")],
                   charges=[], roundOff=True)
    assert TaxComputeRequest.model_validate(request).model_dump(exclude_unset=True) == request
    request["lines"][0]["qty"] = 1.0
    with pytest.raises(ValidationError):
        TaxComputeRequest.model_validate(request)


def test_graph_contract_accepts_evidence_edges_and_timeline():
    graph = dict(nodes=[dict(id="PO-1001", type="PO", label="Order", stage="order",
                            amount={"amount": "118000.00", "currency": "INR"})],
                 edges=[], timeline=[dict(at="2026-10-01T10:00:00+05:30",
                                         nodeIds=["PO-1001"], edgeIds=[])], source="snapshot")
    assert GraphPayload.model_validate(graph).model_dump(exclude_unset=True) == graph


def test_schema_feature_flag_and_auth(monkeypatch, auth):
    monkeypatch.delenv("FEATURE_V2_RECON_V2", raising=False)
    assert call("GET", "/v2/schema", headers=auth).status_code == 404
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    assert call("GET", "/v2/schema").status_code == 401
    response = call("GET", "/v2/schema", headers=auth)
    assert response.status_code == 200
    schemas = response.json()["schemas"]
    assert schemas["BusinessDocument"]["additionalProperties"] is False
    assert schemas["Money"]["properties"]["amount"]["type"] == "string"
    assert schemas["TaxComputeRequest"]["$defs"]["TaxLine"]["additionalProperties"] is False


def test_only_one_root_handler():
    assert sum(route.path == "/" for route in create_app().routes) == 1
