"""Deterministic document parsing and validation.

No LLM calls inside the engine: parse returns the text layer and up to three
page images so the caller can decide whether to ask a model. QR verification is
cryptographic and only reports verified=true with a trusted IRP key on disk.
"""
import base64
import io
import json
import re
from pathlib import Path

from .contracts_v2 import DocsValidateRequest
from .india.gstin import validate_gstin
from .india.hsn_master import HsnMaster

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
MAX_RENDER_PAGES = 3
MAX_RENDER_SIDE = 1600
IRP_KEYS_DIR = Path(__file__).resolve().parent.parent / "assets" / "irp_public_keys"
GSTIN_RE = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b")
IRN_RE = re.compile(r"\b([0-9a-f]{64})\b", re.I)
DOC_TYPE_HINTS = {
    "INVOICE_IN": ("tax invoice", "invoice no", "gstin", "irn"),
    "PO": ("purchase order", "po number", "order no"),
    "GRN": ("goods receipt", "grn", "received quantity"),
    "CREDIT_NOTE_IN": ("credit note",),
    "PI_IN": ("proforma",),
}


class DocParseError(ValueError):
    pass


def _jwt_parts(token):
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        header = json.loads(base64.urlsafe_b64decode(parts[0] + "=" * (-len(parts[0]) % 4)))
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except Exception:
        return None
    return header, payload, parts


def _irp_keys():
    """Load IRP public keys — X.509 certs or raw PEM public keys.

    Filenames may carry validity windows (einvpublickeyNIC1_DDMMYYYY_to_DDMMYYYY);
    they are parsed so verification can prefer keys valid on the invoice date.
    """
    keys = []
    if not IRP_KEYS_DIR.is_dir():
        return keys
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    from cryptography.x509 import load_pem_x509_certificate

    for path in sorted(IRP_KEYS_DIR.glob("*.pem")) + sorted(IRP_KEYS_DIR.glob("*.crt")):
        raw = path.read_bytes()
        key, valid_from, valid_to = None, None, None
        try:
            key = load_pem_x509_certificate(raw).public_key()
            valid_from, valid_to = None, None
        except Exception:
            try:
                key = load_pem_public_key(raw)
            except Exception:
                continue
        window = re.search(r"(\d{8})_to_(\d{8})", path.stem)
        if window:
            from datetime import datetime as _dt
            valid_from = _dt.strptime(window.group(1), "%d%m%Y").date()
            valid_to = _dt.strptime(window.group(2), "%d%m%Y").date()
        keys.append((path.stem, key, valid_from, valid_to))
    return keys


def _verify_qr(token):
    """Return qr dict — verified only on a real signature check."""
    parts = _jwt_parts(token)
    if not parts:
        return {"found": True, "verified": False, "reason": "QR content is not a three-part JWT"}
    header, payload, segments = parts
    data = payload.get("data", payload)
    fields = {k: str(v) for k, v in data.items() if isinstance(v, (str, int, float))}
    result = {"found": True, "verified": False, "fields": fields,
              "keyId": header.get("kid") or header.get("x5t")}
    keys = _irp_keys()
    if not keys:
        result["reason"] = "no trusted IRP public keys installed (assets/irp_public_keys)"
        return result
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives import hashes

    message = f"{segments[0]}.{segments[1]}".encode()
    signature = base64.urlsafe_b64decode(segments[2] + "=" * (-len(segments[2]) % 4))
    # Prefer keys whose validity window covers the invoice date, then fall back
    # to trying every installed key.
    irn_dt = fields.get("IrnDt") or fields.get("DocDt")
    ordered = list(keys)
    if irn_dt:
        from datetime import date as _date, datetime as _dt
        try:
            when = _dt.strptime(str(irn_dt)[:10], "%d/%m/%Y").date() if "/" in str(irn_dt) \
                else _date.fromisoformat(str(irn_dt)[:10])
            ordered.sort(key=lambda k: not (k[2] and k[3] and k[2] <= when <= k[3]))
        except ValueError:
            pass
    for name, key, _vf, _vt in ordered:
        try:
            key.verify(signature, message, padding.PKCS1v15(), hashes.SHA256())
            result.update({"verified": True, "keyId": name, "reason": None})
            return result
        except Exception:
            continue
    result["reason"] = "signature did not verify against installed IRP keys"
    return result


def _scan_images(images):
    import zxingcpp

    qr = {"found": False, "verified": False}
    for image in images:
        try:
            for code in zxingcpp.read_barcodes(image):
                if str(code.format).endswith("QRCode"):
                    return _verify_qr(code.text)
        except Exception:
            continue
    return qr


