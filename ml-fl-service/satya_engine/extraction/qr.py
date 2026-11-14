"""IRP e-invoice signed QR: decode, verify, map to document fields.

The QR printed on a GST e-invoice is a JWT (RS256) issued by the Invoice
Registration Portal. Its payload carries ``data`` — usually a JSON *string*
(sometimes an object) with SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt
(dd/mm/yyyy), TotInvVal, ItemCnt, MainHsnCode, Irn and IrnDt.

``verified`` is only ever true after an RS256 check against a public key:
the NIC keys in ``assets/irp_public_keys`` (``keySource: "irp"``) or keys a
caller passes explicitly (``keySource: "supplied"`` — tests / offline eval
only; the HTTP API never accepts keys). Anything else stays ``not_verified``
with a reason, but well-formed fields are still returned.
"""
import base64
import json
import re
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

from ..india.gstin import validate_gstin
from .normalize import money_str, parse_amount, parse_date

IRP_KEYS_DIR = Path(__file__).resolve().parents[2] / "assets" / "irp_public_keys"
IRN_RE = re.compile(r"^[0-9a-f]{64}$", re.I)
DOC_TYP = {"INV": "INVOICE_IN", "CRN": "CREDIT_NOTE_IN", "DBN": "DEBIT_NOTE_IN"}
MAX_TOKEN = 8192


def _b64(segment):
    return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))


def jwt_parts(token):
    parts = (token or "").strip().split(".")
    if len(parts) != 3 or len(token) > MAX_TOKEN:
        return None
    try:
        header = json.loads(_b64(parts[0]))
        payload = json.loads(_b64(parts[1]))
    except Exception:
        return None
    if not isinstance(header, dict) or not isinstance(payload, dict):
        return None
    return header, payload, parts


def _load_keys(directory):
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    from cryptography.x509 import load_pem_x509_certificate

    keys = []
    if not directory.is_dir():
        return keys
    for path in sorted(directory.glob("*.pem")) + sorted(directory.glob("*.crt")):
        raw = path.read_bytes()
        try:
            key = load_pem_x509_certificate(raw).public_key()
        except Exception:
            try:
                key = load_pem_public_key(raw)
            except Exception:
                continue
        valid_from = valid_to = None
        window = re.search(r"(\d{8})_to_(\d{8})", path.stem)
        if window:
            valid_from = datetime.strptime(window.group(1), "%d%m%Y").date()
            valid_to = datetime.strptime(window.group(2), "%d%m%Y").date()
        keys.append((path.stem, key, valid_from, valid_to))
    return keys


@lru_cache(maxsize=1)
def irp_keys():
    """(name, public_key, valid_from, valid_to) for installed NIC IRP keys."""
    return tuple(_load_keys(IRP_KEYS_DIR))


def load_public_key(pem_bytes, name="supplied"):
    from cryptography.hazmat.primitives.serialization import load_pem_public_key

    return (name, load_pem_public_key(pem_bytes), None, None)


def payload_data(payload):
    """The invoice dict inside a JWT payload; ``data`` may be a JSON string."""
    data = payload.get("data", payload)
    if isinstance(data, (bytes, bytearray)):
        data = data.decode("utf-8", "replace")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except Exception:
            return None
    return data if isinstance(data, dict) else None


def _flat_fields(data):
    fields = {}
    for key, value in data.items():
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, (str, int, float)):
            fields[str(key)] = str(value)
    return fields


def map_fields(fields):
    """IRP QR payload fields -> our field names (normalised values)."""
    mapped = {}
    if fields.get("DocNo"):
        mapped["number"] = fields["DocNo"].strip()
    if fields.get("DocDt"):
        iso = parse_date(fields["DocDt"])
        if iso:
            mapped["date"] = iso
    if fields.get("DocTyp"):
        mapped["type"] = DOC_TYP.get(fields["DocTyp"].strip().upper())
    for ours, theirs in (("seller.gstin", "SellerGstin"), ("buyer.gstin", "BuyerGstin")):
        if fields.get(theirs):
            mapped[ours] = fields[theirs].strip().upper()
    if fields.get("TotInvVal") is not None:
        amount = parse_amount(fields["TotInvVal"])
        if amount is not None:
            mapped["totals.grand"] = money_str(amount)
    if fields.get("Irn"):
        mapped["gst.irn"] = fields["Irn"].strip().lower()
    if fields.get("IrnDt"):
        mapped["gst.irnDate"] = fields["IrnDt"].strip()
    if fields.get("ItemCnt"):
        try:
            mapped["lineCount"] = int(float(fields["ItemCnt"]))
        except ValueError:
            pass
    if fields.get("MainHsnCode"):
        mapped["mainHsn"] = fields["MainHsnCode"].strip()
    return {key: value for key, value in mapped.items() if value is not None}


