import base64
import json
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from satya_engine.docs import _verify_qr, parse
from satya_engine.extraction.qr import decode_token, load_public_key, map_fields

EVAL_DIR = Path(__file__).resolve().parents[1] / "data" / "eval" / "extraction"
DATA = {"SellerGstin": "27AAACR5055K1Z7", "BuyerGstin": "29AAACC1206D1ZC", "DocNo": "SIS/26-27/0067",
        "DocTyp": "INV", "DocDt": "07/05/2026", "TotInvVal": 330855.0, "ItemCnt": 3,
        "MainHsnCode": "84137010", "Irn": "a" * 64, "IrnDt": "2026-05-07 12:34:00"}


@pytest.fixture(scope="module")
def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def token(key, data=DATA, as_string=True, alg="RS256"):
    header = _b64(json.dumps({"alg": alg, "kid": "TEST", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"data": json.dumps(data) if as_string else data, "iss": "test"}).encode())
    signature = key.sign(f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{payload}.{_b64(signature)}"


def public(key):
    pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    return load_public_key(pem, "unit-test-key")


@pytest.mark.parametrize("as_string", [True, False])
def test_decode_maps_fields_and_is_not_verified_without_matching_key(key, as_string):
    result = decode_token(token(key, as_string=as_string))
    assert result["kind"] == "irp_jwt"
    assert result["verified"] is False
    assert result["signature"] == "not_verified"
    assert result["reason"]
    assert result["wellFormed"] is True
    mapped = result["mapped"]
    assert mapped["number"] == "SIS/26-27/0067"
    assert mapped["date"] == "2026-05-07"
    assert mapped["seller.gstin"] == "27AAACR5055K1Z7"
    assert mapped["buyer.gstin"] == "29AAACC1206D1ZC"
    assert mapped["totals.grand"] == "330855.00"
    assert mapped["gst.irn"] == "a" * 64
    assert mapped["lineCount"] == 3
    assert mapped["type"] == "INVOICE_IN"
    assert result["fields"]["DocDt"] == "07/05/2026"


def test_supplied_key_verifies_and_tampering_fails(key):
    good = token(key)
    verified = decode_token(good, extra_keys=[public(key)])
    assert verified["verified"] is True and verified["signature"] == "verified"
    assert verified["keySource"] == "supplied"
    header, payload, signature = good.split(".")
    forged = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    forged["data"] = json.dumps({**DATA, "TotInvVal": 999.0})
    tampered = f"{header}.{_b64(json.dumps(forged).encode())}.{signature}"
    result = decode_token(tampered, extra_keys=[public(key)])
    assert result["verified"] is False
    assert result["mapped"]["totals.grand"] == "999.00"


def test_installed_nic_keys_do_not_verify_a_foreign_signature(key):
    result = _verify_qr(token(key))  # docs.py compatibility wrapper
    assert result["found"] is True and result["verified"] is False
    assert "IRP" in result["reason"] or "NIC" in result["reason"]


def test_malformed_and_wrong_alg(key):
    assert decode_token("upi://pay?pa=x@y")["signature"] == "malformed"
    assert decode_token("a.b.c")["verified"] is False
    hs = decode_token(token(key, alg="HS256"), extra_keys=[public(key)])
    assert hs["verified"] is False and "alg" in hs["reason"]


def test_badly_formed_payload_is_flagged():
    mapped = map_fields({"SellerGstin": "27AAACR5055K1Z0", "DocNo": "X1", "DocDt": "31/02/2026"})
    assert "date" not in mapped  # not a calendar date
    from satya_engine.extraction.qr import well_formed_problems
    problems = well_formed_problems(mapped)
    assert any("checksum" in p for p in problems) and any("date" in p for p in problems)


@pytest.mark.skipif(not (EVAL_DIR / "pdf" / "inv_01.pdf").exists(), reason="eval fixtures not mounted")
def test_qr_is_read_from_a_rendered_pdf_and_honestly_unverified():
    truth = {d["id"]: d for d in json.loads((EVAL_DIR / "ground_truth.json").read_text())["documents"]}
    doc = next(d for d in truth.values() if d["hasQr"])
    result = parse((EVAL_DIR / doc["file"]).read_bytes(), "application/pdf")
    qr = result["qr"]
    assert qr["kind"] == "irp_jwt"
    assert qr["signature"] == "not_verified"  # signed with the eval TEST key, not NIC
    assert qr["mapped"]["number"] == doc["number"]
    assert qr["mapped"]["date"] == doc["date"]
    test_key = load_public_key((EVAL_DIR / "test_qr_public_key.pem").read_bytes())
    assert decode_token(qr["raw"], extra_keys=[test_key])["verified"] is True
    assert result["fields"]["gst"]["value"]["signedQr"]["verified"] is False
    assert any(i["code"] == "QR_SIGNATURE_NOT_VERIFIED" for i in result["fieldIssues"])