def _render_pdf(doc, pages):
    images, pngs = [], []
    for index in range(min(pages, MAX_RENDER_PAGES)):
        bitmap = doc[index].render(scale=min(3.0, MAX_RENDER_SIDE / 595))
        pil = bitmap.to_pil()
        if max(pil.size) > MAX_RENDER_SIDE:
            pil.thumbnail((MAX_RENDER_SIDE, MAX_RENDER_SIDE))
        images.append(pil)
        buffer = io.BytesIO()
        pil.save(buffer, "PNG")
        pngs.append(base64.b64encode(buffer.getvalue()).decode())
    return images, pngs


def _detect_type(text):
    lowered = text.lower()
    for doc_type, hints in DOC_TYPE_HINTS.items():
        if all(hint in lowered for hint in hints[:2]) or any(hint in lowered for hint in hints):
            return doc_type
    return None


def _einvoice_json(raw):
    try:
        data = json.loads(raw)
    except Exception:
        return None
    if not isinstance(data, dict) or "DocDtls" not in data or "SellerDtls" not in data:
        return None
    seller, buyer, docd = data["SellerDtls"], data.get("BuyerDtls", {}), data["DocDtls"]
    return {
        "detectedType": "INVOICE_IN",
        "extracted": {
            "type": "INVOICE_IN", "number": docd.get("No"),
            "seller": {"name": seller.get("LglNm"), "gstin": seller.get("Gstin"),
                       "stateCode": seller.get("Stcd")},
            "buyer": {"name": buyer.get("LglNm"), "gstin": buyer.get("Gstin"),
                      "stateCode": buyer.get("Pos")},
            "gst": {"irn": data.get("Irn"), "supplyType": data.get("TranDtls", {}).get("SupTyp")},
        },
    }