def well_formed_problems(mapped):
    problems = []
    for role in ("seller.gstin", "buyer.gstin"):
        gstin = mapped.get(role)
        if gstin and gstin != "URP":
            check = validate_gstin(gstin)
            if not (check["wellFormed"] and check["checksumValid"]):
                problems.append(f"{role} fails format/checksum")
    for required in ("number", "date", "seller.gstin", "totals.grand"):
        if required not in mapped:
            problems.append(f"missing {required}")
    if mapped.get("gst.irn") and not IRN_RE.match(mapped["gst.irn"]):
        problems.append("IRN is not 64 hex characters")
    return problems


def _invoice_date(fields):
    raw = fields.get("IrnDt") or fields.get("DocDt")
    if not raw:
        return None
    iso = parse_date(raw)
    return date.fromisoformat(iso) if iso else None


def decode_token(token, extra_keys=None):
    """Decode + verify an IRP QR JWT. Never claims verified without a signature check."""
    result = {"found": True, "kind": "unknown", "verified": False, "signature": "not_verified",
              "keySource": None, "keyId": None, "reason": None, "fields": {}, "mapped": {},
              "wellFormed": False, "raw": (token or "")[:MAX_TOKEN]}
    parts = jwt_parts(token or "")
    if not parts:
        result.update({"signature": "malformed", "reason": "QR content is not a three-part JWT"})
        return result
    header, payload, segments = parts
    data = payload_data(payload)
    if data is None:
        result.update({"signature": "malformed", "reason": "JWT payload has no readable 'data' object"})
        return result
    fields = _flat_fields(data)
    mapped = map_fields(fields)
    problems = well_formed_problems(mapped)
    result.update({"kind": "irp_jwt", "fields": fields, "mapped": mapped,
                   "wellFormed": not problems, "keyId": header.get("kid") or header.get("x5t"),
                   "problems": problems})
    if str(header.get("alg", "")).upper() != "RS256":
        result["reason"] = f"unsupported JWT alg {header.get('alg')!r} (IRP uses RS256)"
        return result

    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    message = f"{segments[0]}.{segments[1]}".encode()
    try:
        signature = _b64(segments[2])
    except Exception:
        result["reason"] = "signature segment is not base64url"
        return result
    when = _invoice_date(fields)
    candidates = [(key, "irp") for key in irp_keys()]
    # Prefer keys whose validity window covers the invoice date.
    candidates.sort(key=lambda item: not (when and item[0][2] and item[0][3] and item[0][2] <= when <= item[0][3]))
    candidates += [(key, "supplied") for key in (extra_keys or [])]
    if not candidates:
        result["reason"] = "no trusted IRP public keys installed (assets/irp_public_keys)"
        return result
    for (name, key, _vf, _vt), source in candidates:
        try:
            key.verify(signature, message, padding.PKCS1v15(), hashes.SHA256())
        except Exception:
            continue
        result.update({"verified": True, "signature": "verified", "keySource": source,
                       "keyId": name, "reason": None})
        return result
    result["reason"] = ("signature did not verify against installed NIC IRP keys"
                        + (" or supplied keys" if extra_keys else "")
                        + " — fields shown are unverified")
    return result


def scan_images(images, extra_keys=None):
    """First IRP-looking QR on the given PIL images (or {'found': False})."""
    import zxingcpp

    fallback = None
    for page, image in enumerate(images, start=1):
        try:
            codes = zxingcpp.read_barcodes(image)
        except Exception:
            continue
        for code in codes:
            # zxing-cpp 3.x prints "QR Code", older builds "BarcodeFormat.QRCode".
            if not str(code.format).replace(" ", "").lower().endswith("qrcode"):
                continue
            decoded = decode_token(code.text, extra_keys=extra_keys)
            decoded["page"] = page
            if decoded["kind"] == "irp_jwt":
                return decoded
            fallback = fallback or decoded
    return fallback or {"found": False, "verified": False, "signature": "absent"}
