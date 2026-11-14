"""Deterministic document parsing and validation.

No LLM calls inside the engine: parse returns the text layer (plus a
column-preserving layout text), deterministic fields read from it and from an
IRP signed QR, and up to three page images so the caller can decide whether
to ask a model. QR verification is cryptographic and only reports
verified=true after an RS256 check against a trusted IRP key on disk.
"""
import base64
import io
import json
import re
from decimal import Decimal

from .contracts_v2 import DocsValidateRequest
from .extraction import qr as qr_module
from .extraction.fuse import fuse
from .extraction.layout import layout_pages, layout_text
from .extraction.normalize import money_str, parse_amount, parse_date
from .extraction.text_fields import Doc, detect_type
from .india.gstin import validate_gstin
from .india.hsn_master import HsnMaster

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
MAX_RENDER_PAGES = 3
MAX_RENDER_SIDE = 1600
MAX_TEXT_CHARS = 200000
IRP_KEYS_DIR = qr_module.IRP_KEYS_DIR
GSTIN_RE = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b")
IRN_RE = re.compile(r"\b([0-9a-f]{64})\b", re.I)
DOC_TYPE_HINTS = {
    "INVOICE_IN": ("tax invoice", "invoice no", "gstin", "irn"),
    "PO": ("purchase order", "po number", "order no"),
    "GRN": ("goods receipt", "grn", "received quantity"),
    "CREDIT_NOTE_IN": ("credit note",),
    "PI_IN": ("proforma",),
}
# Below this share of critical fields (number, date, seller GSTIN, taxable,
# grand) — or when totals don't add up — a model read is recommended.
LLM_RECOMMENDED_BELOW = 0.8


class DocParseError(ValueError):
    pass


def _jwt_parts(token):
    return qr_module.jwt_parts(token)


def _irp_keys():
    return list(qr_module.irp_keys())


def _verify_qr(token):
    """Return qr dict — verified only on a real signature check."""
    return qr_module.decode_token(token)


def _scan_images(images):
    return qr_module.scan_images(images)


QR_SCAN_SCALE = 4.2  # ~300 dpi: a 3.5 cm e-invoice QR gets ~3 px per module


def _may_hold_qr(page):
    """A QR is either an image XObject or (vector-drawn) hundreds of path objects."""
    import pypdfium2.raw as pdfium_c

    paths = 0
    try:
        for obj in page.get_objects(max_depth=2):
            if obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE:
                return True
            if obj.type == pdfium_c.FPDF_PAGEOBJ_PATH:
                paths += 1
                if paths > 150:
                    return True
    except Exception:
        return True
    return False


def _scan_hi_res(doc, pages):
    """Re-render pages (first three + last) in grayscale at ~300 dpi for QR decoding.

    The review images are capped at 1600 px, which leaves dense IRP QRs (~900
    char JWT, version 20+) at ~2 px/module — below what zxing reads reliably.
    """
    order = list(range(min(pages, MAX_RENDER_PAGES)))
    if pages > MAX_RENDER_PAGES:
        order.append(pages - 1)
    for index in order:
        if not _may_hold_qr(doc[index]):
            continue
        image = doc[index].render(scale=QR_SCAN_SCALE, grayscale=True).to_pil()
        found = _scan_images([image])
        del image
        if found.get("found"):
            found["page"] = index + 1
            return found
    return {"found": False, "verified": False, "signature": "absent"}


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
    titled = detect_type(Doc(text))
    if titled:
        return titled["value"]
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
    doc_type = {"CRN": "CREDIT_NOTE_IN", "DBN": "DEBIT_NOTE_IN"}.get(str(docd.get("Typ", "")).upper(), "INVOICE_IN")
    extracted = {
        "type": doc_type, "number": docd.get("No"),
        "seller": {"name": seller.get("LglNm"), "gstin": seller.get("Gstin"),
                   "stateCode": seller.get("Stcd")},
        "buyer": {"name": buyer.get("LglNm"), "gstin": buyer.get("Gstin"),
                  "stateCode": buyer.get("Pos")},
        "gst": {"irn": data.get("Irn"), "supplyType": data.get("TranDtls", {}).get("SupTyp")},
    }
    iso = parse_date(docd.get("Dt"))
    if iso:
        extracted["date"] = iso
    if buyer.get("Pos"):
        extracted["placeOfSupply"] = str(buyer["Pos"]).zfill(2)
    values = data.get("ValDtls") or {}
    if values:
        mapping = {"taxable": "AssVal", "cgst": "CgstVal", "sgst": "SgstVal", "igst": "IgstVal",
                   "cess": "CesVal", "roundOff": "RndOffAmt", "grand": "TotInvVal"}
        totals = {}
        for ours, theirs in mapping.items():
            amount = parse_amount(values.get(theirs, 0))
            totals[ours] = money_str(amount if amount is not None else Decimal(0))
        extracted["totals"] = totals
    lines = []
    for position, item in enumerate(data.get("ItemList") or [], start=1):
        qty = parse_amount(item.get("Qty"))
        if qty is None:
            continue
        line = {"lineNo": int(item.get("SlNo") or position) if str(item.get("SlNo") or "").isdigit() else position,
                "description": item.get("PrdDesc") or f"Line {position}", "qty": str(qty),
                "uom": item.get("Unit") or "NOS"}
        for ours, theirs in (("rate", "UnitPrice"), ("taxableValue", "AssAmt")):
            amount = parse_amount(item.get(theirs))
            if amount is not None:
                line[ours] = str(amount)
        if item.get("HsnCd"):
            line["hsn"] = str(item["HsnCd"])
        if item.get("GstRt") is not None:
            line["gstRate"] = str(item["GstRt"])
        lines.append(line)
    if lines:
        extracted["lines"] = lines
    return {"detectedType": doc_type, "extracted": extracted}


