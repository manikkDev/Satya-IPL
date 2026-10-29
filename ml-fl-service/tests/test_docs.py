import base64
import json

import pytest

from satya_engine.contracts_v2 import DocsParseRequest, DocsValidateRequest
from satya_engine.docs import DocParseError, parse, validate
from satya_engine.india.hsn_master import HsnMaster
from tests.test_engine_api import call


def einvoice_json():
    return json.dumps({
        "Irn": "a" * 64,
        "DocDtls": {"Typ": "INV", "No": "INV/001", "Dt": "01/10/2026"},
        "TranDtls": {"TaxSch": "GST", "SupTyp": "B2B"},
        "SellerDtls": {"Gstin": "27AAACR5055K1Z7", "LglNm": "NIC Fixture",
                       "TrdNm": "NIC", "Stcd": "27"},
        "BuyerDtls": {"Gstin": "29AAACC1206D1ZU", "LglNm": "Buyer Fixture",
                      "TrdNm": "XYZ", "Pos": "29"},
    }).encode()


def test_einvoice_json_maps_to_business_document():
    result = parse(einvoice_json(), "application/json")
    assert result["method"] == "einvoice_json"
    assert result["detectedType"] == "INVOICE_IN"
    assert result["extracted"]["number"] == "INV/001"
    assert result["extracted"]["seller"]["gstin"] == "27AAACR5055K1Z7"
    assert result["extracted"]["gst"]["irn"] == "a" * 64
    assert result["needsLlm"] is False


def test_unrecognised_json_reports_issue_not_llm():
    result = parse(json.dumps({"random": True}).encode(), "application/json")
    assert result["detectedType"] is None
    assert any(i["code"] == "UNRECOGNISED_JSON" for i in result["issues"])
    assert result["needsLlm"] is False


def minimal_pdf(text=""):
    """Smallest valid one-page PDF, optionally with a Helvetica text line."""
    stream = f"BT /F1 12 Tf 20 700 Td ({text}) Tj ET".encode() if text else b""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 800] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    pdf, offsets = b"%PDF-1.4\n", [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    pdf += b"".join(f"{off:010d} 00000 n \n".encode() for off in offsets[1:])
    pdf += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF").encode()
    return pdf


def test_pdf_text_layer_parses():
    result = parse(minimal_pdf("TAX INVOICE No INV-042 GSTIN 27AAACR5055K1Z7"), "application/pdf")
    assert result["method"] == "pdf_text"
    assert result["pages"] >= 1
    assert result["textLayer"]["present"] is True
    assert result["detectedType"] == "INVOICE_IN"
    assert result["extracted"]["seller"]["gstin"] == "27AAACR5055K1Z7"
    assert result["needsLlm"] is False


def test_empty_pdf_requests_llm_with_images():
    result = parse(minimal_pdf(), "application/pdf")
    assert result["textLayer"]["present"] is False
    assert result["needsLlm"] is True
    assert len(result["pageImages"]) <= 3
    assert any(i["code"] == "TEXT_LAYER_MISSING" for i in result["issues"])


def test_oversize_file_rejected():
    with pytest.raises(DocParseError):
        parse(b"x" * (10 * 1024 * 1024 + 1), "application/pdf")


def _draft(**fields):
    base = {"seller": {"name": "S", "gstin": "27AAACR5055K1Z7", "stateCode": "27"}}
    base.update(fields)
    return DocsValidateRequest.model_validate({"draft": base})


def test_validate_clean_draft():
    result = validate(_draft(), HsnMaster())
    assert result["fields"]["seller.gstin"]["confidence"] == 1.0
    assert result["issues"] == []


def test_validate_bad_gstin_and_totals():
    result = validate(_draft(
        seller={"name": "S", "gstin": "27AAACR5055K1Z0", "stateCode": "27"},
        totals={"taxable": "100", "cgst": "9", "sgst": "9", "igst": "0",
                "cess": "0", "roundOff": "0", "grand": "200"}), HsnMaster())
    codes = {i["code"] for i in result["issues"]}
    assert "TAX_GSTIN_INVALID" in codes
    assert "TAX_ARITHMETIC" in codes
    assert result["fields"]["seller.gstin"]["confidence"] < 1
    assert result["fields"]["totals.grand"]["confidence"] < 1


def test_validate_qr_mismatch():
    request = DocsValidateRequest.model_validate({
        "draft": {"number": "INV-041",
                  "totals": {"taxable": "60000", "cgst": "5400", "sgst": "5400",
                             "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"}},
        "qrFields": {"DocNo": "INV-041", "TotInvVal": "99999"}})
    result = validate(request, HsnMaster())
    assert any(i["code"] == "TAX_QR_MISMATCH" for i in result["issues"])


def test_docs_endpoints_auth_and_flag(monkeypatch, auth):
    monkeypatch.setenv("FEATURE_V2_RECON_V2", "1")
    parse_payload = {"fileBase64": base64.b64encode(einvoice_json()).decode(),
                     "mime": "application/json"}
    assert call("POST", "/v2/docs/parse", json=parse_payload).status_code == 401
    assert call("POST", "/v2/docs/parse", json=parse_payload, headers=auth).status_code == 200
    validate_payload = _draft().model_dump()
    assert call("POST", "/v2/docs/validate", json=validate_payload).status_code == 401
    response = call("POST", "/v2/docs/validate", json=validate_payload, headers=auth)
    assert response.status_code == 200
    assert response.json()["fields"]["seller.gstin"]["confidence"] == 1.0
