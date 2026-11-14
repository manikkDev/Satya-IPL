import asyncio
import re

import httpx
import pytest
from fastapi import FastAPI

from satya_engine.contracts_v2 import DocsValidateRequest
from satya_engine.extraction.fuse import fuse, normalize_llm
from satya_engine.extraction.router import router
from tests.test_extraction_qr import key, token  # noqa: F401  (fixture + helper)
from tests.test_extraction_text import LAYOUT

MONEY = re.compile(r"^-?\d{1,13}(\.\d{1,6})?$")
CONFIRM_KEYS = {"type", "number", "date", "totals", "seller", "buyer"}


def _parsed(text=LAYOUT, **extra):
    return {"layoutText": text, "text": text, "method": "pdf_text", **extra}


def test_text_only_draft_is_confirmable_shape_and_never_auto_confirmed():
    out = fuse(_parsed())
    fields = out["fields"]
    assert CONFIRM_KEYS <= set(fields)
    assert out["needsReview"] is True
    assert out["method"] == "text_layer"
    for name, entry in fields.items():
        assert {"value", "confidence", "source", "issues", "needsReview"} <= set(entry), name
        assert entry["source"] in {"einvoice_qr", "text_layer", "vision_llm", "einvoice_json"}
        assert entry["needsReview"] == (entry["confidence"] < 0.9 or bool(entry["issues"]))
    totals = fields["totals"]["value"]
    assert all(MONEY.match(totals[k]) for k in ("taxable", "cgst", "sgst", "igst", "cess", "roundOff", "grand"))
    assert totals["cgst"] == "0.00" and totals["igst"] == "59400.00"
    assert fields["seller"]["value"] == {"name": "Shree Industries Pvt Ltd", "gstin": "27AAACR5055K1Z7",
                                         "pan": "AAACR5055K", "stateCode": "27"}
    assert fields["externalRef"]["value"] == "PO-1001"
    assert out["suggestions"]["poNumber"] == "PO-1001"
    for line in out["lines"]:
        assert float(line["qty"]) > 0 and MONEY.match(line["rate"]) and line["amount"] == line["taxableValue"]
    # the partial document validates against the engine's own contract
    DocsValidateRequest.model_validate({"draft": out["extracted"]})


def test_arithmetic_failure_flags_review():
    broken = LAYOUT.replace("3,89,399.60", "3,99,399.60")
    out = fuse(_parsed(broken))
    codes = {i["code"] for i in out["issues"]}
    assert "TAX_ARITHMETIC" in codes
    assert out["fields"]["totals"]["needsReview"] is True
    assert out["fields"]["totals"]["confidence"] <= 0.5


def test_supply_type_mismatch_and_unequal_cgst_sgst():
    from satya_engine.india.gstin import make_fictional_gstin
    intra_with_igst = LAYOUT.replace("29AAACC1206D1ZC", make_fictional_gstin("27", "AAACC1206D"))  # same state, IGST
    out = fuse(_parsed(intra_with_igst))
    assert "TAX_SUPPLY_TYPE_MISMATCH" in {i["code"] for i in out["issues"]}
    unequal = LAYOUT.replace("IGST @ 18%              59,400.00",
                             "CGST @ 9%               29,000.00\n                                     SGST @ 9%               30,400.00")
    out = fuse(_parsed(unequal))
    assert "TAX_CGST_SGST_UNEQUAL" in {i["code"] for i in out["issues"]}


def test_invalid_gstin_checksum_is_capped():
    out = fuse(_parsed(LAYOUT.replace("27AAACR5055K1Z7", "27AAACR5055K1Z0")))
    seller = out["fields"]["seller"]
    assert seller["confidence"] <= 0.3 and seller["needsReview"]
    assert "TAX_GSTIN_INVALID" in {i["code"] for i in out["issues"]}


def test_qr_takes_precedence_and_flags_mismatch(key):  # noqa: F811
    from satya_engine.extraction.qr import decode_token
    data = {"SellerGstin": "27AAACR5055K1Z7", "BuyerGstin": "29AAACC1206D1ZC", "DocNo": "SIS/26-27/0068",
            "DocTyp": "INV", "DocDt": "07/05/2026", "TotInvVal": 389399.6, "ItemCnt": 2, "Irn": "b" * 64}
    qr = decode_token(token(key, data))
    out = fuse(_parsed(qr=qr))
    number = out["fields"]["number"]
    assert number["value"] == "SIS/26-27/0068" and number["source"] == "einvoice_qr"
    assert number["needsReview"] is True
    assert any(c["source"] == "text_layer" and c["value"] == "SIS/26-27/0067" for c in number["candidates"])
    mismatch = [i for i in out["issues"] if i["code"] == "TAX_QR_MISMATCH"]
    assert mismatch and mismatch[0]["field"] == "number" and mismatch[0]["severity"] == "error"
    # agreeing fields gain confidence from two sources
    date = out["fields"]["date"]
    assert date["value"] == "2026-05-07" and set(date["agreement"]) == {"einvoice_qr", "text_layer"}
    assert date["confidence"] > 0.95
    assert out["method"] == "einvoice_qr"
    assert out["fields"]["gst"]["value"]["signedQr"]["verified"] is False


def test_claimed_verified_qr_without_token_is_not_trusted():
    out = fuse(_parsed(), qr_fields={"DocNo": "SIS/26-27/0067", "DocDt": "07/05/2026",
                                     "SellerGstin": "27AAACR5055K1Z7", "TotInvVal": "389399.60"})
    assert out["qr"]["verified"] is False and out["qr"]["signature"] == "not_verified"
    assert out["fields"]["number"]["source"] == "einvoice_qr"
    assert out["fields"]["number"]["confidence"] > 0.95  # QR (0.9) + text agreement