def _deterministic(result):
    """Attach fused deterministic fields (text layer + QR) to a parse result."""
    fused = fuse(result)
    result["fields"] = fused["fields"]
    result["lines"] = fused["lines"]
    result["coverage"] = fused["coverage"]
    result["fieldIssues"] = fused["issues"]
    result["suggestions"] = fused["suggestions"]
    result["extractionMethod"] = fused["method"]
    merged = dict(result.get("extracted") or {})
    for key, value in fused["extracted"].items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = {**merged[key], **{k: v for k, v in value.items() if v not in (None, "")}}
        elif merged.get(key) in (None, "", [], {}):
            merged[key] = value
    result["extracted"] = merged or None
    coverage = fused["coverage"]
    # Structured inputs (e-invoice JSON) never need a model read; text PDFs do
    # when critical fields are missing or the totals don't add up.
    result["llmRecommended"] = bool(result.get("needsLlm")) or (
        result.get("method") == "pdf_text"
        and (coverage["ratio"] < LLM_RECOMMENDED_BELOW or coverage["totalsClose"] is False))
    return result


def parse(file_bytes, mime):
    if len(file_bytes) > MAX_FILE_BYTES:
        raise DocParseError("File exceeds the 10 MB engine limit")
    issues, qr = [], {"found": False, "verified": False}
    extracted = detected_type = None
    text, layout, pages, page_images = "", "", 0, []

    if "json" in mime or file_bytes[:1] == b"{":
        einv = _einvoice_json(file_bytes)
        if einv:
            result = {"detectedType": einv["detectedType"], "method": "einvoice_json",
                      "pages": 1, "textLayer": {"present": True, "chars": len(file_bytes)},
                      "qr": qr, "extracted": einv["extracted"], "needsLlm": False,
                      "pageImages": [], "issues": []}
            return _deterministic(result)
        issues.append({"code": "UNRECOGNISED_JSON", "severity": "info",
                       "message": "JSON payload did not match the e-invoice schema"})
        return {"detectedType": None, "method": "json", "pages": 0,
                "textLayer": {"present": True, "chars": len(file_bytes)},
                "qr": qr, "extracted": None, "needsLlm": False, "llmRecommended": False,
                "pageImages": [], "issues": issues}

    if "pdf" in mime or file_bytes.startswith(b"%PDF"):
        import pypdfium2

        try:
            doc = pypdfium2.PdfDocument(file_bytes)
        except Exception as error:
            raise DocParseError(f"PDF could not be opened: {error}")
        pages = min(len(doc), MAX_PAGES)
        page_text = []
        for index in range(pages):
            textpage = doc[index].get_textpage()
            page_text.append(textpage.get_text_range(0, textpage.count_chars()))
        text = "\n".join(page_text)
        images, pngs = _render_pdf(doc, pages)
        qr = _scan_images(images)
        if not qr.get("found"):
            qr = _scan_hi_res(doc, pages)
        if text.strip():
            layout = layout_text(layout_pages(doc, pages))
            detected_type = _detect_type(text)
            gstins = GSTIN_RE.findall(text)
            irns = IRN_RE.findall(text)
            extracted = {"gst": {"irn": irns[0] if irns else None},
                         "seller": {"gstin": gstins[0] if gstins else None},
                         "buyer": {"gstin": gstins[1] if len(gstins) > 1 else None}}
            needs_llm = detected_type is None
            if not detected_type:
                issues.append({"code": "TYPE_UNRECOGNISED", "severity": "info",
                               "message": "Text layer present but document type was not recognised"})
        else:
            needs_llm = True
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
        gstins = GSTIN_RE.findall(text)
        extracted = {"seller": {"gstin": gstins[0] if gstins else None}} if gstins else None
        detected_type = _detect_type(text)
        issues.append({"code": "CSV_STRUCTURED", "severity": "info",
                       "message": f"CSV detected ({len(rows) - 1} data rows). Use the column-mapped import path (business_imports) rather than LLM extraction"})
        result = {"detectedType": detected_type, "method": "csv", "pages": 1,
                  "textLayer": {"present": bool(text.strip()), "chars": len(text)},
                  "qr": qr, "extracted": extracted, "needsLlm": False, "llmRecommended": False,
                  "pageImages": [], "issues": issues, "text": text[:MAX_TEXT_CHARS]}
        return result
    elif mime.startswith("image/") or file_bytes[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1"):
        from PIL import Image

        try:
            image = Image.open(io.BytesIO(file_bytes))
            image.load()
            pages = 1
        except Exception:
            raise DocParseError("Image could not be decoded")
        qr = _scan_images([image])
        needs_llm = True
        page_images = [base64.b64encode(file_bytes).decode()]
        issues.append({"code": "IMAGE_ONLY", "severity": "info",
                       "message": "Image input has no text layer"})
        method = "image"
    else:
        raise DocParseError(f"Unsupported mime type: {mime}")

    result = {"detectedType": detected_type, "method": method, "pages": pages,
              "textLayer": {"present": bool(text.strip()), "chars": len(text)},
              "qr": qr, "extracted": extracted, "needsLlm": needs_llm,
              "pageImages": page_images, "issues": issues,
              "text": text[:MAX_TEXT_CHARS], "layoutText": layout[:MAX_TEXT_CHARS]}
    result = _deterministic(result)
    if method == "pdf_text" and result["llmRecommended"] and not page_images:
        result["pageImages"] = pngs
    elif method == "pdf_render":
        result["pageImages"] = pngs
    return result


def _dec(value):
    amount = parse_amount(value)
    return amount if amount is not None else Decimal(0)


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
        computed = sum(_dec(totals.get(k, 0)) for k in ("taxable", "cgst", "sgst", "igst", "cess")) + _dec(totals.get("roundOff", 0))
        ok = abs(computed - _dec(totals["grand"])) <= Decimal("0.51")
        field("totals.grand", totals["grand"], 1.0 if ok else 0.3,
              () if ok else (f"parts sum {money_str(computed)} != grand {totals['grand']}",))
        if not ok:
            issues.append({"code": "TAX_ARITHMETIC", "severity": "error",
                           "field": "totals.grand", "message": "Totals do not add up"})

    for line in draft.get("lines", []):
        hsn = line.get("hsn")
        if hsn and master.codes and hsn not in master.codes:
            issues.append({"code": "HSN_NOT_IN_MASTER", "severity": "warning",
                           "message": f"Line {line['lineNo']} HSN {hsn} not in verified master"})
        if line.get("qty") and line.get("rate") and line.get("taxableValue"):
            expected = _dec(line["qty"]) * _dec(line["rate"])
            if line.get("discountPct"):
                expected *= 1 - _dec(line["discountPct"]) / 100
            if abs(expected - _dec(line["taxableValue"])) > 1:
                issues.append({"code": "LINE_ARITHMETIC", "severity": "warning",
                               "message": f"Line {line['lineNo']} qty*rate != taxableValue ±1"})

    # QR fields are printed formats (DocDt dd/mm/yyyy, TotInvVal a number):
    # compare normalised values, not raw strings.
    if qr_fields.get("DocNo") and draft.get("number") and str(draft["number"]).strip() != str(qr_fields["DocNo"]).strip():
        issues.append({"code": "TAX_QR_MISMATCH", "severity": "error", "field": "number",
                       "message": f"Extracted number ({draft['number']}) != QR DocNo ({qr_fields['DocNo']})"})
    if qr_fields.get("DocDt") and draft.get("date"):
        qr_date = parse_date(qr_fields["DocDt"]) or qr_fields["DocDt"]
        if str(draft["date"]) != qr_date:
            issues.append({"code": "TAX_QR_MISMATCH", "severity": "error", "field": "date",
                           "message": f"Extracted date ({draft['date']}) != QR DocDt ({qr_fields['DocDt']})"})
    if qr_fields.get("TotInvVal") and totals:
        qr_total = parse_amount(qr_fields["TotInvVal"])
        if qr_total is None or abs(_dec(totals["grand"]) - qr_total) > Decimal("0.01"):
            issues.append({"code": "TAX_QR_MISMATCH", "severity": "error", "field": "totals.grand",
                           "message": f"Grand total {totals['grand']} != QR TotInvVal {qr_fields['TotInvVal']}"})

    return {"fields": fields, "lines": draft.get("lines", []), "issues": issues,
            "suggestions": {"supplierMatch": None, "poMatch": None}}