def parse(file_bytes, mime):
    if len(file_bytes) > MAX_FILE_BYTES:
        raise DocParseError("File exceeds the 10 MB engine limit")
    issues, qr = [], {"found": False, "verified": False}
    extracted = detected_type = None
    text, pages, page_images = "", 0, []

    if "json" in mime or file_bytes[:1] == b"{":
        einv = _einvoice_json(file_bytes)
        if einv:
            return {"detectedType": "INVOICE_IN", "method": "einvoice_json",
                    "pages": 1, "textLayer": {"present": True, "chars": len(file_bytes)},
                    "qr": qr, "extracted": einv["extracted"], "needsLlm": False,
                    "pageImages": [], "issues": []}
        issues.append({"code": "UNRECOGNISED_JSON", "severity": "info",
                       "message": "JSON payload did not match the e-invoice schema"})
        return {"detectedType": None, "method": "json", "pages": 0,
                "textLayer": {"present": True, "chars": len(file_bytes)},
                "qr": qr, "extracted": None, "needsLlm": False,
                "pageImages": [], "issues": issues}

    if "pdf" in mime or file_bytes.startswith(b"%PDF"):
        import pypdfium2

        doc = pypdfium2.PdfDocument(file_bytes)
        pages = min(len(doc), MAX_PAGES)
        page_text = []
        for index in range(pages):
            textpage = doc[index].get_textpage()
            page_text.append(textpage.get_text_range(0, textpage.count_chars()))
        text = "\n".join(page_text)
        images, pngs = _render_pdf(doc, pages)
        if text.strip():
            detected_type = _detect_type(text)
            gstins = GSTIN_RE.findall(text)
            irns = IRN_RE.findall(text)
            extracted = {"gst": {"irn": irns[0] if irns else None},
                         "seller": {"gstin": gstins[0] if gstins else None},
                         "buyer": {"gstin": gstins[1] if len(gstins) > 1 else None}}
            qr = _scan_images(images)
            needs_llm = detected_type is None
            if not detected_type:
                issues.append({"code": "TYPE_UNRECOGNISED", "severity": "info",
                               "message": "Text layer present but document type was not recognised"})
        else:
            qr = _scan_images(images)
            needs_llm = True
            page_images = pngs
            issues.append({"code": "TEXT_LAYER_MISSING", "severity": "warning",
                           "message": "No extractable text layer; up to 3 page images returned for model fallback"})
        method = "pdf_text" if text.strip() else "pdf_render"
    elif "csv" in mime or file_bytes[:50].lstrip(b"\xef\xbb\xbf")[:1].isalnum() and b"," in file_bytes[:2000] and b"\n" in file_bytes[:2000]:
        try:
            text = file_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise DocParseError("CSV is not valid UTF-8")
        import csv
        rows = list(csv.reader(text.splitlines()))
        headers = rows[0] if rows else []
        gstins = GSTIN_RE.findall(text)
        extracted = {"seller": {"gstin": gstins[0] if gstins else None}} if gstins else None
        detected_type = _detect_type(text)
        issues.append({"code": "CSV_STRUCTURED", "severity": "info",
                       "message": f"CSV detected ({len(rows) - 1} data rows). Use the column-mapped import path (business_imports) rather than LLM extraction"})
        needs_llm = False
        method = "csv"
        pages = 1
    elif mime.startswith("image/") or file_bytes[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1"):
        import zxingcpp
        from PIL import Image

        try:
            image = Image.open(io.BytesIO(file_bytes))
            pages = 1
            qr = _scan_images([image])
        except Exception:
            raise DocParseError("Image could not be decoded")
        needs_llm = True
        page_images = [base64.b64encode(file_bytes).decode()]
        issues.append({"code": "IMAGE_ONLY", "severity": "info",
                       "message": "Image input has no text layer"})
        method = "image"
    else:
        raise DocParseError(f"Unsupported mime type: {mime}")

    return {"detectedType": detected_type, "method": method, "pages": pages,
            "textLayer": {"present": bool(text.strip()), "chars": len(text)},
            "qr": qr, "extracted": extracted, "needsLlm": needs_llm,
            "pageImages": page_images, "issues": issues,
            "text": text if len(text) <= 200000 else text[:200000]}


def validate(request: DocsValidateRequest, master: HsnMaster):
    draft = request.draft.model_dump(exclude_none=True)
    qr_fields = request.qrFields or {}
    fields, issues = {}, []

    def field(name, value, confidence, field_issues=()):
        fields[name] = {"value": value, "confidence": confidence, "issues": list(field_issues)}

    for role in ("seller", "buyer"):
        gstin = (draft.get(role) or {}).get("gstin")
        if not gstin:
            continue
        check = validate_gstin(gstin)
        problems = []
        if not (check["wellFormed"] and check["checksumValid"]):
            problems.append("fails format/checksum")
        state = (draft.get(role) or {}).get("stateCode")
        if state and check["stateCode"] and check["stateCode"] != state:
            problems.append(f"state {check['stateCode']} != declared {state}")
        field(f"{role}.gstin", gstin, 1.0 if not problems else 0.4, problems)
        if problems:
            issues.append({"code": "TAX_GSTIN_INVALID", "severity": "error",
                           "field": f"{role}.gstin", "message": "; ".join(problems)})

    if draft.get("date"):
        field("date", draft["date"], 1.0)
        if str(draft["date"]) > "9999" or draft["date"] < "2000-01-01":
            issues.append({"code": "DATE_IMPLAUSIBLE", "severity": "warning",
                           "field": "date", "message": "Document date outside sane bounds"})

    totals = draft.get("totals")
    if totals:
        computed = sum(float(totals.get(k, 0)) for k in ("taxable", "cgst", "sgst", "igst", "cess")) + float(totals.get("roundOff", 0))
        ok = abs(computed - float(totals["grand"])) <= 0.51
        field("totals.grand", totals["grand"], 1.0 if ok else 0.3,
              () if ok else (f"parts sum {computed:.2f} != grand {totals['grand']}",))
        if not ok:
            issues.append({"code": "TAX_ARITHMETIC", "severity": "error",
                           "field": "totals.grand", "message": "Totals do not add up"})

    for line in draft.get("lines", []):
        hsn = line.get("hsn")
        if hsn and master.codes and hsn not in master.codes:
            issues.append({"code": "HSN_NOT_IN_MASTER", "severity": "warning",
                           "message": f"Line {line['lineNo']} HSN {hsn} not in verified master"})
        if line.get("qty") and line.get("rate") and line.get("taxableValue"):
            expected = float(line["qty"]) * float(line["rate"])
            if line.get("discountPct"):
                expected *= 1 - float(line["discountPct"]) / 100
            if abs(expected - float(line["taxableValue"])) > 1:
                issues.append({"code": "LINE_ARITHMETIC", "severity": "warning",
                               "message": f"Line {line['lineNo']} qty*rate != taxableValue ±1"})

    qr_map = {"number": "DocNo", "date": "DocDt"}
    for ours, theirs in qr_map.items():
        if qr_fields.get(theirs) and draft.get(ours) and str(draft[ours]) != str(qr_fields[theirs]):
            issues.append({"code": "TAX_QR_MISMATCH", "severity": "error",
                           "field": ours,
                           "message": f"Extracted {ours} ({draft[ours]}) != QR {theirs} ({qr_fields[theirs]})"})
    if qr_fields.get("TotInvVal") and totals and str(totals["grand"]) != str(qr_fields["TotInvVal"]):
        issues.append({"code": "TAX_QR_MISMATCH", "severity": "error", "field": "totals.grand",
                       "message": f"Grand total {totals['grand']} != QR TotInvVal {qr_fields['TotInvVal']}"})

    return {"fields": fields, "lines": draft.get("lines", []), "issues": issues,
            "suggestions": {"supplierMatch": None, "poMatch": None}}