LLM_OUTPUT = {
    "type": "invoice", "number": "INV-041", "date": "07/05/2026",
    "seller": {"name": "Meridian Pumps LLP", "gstin": "27AAACR5055K1Z7"},
    "buyer": {"name": "Acme", "gstin": "29AAACC1206D1ZC"},
    "lines": [{"lineNo": 1, "description": "Pump", "qty": "60", "rate": "1,000.00", "taxableValue": "₹60,000.00",
               "hsn": "8413", "gstRate": "18%"}],
    "totals": {"taxable": "₹60,000.00", "cgst": "5,400.00", "sgst": "5,400.00", "grand": "Rs. 70,800.00"},
    "poReference": "PO-1001", "bankDetails": {"ifsc": "HDFC0000001", "accountMasked": "XXXX1234"},
    "quotes": {"number": {"page": 1, "quote": "Invoice No: INV-041"}}, "fieldConfidence": {"number": 0.99},
}


def test_llm_output_is_normalised():
    norm = normalize_llm(LLM_OUTPUT)
    assert norm["type"] == "INVOICE_IN" and norm["date"] == "2026-05-07"
    assert norm["totals.grand"] == "70800.00" and norm["totals.taxable"] == "60000.00"
    assert norm["lines"][0]["rate"] == "1000" and norm["lines"][0]["taxableValue"] == "60000.00"
    assert norm["lines"][0]["gstRate"] == "18"
    assert "quotes" not in norm and "fieldConfidence" not in norm


def test_llm_only_fields_are_capped_and_reviewed():
    out = fuse({"method": "pdf_render"}, llm={"extracted": LLM_OUTPUT, "quotes": LLM_OUTPUT["quotes"],
                                             "fieldConfidence": {"number": 0.99}})
    assert out["method"] == "vision_llm"
    fields = out["fields"]
    for name in ("number", "date", "totals", "seller"):
        assert fields[name]["source"] == "vision_llm"
        assert fields[name]["confidence"] <= 0.85, name  # never the model's self-reported 0.99
        assert fields[name]["needsReview"] is True
    assert fields["bankDetails"]["needsReview"] is True
    assert fields["externalRef"]["value"] == "PO-1001"
    DocsValidateRequest.model_validate({"draft": out["extracted"]})


def test_llm_only_totals_stay_below_threshold_even_when_they_add_up():
    consistent = {**LLM_OUTPUT, "totals": {"taxable": "60,000.00", "igst": "10,800.00", "grand": "70,800.00"}}
    out = fuse({"method": "image"}, llm={"extracted": consistent})
    totals = out["fields"]["totals"]
    assert not any(i["code"] == "TAX_ARITHMETIC" for i in out["issues"])
    assert totals["confidence"] <= 0.85 and totals["needsReview"] is True
    assert all(part["confidence"] <= 0.85 for part in totals["parts"].values())
    assert all(line["needsReview"] for line in out["lines"])


def test_llm_agreeing_with_text_layer_raises_confidence():
    llm = {"extracted": {"number": "SIS/26-27/0067", "date": "07-05-2026", "totals": {"grand": "3,89,399.60"}},
           "quotes": {"number": {"quote": "Invoice No. : SIS/26-27/0067"}}}
    out = fuse(_parsed(), llm=llm)
    assert set(out["fields"]["number"]["agreement"]) == {"text_layer", "vision_llm"}
    assert out["fields"]["number"]["confidence"] > 0.9
    conflict = fuse(_parsed(), llm={"extracted": {"number": "SIS/26-27/0076"}})
    assert conflict["fields"]["number"]["source"] == "text_layer"
    assert "EXTRACTION_CONFLICT" in {i["code"] for i in conflict["issues"]}
    assert conflict["fields"]["number"]["needsReview"] is True


def test_einvoice_json_source():
    from satya_engine.docs import parse
    from tests.test_docs import einvoice_json
    result = parse(einvoice_json(), "application/json")
    assert result["extractionMethod"] == "json"
    assert result["llmRecommended"] is False and result["needsLlm"] is False
    assert result["fields"]["number"]["source"] == "einvoice_json"
    assert result["fields"]["seller"]["value"]["gstin"] == "27AAACR5055K1Z7"


def _call(app, method, path, **kwargs):
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://engine") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(request())


def test_router_gates_and_contract(monkeypatch, auth):
    app = FastAPI()
    app.include_router(router)
    body = {"parsed": {"layoutText": LAYOUT, "method": "pdf_text", "qr": {"found": False, "verified": False}},
            "llm": {"extracted": LLM_OUTPUT, "quotes": {}, "fieldConfidence": {}, "model": "m", "usage": {}}}
    monkeypatch.delenv("FEATURE_V2_RECON_V2", raising=False)
    assert _call(app, "POST", "/v2/docs/fuse", json=body, headers=auth).status_code == 404
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    assert _call(app, "POST", "/v2/docs/fuse", json=body).status_code == 401
    response = _call(app, "POST", "/v2/docs/fuse", json=body, headers=auth)
    assert response.status_code == 200
    data = response.json()
    assert data["fields"]["number"]["source"] == "text_layer"
    assert data["needsReview"] is True
    bad = {**body, "unexpected": True}
    assert _call(app, "POST", "/v2/docs/fuse", json=bad, headers=auth).status_code == 422
    decoded = _call(app, "POST", "/v2/docs/qr/decode", json={"token": "x.y.z"}, headers=auth)
    assert decoded.status_code == 200 and decoded.json()["verified"] is False
