"""Evidence fusion with decomposed per-field confidence.

Sources, strongest first: IRP signed QR (signature verified) > e-invoice JSON >
signed QR (well-formed, signature not verified) > PDF text layer > vision LLM.

Confidence is NOT the LLM's self-report (verbalised VLM confidence is a weak
signal). It is decomposed into
  1. perception: which source produced the value and how (labelled match vs
     positional heuristic vs quote-grounded LLM read),
  2. agreement: independent sources that agree are combined (noisy-OR),
     disagreement lowers the losing source and raises an issue,
  3. business-rule validation: GSTIN checksum, totals arithmetic (±₹1),
     Σ lines = taxable, qty × rate = amount, CGST = SGST / IGST consistency
     with seller/buyer state codes, date plausibility, GST number format.
Every field below 0.9 or with an issue is ``needsReview``. Nothing here ever
auto-confirms a document.
"""
import re
from datetime import date, timedelta
from decimal import Decimal

from ..india.gstin import validate_gstin
from .normalize import decimal_str, money_str, normalize_doc_type, parse_amount, parse_date
from .qr import decode_token, map_fields, well_formed_problems
from .text_fields import GST_SLABS, UOMS, _state_names, parse_text


def _state_codes():
    return set(_state_names().values())

REVIEW_THRESHOLD = 0.9
LLM_ONLY_CAP = 0.85
TOTAL_KEYS = ("taxable", "cgst", "sgst", "igst", "cess", "roundOff", "grand")
TAX_KEYS = ("cgst", "sgst", "igst", "cess")
CRITICAL = ("number", "date", "seller.gstin", "totals.taxable", "totals.grand")
GST_ERA = date(2017, 7, 1)
CONFUSABLE_IN_DIGITS = re.compile(r"\d[OIlSBZG]\d|\d[OIlSBZG]$|(?<![A-Za-z])[OIlSBZG]\d{2,}$")
FY_IN_NUMBER = re.compile(r"(?<!\d)(?:20)?(\d{2})-(\d{2})(?!\d)|(?<=/)(\d{2})(\d{2})(?=/)")
TEXT_BASE = {"label": 0.85, "heuristic": 0.6, "derived": 0.8}
PRECEDENCE = {"einvoice_qr_verified": 5, "einvoice_json": 4, "einvoice_qr": 3, "text_layer": 2, "vision_llm": 1}


def _key(field, value):
    if value is None:
        return None
    if field.startswith("totals.") or field == "amount":
        amount = parse_amount(value)
        return amount.quantize(Decimal("0.01")) if amount is not None else None
    if field in ("number", "poReference"):
        return re.sub(r"\s+", "", str(value)).upper()
    if field.endswith(".name"):
        return re.sub(r"[^A-Z0-9]", "", str(value).upper())
    return str(value).strip().upper()


def _noisy_or(confidences):
    remaining = 1.0
    for confidence in confidences:
        remaining *= 1 - confidence
    return min(0.995, 1 - remaining)


class Board:
    """Candidate values per field from every source."""

    def __init__(self):
        self.cands = {}

    def add(self, field, value, source, confidence, quote=None, page=None, rank=None):
        if value is None or value == "" or value == {}:
            return
        self.cands.setdefault(field, []).append({
            "value": value, "source": source, "confidence": confidence, "quote": quote,
            "page": page, "rank": PRECEDENCE[rank or source]})


# ------------------------------------------------------------------- sources

def resolve_qr(qr, qr_fields=None, extra_keys=None):
    """Re-verify from the raw token when available; never trust a claimed 'verified'."""
    qr = qr or {}
    if qr.get("raw"):
        decoded = decode_token(qr["raw"], extra_keys=extra_keys)
        if decoded.get("kind") == "irp_jwt":
            return decoded
    fields = {str(k): str(v) for k, v in ((qr.get("fields") or qr_fields or {}).items())}
    if not fields:
        return None
    mapped = map_fields(fields)
    problems = well_formed_problems(mapped)
    return {"found": True, "kind": "irp_jwt", "verified": False, "signature": "not_verified",
            "reason": "QR fields supplied without the signed token — signature cannot be checked",
            "fields": fields, "mapped": mapped, "wellFormed": not problems, "problems": problems,
            "keyId": None, "keySource": None}


def _add_qr(board, qr):
    if not qr or qr.get("kind") != "irp_jwt" or not qr.get("mapped"):
        return
    if qr.get("verified"):
        confidence, rank = 0.99, "einvoice_qr_verified"
    elif qr.get("wellFormed"):
        confidence, rank = 0.9, "einvoice_qr"
    else:
        confidence, rank = 0.6, "einvoice_qr"
    for field, value in qr["mapped"].items():
        if field == "gst.irnDate":
            continue
        board.add(field, value, "einvoice_qr", confidence, quote=f"signed QR {field}", page=qr.get("page"), rank=rank)


def _add_text(board, tf):
    if not tf or tf.get("empty"):
        return
    def add(field, cand, value=None):
        if cand and cand.get("value") is not None:
            board.add(field, cand["value"] if value is None else value, "text_layer",
                      TEXT_BASE.get(cand.get("strength"), 0.6), cand.get("quote"), cand.get("page"))
    if tf.get("type"):
        # A printed title ("TAX INVOICE", "CREDIT NOTE") is a strong type signal.
        board.add("type", tf["type"]["value"], "text_layer", 0.92, tf["type"].get("quote"), tf["type"].get("page"))
    add("number", tf.get("number"))
    add("date", tf.get("date"))
    for role in ("seller", "buyer"):
        party = (tf.get("parties") or {}).get(role) or {}
        if party.get("gstin"):
            add(f"{role}.gstin", party["gstin"])
        if party.get("name"):
            add(f"{role}.name", party["name"])
    for key, cand in (tf.get("totals") or {}).items():
        # zeros the solver implied are re-derived (and labelled) after fusion
        if cand and cand.get("value") is not None and not (cand.get("strength") == "derived" and cand["value"] == 0):
            board.add(f"totals.{key}", money_str(cand["value"]), "text_layer",
                      TEXT_BASE.get(cand.get("strength"), 0.6), cand.get("quote") or None, cand.get("page"))
    add("gst.irn", tf.get("irn"))
    add("poReference", tf.get("poReference"))
    add("placeOfSupply", tf.get("placeOfSupply"))
    add("currency", tf.get("currency"))
    if tf.get("lines"):
        board.add("lineCount", len(tf["lines"]), "text_layer", 0.7)


def _add_einvoice_json(board, extracted):
    if not extracted:
        return
    def add(field, value):
        board.add(field, value, "einvoice_json", 0.97, quote=f"e-invoice JSON {field}")
    add("type", extracted.get("type"))
    add("number", extracted.get("number"))
    add("date", extracted.get("date"))
    for role in ("seller", "buyer"):
        party = extracted.get(role) or {}
        add(f"{role}.gstin", party.get("gstin"))
        add(f"{role}.name", party.get("name"))
    for key, value in (extracted.get("totals") or {}).items():
        add(f"totals.{key}", value)
    add("gst.irn", (extracted.get("gst") or {}).get("irn"))
    add("placeOfSupply", extracted.get("placeOfSupply"))
    if extracted.get("lines"):
        add("lineCount", len(extracted["lines"]))


def _norm_space(text):
    return re.sub(r"\s+", " ", str(text or "")).strip().lower()


def normalize_llm(extracted):
    """Gateway LLM JSON (printed formats, extra keys) -> normalised candidates."""
    extracted = extracted if isinstance(extracted, dict) else {}
    out = {}
    def text(value):
        return str(value).strip() if value not in (None, "") and not isinstance(value, (dict, list)) else None
    out["type"] = normalize_doc_type(extracted.get("type"))
    out["number"] = text(extracted.get("number"))
    out["date"] = parse_date(extracted.get("date")) if text(extracted.get("date")) else None
    for role in ("seller", "buyer"):
        party = extracted.get(role) if isinstance(extracted.get(role), dict) else {}
        gstin = re.sub(r"\s", "", str(party.get("gstin") or "")).upper()
        out[f"{role}.gstin"] = gstin or None
        out[f"{role}.name"] = text(party.get("name"))
    totals = extracted.get("totals") if isinstance(extracted.get("totals"), dict) else {}
    for key in TOTAL_KEYS:
        amount = parse_amount(totals.get(key)) if text(totals.get(key)) else None
        out[f"totals.{key}"] = money_str(amount) if amount is not None else None
    gst = extracted.get("gst") if isinstance(extracted.get("gst"), dict) else {}
    irn = re.sub(r"\s", "", str(gst.get("irn") or "")).lower()
    out["gst.irn"] = irn if re.fullmatch(r"[0-9a-f]{64}", irn) else None
    out["poReference"] = text(extracted.get("poReference"))
    pos = text(extracted.get("placeOfSupply"))
    if pos:
        code = re.search(r"(?<!\d)(\d{2})(?!\d)", pos)
        out["placeOfSupply"] = code.group(1) if code else _state_names().get(re.sub(r"[^A-Z ]", "", pos.upper()).strip())
    currency = text(extracted.get("currency"))
    out["currency"] = currency.upper()[:3] if currency else None
    lines = []
    for position, line in enumerate(extracted.get("lines") or [], start=1):
        if not isinstance(line, dict):
            continue
        qty = parse_amount(line.get("qty"))
        if qty is None or qty <= 0:
            continue
        item = {"lineNo": position, "description": (text(line.get("description")) or f"Line {position}")[:500],
                "qty": decimal_str(qty)}
        rate = parse_amount(line.get("rate"))
        if rate is not None and rate >= 0:
            item["rate"] = decimal_str(rate)
        taxable = parse_amount(line.get("taxableValue")) or parse_amount(line.get("amount"))
        if taxable is not None:
            item["taxableValue"] = money_str(taxable)
        hsn = re.sub(r"\D", "", str(line.get("hsn") or ""))
        if 4 <= len(hsn) <= 8:
            item["hsn"] = hsn
        uom = text(line.get("uom"))
        if uom:
            item["uom"] = uom.upper()[:10]
        rate_pct = parse_amount(str(line.get("gstRate") or "").replace("%", ""))
        if rate_pct is not None and decimal_str(rate_pct) in GST_SLABS:
            item["gstRate"] = decimal_str(rate_pct)
        lines.append(item)
    out["lines"] = lines
    terms = extracted.get("terms") if isinstance(extracted.get("terms"), dict) else {}
    clean_terms = {}
    for key in ("paymentTerms", "deliveryTerms", "warranty"):
        if text(terms.get(key)):
            clean_terms[key] = text(terms[key])[:200]
    try:
        if terms.get("creditDays") not in (None, ""):
            clean_terms["creditDays"] = int(float(str(terms["creditDays"]).strip()))
    except ValueError:
        pass
    advance = parse_amount(str(terms.get("advancePct") or "").replace("%", "")) if text(terms.get("advancePct")) else None
    if advance is not None:
        clean_terms["advancePct"] = decimal_str(advance)
    out["terms"] = clean_terms or None
    payment = extracted.get("payment") if isinstance(extracted.get("payment"), dict) else {}
    amount = parse_amount(payment.get("amount")) if text(payment.get("amount")) else None
    if amount is not None:
        clean_payment = {"amount": money_str(amount)}
        if text(payment.get("utr")):
            clean_payment["utr"] = text(payment["utr"])[:40]
        mode = (text(payment.get("mode")) or "").upper()
        if mode:
            clean_payment["mode"] = mode if mode in {"NEFT", "RTGS", "IMPS", "UPI", "CHEQUE"} else "OTHER"
        value_date = parse_date(payment.get("valueDate")) if text(payment.get("valueDate")) else None
        if value_date:
            clean_payment["valueDate"] = value_date
        if text(payment.get("bankAccountMasked")):
            clean_payment["bankAccountMasked"] = text(payment["bankAccountMasked"])[:40]
        out["payment"] = clean_payment
    bank = extracted.get("bankDetails") if isinstance(extracted.get("bankDetails"), dict) else {}
    bank = {k: text(v)[:60] for k, v in bank.items() if k in ("accountMasked", "ifsc", "bankName") and text(v)}
    out["bankDetails"] = bank or None
    return {k: v for k, v in out.items() if v not in (None, "", [], {})}


def _llm_quote(quotes, field):
    if not isinstance(quotes, dict):
        return None, None
    entry = quotes.get(field) or quotes.get(field.split(".")[0])
    if isinstance(entry, dict):
        return (str(entry.get("quote") or "")[:200] or None), entry.get("page")
    if isinstance(entry, str):
        return entry[:200], None
    return None, None


def _add_llm(board, llm, text):
    if not llm:
        return {}
    normalized = normalize_llm(llm.get("extracted") or {})
    haystack = _norm_space(text)
    quotes = llm.get("quotes") or (llm.get("extracted") or {}).get("quotes") or {}
    for field, value in normalized.items():
        if field in ("lines", "terms", "payment", "bankDetails"):
            continue
        quote, page = _llm_quote(quotes, field)
        confidence = 0.6
        # Grounding check: the model's verbatim quote really is in the text layer.
        if quote and haystack and _norm_space(quote) in haystack:
            confidence = 0.75
        board.add(field, value, "vision_llm", confidence, quote, page)
    if normalized.get("lines"):
        board.add("lineCount", len(normalized["lines"]), "vision_llm", 0.6)
    return normalized


# ---------------------------------------------------------------- selection

def _choose(board, field):
    cands = board.cands.get(field) or []
    if not cands:
        return None
    groups = {}
    for cand in cands:
        groups.setdefault(_key(field, cand["value"]), []).append(cand)
    ordered = sorted(groups.items(), key=lambda item: (-max(c["rank"] for c in item[1]),
                                                       -max(c["confidence"] for c in item[1])))
    _, winners = ordered[0]
    best = max(winners, key=lambda c: (c["rank"], c["confidence"]))
    sources = {}
    for cand in winners:
        sources[cand["source"]] = max(sources.get(cand["source"], 0), cand["confidence"])
    confidence = _noisy_or(sources.values()) if len(sources) > 1 else best["confidence"]
    issues, codes = [], []
    losers = [c for _, group in ordered[1:] for c in group]
    for loser in losers:
        if best["source"] == "einvoice_qr":
            codes.append(("TAX_QR_MISMATCH", "error",
                          f"{loser['source']} read {field} = {loser['value']} but the signed QR says {best['value']}"))
        else:
            codes.append(("EXTRACTION_CONFLICT", "warning",
                          f"{loser['source']} read {field} = {loser['value']}; using {best['source']} value {best['value']}"))
            confidence = min(confidence, best["confidence"] * 0.8)
    if set(sources) == {"vision_llm"}:
        confidence = min(confidence, LLM_ONLY_CAP)
    quote = next((c["quote"] for c in winners if c["source"] == "text_layer" and c["quote"]), None) or best["quote"]
    page = next((c["page"] for c in winners if c["source"] == "text_layer" and c["page"]), None) or best["page"]
    chosen = {"value": best["value"], "confidence": confidence, "source": best["source"],
              "sources": sorted(sources), "quote": quote, "page": page, "issues": issues, "codes": codes}
    if losers:
        chosen["candidates"] = [{"source": c["source"], "value": c["value"]} for c in losers[:4]]
    return chosen


def _cap(entry, limit, message=None, code=None, severity="warning"):
    if not entry:
        return
    entry["confidence"] = min(entry["confidence"], limit)
    if message:
        entry["issues"].append(message)
        if code:
            entry["codes"].append((code, severity, message))


def _boost(entry, floor):
    if entry and entry["confidence"] >= 0.6 and not entry["codes"]:
        entry["confidence"] = max(entry["confidence"], floor)


# ------------------------------------------------------------------ fusion

def fuse(parsed=None, llm=None, qr_fields=None, *, today=None, extra_keys=None):
    parsed = parsed or {}
    today = today or date.today()
    text = parsed.get("layoutText") or parsed.get("text") or ""
    hint = normalize_doc_type(parsed.get("detectedType"))
    tf = parse_text(text, hint) if text.strip() and parsed.get("method") != "einvoice_json" else {"empty": True}
    qr = resolve_qr(parsed.get("qr"), qr_fields, extra_keys)
    board = Board()
    _add_qr(board, qr)
    if parsed.get("method") == "einvoice_json":
        _add_einvoice_json(board, parsed.get("extracted"))
    _add_text(board, tf)
    llm_norm = _add_llm(board, llm, text)

    chosen = {field: _choose(board, field) for field in list(board.cands)}
    chosen = {k: v for k, v in chosen.items() if v}
    global_issues = []

    # --- validators -------------------------------------------------------
    doc_type = (chosen.get("type") or {}).get("value") or hint or "INVOICE_IN"
    for role in ("seller", "buyer"):
        entry = chosen.get(f"{role}.gstin")
        if not entry:
            continue
        check = validate_gstin(entry["value"])
        if not (check["wellFormed"] and check["checksumValid"]):
            _cap(entry, 0.3, "GSTIN fails format/checksum", "TAX_GSTIN_INVALID", "error")
        elif entry["source"] == "text_layer" and entry["confidence"] >= 0.85:
            entry["confidence"] = max(entry["confidence"], 0.92)  # checksum passed + labelled role
    if chosen.get("seller.gstin") and chosen.get("buyer.gstin") and chosen["seller.gstin"]["value"] == chosen["buyer.gstin"]["value"]:
        _cap(chosen["buyer.gstin"], 0.4, "buyer GSTIN equals seller GSTIN", "PARTY_ROLE_AMBIGUOUS")

    entry = chosen.get("date")
    if entry:
        iso = parse_date(entry["value"])
        if not iso:
            _cap(entry, 0.2, "not a calendar date", "DATE_INVALID", "error")
        else:
            entry["value"] = iso
            when = date.fromisoformat(iso)
            if when < GST_ERA or when > today + timedelta(days=31):
                _cap(entry, 0.4, f"date {iso} outside {GST_ERA.isoformat()} .. today+31d", "DATE_IMPLAUSIBLE")
            elif entry["source"] == "text_layer" and entry["confidence"] >= 0.85:
                entry["confidence"] = max(entry["confidence"], 0.9)  # labelled + real calendar date + plausible

    entry = chosen.get("gst.irn")
    if entry:
        if not re.fullmatch(r"[0-9a-f]{64}", str(entry["value"])):
            _cap(entry, 0.3, "IRN must be 64 hex characters", "IRN_FORMAT")
        elif entry["confidence"] >= 0.85:
            entry["confidence"] = max(entry["confidence"], 0.9)

    entry = chosen.get("placeOfSupply")
    if entry:
        if str(entry["value"]) not in _state_codes():
            _cap(entry, 0.3, f"unknown GST state code {entry['value']}", "STATE_CODE_UNKNOWN")
        elif chosen.get("buyer.gstin") and str(chosen["buyer.gstin"]["value"])[:2] == entry["value"]:
            _boost(entry, 0.95)

    entry = chosen.get("currency")
    if entry and entry["value"] == "INR" and (chosen.get("seller.gstin") or chosen.get("buyer.gstin")):
        _boost(entry, 0.9)

    entry = chosen.get("number")
    if entry:
        value = str(entry["value"]).strip()
        if doc_type in ("INVOICE_IN", "CREDIT_NOTE_IN", "DEBIT_NOTE_IN") and (len(value) > 16 or not re.fullmatch(r"[A-Za-z0-9/\-]+", value)):
            _cap(entry, 0.7, "GST document numbers are at most 16 characters of A-Z, 0-9, / and -", "INVOICE_NUMBER_FORMAT")
        if entry["source"] == "text_layer" and entry["confidence"] >= 0.85:
            entry["confidence"] = max(entry["confidence"], 0.9)
        if CONFUSABLE_IN_DIGITS.search(value):
            _cap(entry, 0.8, "letter between digits (O/I/l/S/B/Z/G) — possible OCR confusion", "NUMBER_OCR_SUSPECT")
        fy = _fy_start(value)
        date_entry = chosen.get("date")
        if fy and date_entry and parse_date(date_entry["value"]):
            start = fy
            when = date.fromisoformat(parse_date(date_entry["value"]))
            if not date(start, 4, 1) <= when <= date(start + 1, 3, 31):
                message = f"number carries FY {start}-{(start + 1) % 100:02d} but the date {when.isoformat()} is outside it"
                _cap(date_entry, 0.6, message, "DATE_FY_MISMATCH")
                _cap(entry, 0.8)

    # totals arithmetic
    parts = {key: chosen.get(f"totals.{key}") for key in TOTAL_KEYS}
    amounts = {key: (parse_amount(e["value"]) if e else None) for key, e in parts.items()}
    lines, line_source = _select_lines(tf, llm_norm, amounts.get("taxable"))
    lines_sum = sum((Decimal(l["taxableValue"]) for l in lines if l.get("taxableValue")), Decimal(0)) if lines else None
    if amounts["taxable"] is None and lines_sum is not None and lines_sum > 0:
        chosen["totals.taxable"] = {"value": money_str(lines_sum), "confidence": 0.8, "source": line_source,
                                    "sources": [line_source], "quote": "sum of line taxable values", "page": None,
                                    "issues": [], "codes": []}
        parts["taxable"], amounts["taxable"] = chosen["totals.taxable"], lines_sum
    closes = None
    if amounts["taxable"] is not None and amounts["grand"] is not None:
        computed = sum((amounts[k] or Decimal(0)) for k in ("taxable", "cgst", "sgst", "igst", "cess", "roundOff"))
        diff = abs(computed - amounts["grand"])
        closes = diff <= 1
        printed_tax = any(parts[k] is not None for k in ("cgst", "sgst", "igst"))
        if closes:
            for key in ("cgst", "sgst", "igst", "cess", "roundOff"):
                if parts[key] is None:
                    chosen[f"totals.{key}"] = parts[key] = {
                        "value": "0.00", "confidence": 0.9, "source": parts["grand"]["source"] if parts["grand"]["source"] != "einvoice_qr" else "text_layer",
                        "sources": ["derived"], "quote": "not printed; implied by taxable + taxes = grand",
                        "page": None, "issues": [], "codes": []}
                    amounts[key] = Decimal(0)
            lines_exact = lines_sum is not None and abs(lines_sum - amounts["taxable"]) <= Decimal("0.05")
            # Exact closure (±1 paisa) once round-off is accounted for is strong
            # evidence; a ₹0.02-1.00 gap with no printed round-off is not.
            floor = (0.97 if lines_exact else 0.95) if diff <= Decimal("0.01") else 0.85
            if floor < 0.9:
                message = f"taxable + taxes + round-off is off from grand by {money_str(diff)} with no printed round-off"
                parts["grand"]["issues"].append(message)
                global_issues.append({"code": "TAX_ROUNDING_UNEXPLAINED", "severity": "warning",
                                      "field": "totals.grand", "message": message})
            for key in TOTAL_KEYS:
                _boost(parts[key], floor)
                if floor < 0.9:
                    _cap(parts[key], floor)
            tax_labels_seen = bool(tf and not tf.get("empty") and tf.get("taxLabelsSeen"))
            if not printed_tax and tax_labels_seen and amounts["taxable"] > 0:
                message = "CGST/SGST/IGST labels are printed but no tax amount was read — zero tax is suspect"
                for key in ("cgst", "sgst", "igst", "grand"):
                    _cap(parts[key], 0.6, message if key == "grand" else None, "TAX_ZERO_SUSPECT" if key == "grand" else None)
            expected_tax = _expected_tax(lines)
            total_tax = sum((amounts[k] or Decimal(0)) for k in ("cgst", "sgst", "igst"))
            if expected_tax is not None and amounts["taxable"] is not None and lines_exact:
                if abs(expected_tax - total_tax) > max(Decimal(1), expected_tax * Decimal("0.002")):
                    message = (f"line GST rates imply tax {money_str(expected_tax)} but CGST+SGST+IGST = "
                               f"{money_str(total_tax)}")
                    for key in ("cgst", "sgst", "igst"):
                        _cap(parts[key], 0.6, message if key == "cgst" else None, "TAX_RATE_MISMATCH" if key == "cgst" else None)
        else:
            message = (f"taxable + taxes + round-off = {money_str(computed)} but grand total is "
                       f"{money_str(amounts['grand'])} (tolerance ₹1)")
            for key in TOTAL_KEYS:
                _cap(parts[key], 0.5)
            parts["grand"]["issues"].append(message)
            global_issues.append({"code": "TAX_ARITHMETIC", "severity": "error", "field": "totals.grand", "message": message})
    # supply-type consistency (intra-state: CGST = SGST, no IGST; inter-state: IGST only)
    seller_state = (chosen.get("seller.gstin") or {}).get("value", "")[:2] or None
    buyer_state = (chosen.get("placeOfSupply") or {}).get("value") or ((chosen.get("buyer.gstin") or {}).get("value", "")[:2] or None)
    has_cgst = (amounts.get("cgst") or 0) > 0 or (amounts.get("sgst") or 0) > 0
    has_igst = (amounts.get("igst") or 0) > 0
    if has_cgst and amounts.get("cgst") != amounts.get("sgst"):
        message = f"CGST {money_str(amounts.get('cgst') or 0)} != SGST {money_str(amounts.get('sgst') or 0)}"
        for key in ("cgst", "sgst"):
            _cap(parts[key], 0.6, message if key == "cgst" else None, "TAX_CGST_SGST_UNEQUAL" if key == "cgst" else None)
    if seller_state and buyer_state and (has_cgst or has_igst):
        intra = seller_state == buyer_state
        if (intra and has_igst) or (not intra and has_cgst):
            message = (f"{'intra' if intra else 'inter'}-state supply ({seller_state}->{buyer_state}) "
                       f"should carry {'CGST+SGST' if intra else 'IGST'}")
            for key in ("cgst", "sgst", "igst"):
                _cap(parts[key], 0.7, message if key == "igst" or (key == "cgst" and not parts["igst"]) else None,
                     "TAX_SUPPLY_TYPE_MISMATCH")

    # lines
    line_issues = []
    if lines and amounts.get("taxable") is not None and lines_sum is not None and abs(lines_sum - amounts["taxable"]) > 1:
        line_issues.append({"code": "LINES_TOTAL_MISMATCH", "severity": "warning", "field": "lines",
                            "message": f"line taxable values sum to {money_str(lines_sum)} but taxable total is {money_str(amounts['taxable'])}"})
    qr_count = (qr or {}).get("mapped", {}).get("lineCount") if qr else None
    if qr_count is not None and lines and qr_count != len(lines):
        line_issues.append({"code": "LINE_COUNT_MISMATCH", "severity": "warning", "field": "lines",
                            "message": f"signed QR says {qr_count} items; {len(lines)} lines were read"})
    lines_ok = bool(lines) and not line_issues and closes is not False
    for line in lines:
        arithmetic_ok = True
        if line.get("rate") and line.get("taxableValue"):
            arithmetic_ok = abs(Decimal(line["qty"]) * Decimal(line["rate"]) - Decimal(line["taxableValue"])) <= 1
        base = 0.6 if line["source"] == "vision_llm" else 0.85
        line["confidence"] = round(min(LLM_ONLY_CAP if line["source"] == "vision_llm" else 0.97,
                                       0.97 if lines_ok and arithmetic_ok else base if arithmetic_ok else 0.4), 3)
        line["needsReview"] = line["confidence"] < REVIEW_THRESHOLD
        if not arithmetic_ok:
            line_issues.append({"code": "LINE_ARITHMETIC", "severity": "warning", "field": f"lines.{line['lineNo']}",
                                "message": f"Line {line['lineNo']} qty x rate != taxable value (±₹1)"})
    if "lineCount" in chosen and lines:
        if lines_ok:
            _boost(chosen["lineCount"], 0.95)

    # A value only the model read (or derived from model-only values) stays
    # below the review threshold even when the arithmetic closes: a model can
    # compute a consistent-but-wrong set of totals.
    for entry in chosen.values():
        if entry["source"] == "vision_llm" and set(entry.get("sources", [])) <= {"vision_llm", "derived"}:
            entry["confidence"] = min(entry["confidence"], LLM_ONLY_CAP)
    fields = _assemble(chosen, qr, llm_norm, doc_type)
    for name, entry in chosen.items():
        for code, severity, message in entry.get("codes", []):
            global_issues.append({"code": code, "severity": severity, "field": name, "message": message})
    issues = _dedupe(global_issues + line_issues)

    method = _method(chosen, qr, parsed)
    found = [name for name in CRITICAL if name in chosen]
    if qr and qr.get("signature") == "not_verified" and qr.get("kind") == "irp_jwt":
        issues.append({"code": "QR_SIGNATURE_NOT_VERIFIED", "severity": "warning", "field": "gst",
                       "message": qr.get("reason") or "QR signature not verified"})
    return {
        "method": method,
        "detectedType": doc_type,
        "fields": fields,
        "lines": [_draft_line(line) for line in lines],
        "issues": issues,
        "suggestions": {
            "supplierMatch": None, "poMatch": None,
            "supplierGstin": (chosen.get("seller.gstin") or {}).get("value"),
            "supplierName": (chosen.get("seller.name") or {}).get("value"),
            "poNumber": (chosen.get("poReference") or {}).get("value"),
        },
        "coverage": {"critical": list(CRITICAL), "found": found, "missing": [c for c in CRITICAL if c not in found],
                     "ratio": round(len(found) / len(CRITICAL), 3), "totalsClose": closes},
        "qr": _qr_summary(qr),
        "needsReview": True,
        "extracted": to_partial_document(fields, lines),
    }


def _fy_start(number):
    """FY embedded in a document number ('25-26', '2025-26', '/2526/') -> 2025."""
    for match in FY_IN_NUMBER.finditer(number):
        first, second = (match.group(1), match.group(2)) if match.group(1) else (match.group(3), match.group(4))
        if (int(first) + 1) % 100 == int(second):
            return 2000 + int(first)
    return None


def _expected_tax(lines):
    """Σ taxable x GST rate when every line states its rate, else None."""
    if not lines or any(not l.get("gstRate") or not l.get("taxableValue") for l in lines):
        return None
    return sum((Decimal(l["taxableValue"]) * Decimal(l["gstRate"]) / 100 for l in lines), Decimal(0))


def _draft_line(line):
    out = {k: v for k, v in line.items() if not k.startswith("_")}
    if out.get("taxableValue") is not None:
        out["amount"] = out["taxableValue"]
    return out


def _select_lines(tf, llm_norm, taxable):
    text_lines = [dict(line, source="text_layer") for line in (tf.get("lines") or [])] if tf else []
    llm_lines = [dict(line, source="vision_llm") for line in (llm_norm.get("lines") or [])] if llm_norm else []
    def total(lines):
        return sum((Decimal(l["taxableValue"]) for l in lines if l.get("taxableValue")), Decimal(0))
    if text_lines and llm_lines and taxable is not None:
        if abs(total(text_lines) - taxable) > 1 and abs(total(llm_lines) - taxable) <= 1:
            return llm_lines, "vision_llm"
    if text_lines:
        return text_lines, "text_layer"
    return llm_lines, "vision_llm"


def _entry(chosen, threshold=REVIEW_THRESHOLD):
    out = {"value": chosen["value"], "confidence": round(chosen["confidence"], 3), "source": chosen["source"],
           "issues": list(chosen["issues"]) + [m for _c, _s, m in chosen["codes"] if m not in chosen["issues"]]}
    if chosen.get("quote"):
        out["quote"] = chosen["quote"]
    if chosen.get("page"):
        out["page"] = chosen["page"]
    if chosen.get("candidates"):
        out["candidates"] = chosen["candidates"]
    if len(chosen.get("sources", [])) > 1:
        out["agreement"] = chosen["sources"]
    out["needsReview"] = out["confidence"] < threshold or bool(out["issues"])
    return out


def _composite(value, parts, source, extra_issues=()):
    confidences = [p["confidence"] for p in parts.values()]
    issues = [f"{name}: {issue}" for name, p in parts.items() for issue in p["issues"]] + list(extra_issues)
    out = {"value": value, "confidence": round(min(confidences), 3) if confidences else 0.0,
           "source": source, "issues": issues, "parts": parts}
    quote = next((p.get("quote") for p in parts.values() if p.get("quote")), None)
    if quote:
        out["quote"] = quote
    out["needsReview"] = out["confidence"] < REVIEW_THRESHOLD or bool(issues)
    return out


def _assemble(chosen, qr, llm_norm, doc_type):
    fields = {}
    entries = {name: _entry(c) for name, c in chosen.items()}
    if "type" in entries:
        fields["type"] = entries["type"]
    else:
        fields["type"] = {"value": doc_type, "confidence": 0.5, "source": "text_layer",
                          "issues": ["document type defaulted"], "needsReview": True}
    for name in ("number", "date", "placeOfSupply", "currency", "lineCount", "mainHsn"):
        if name in entries:
            fields[name] = entries[name]
    if "poReference" in entries:
        fields["poReference"] = entries["poReference"]
        fields["externalRef"] = dict(entries["poReference"])
    for role in ("seller", "buyer"):
        parts = {}
        if f"{role}.gstin" in entries:
            parts["gstin"] = entries[f"{role}.gstin"]
        if f"{role}.name" in entries:
            parts["name"] = entries[f"{role}.name"]
            fields[f"{role}Name"] = entries[f"{role}.name"]
        if not parts:
            continue
        value = {"name": parts["name"]["value"] if "name" in parts else ""}
        if "gstin" in parts:
            gstin = parts["gstin"]["value"]
            value["gstin"] = gstin
            check = validate_gstin(gstin)
            if check["wellFormed"]:
                value["pan"] = check["panEmbedded"]
                value["stateCode"] = check["stateCode"]
        source = (parts.get("gstin") or parts.get("name"))["source"]
        # The GSTIN is the party's identity (supplier matching keys on it); the
        # printed name is reviewed separately as sellerName / buyerName.
        identity = {"gstin": parts["gstin"]} if "gstin" in parts else parts
        fields[role] = _composite(value, identity, source, () if "name" in parts else (f"{role} name not found",))
        fields[role]["parts"] = parts
    total_parts = {key: entries[f"totals.{key}"] for key in TOTAL_KEYS if f"totals.{key}" in entries}
    if total_parts:
        value = {key: part["value"] for key, part in total_parts.items()}
        missing = [key for key in ("taxable", "grand") if key not in value]
        fields["totals"] = _composite(value, total_parts, (total_parts.get("grand") or next(iter(total_parts.values())))["source"],
                                      [f"{key} not found" for key in missing])
    gst_value, gst_parts = {}, {}
    if "gst.irn" in entries:
        gst_value["irn"] = entries["gst.irn"]["value"]
        gst_parts["irn"] = entries["gst.irn"]
    if qr and qr.get("kind") == "irp_jwt":
        gst_value["signedQr"] = {"verified": bool(qr.get("verified")), "keyId": qr.get("keyId"),
                                 "fields": {k: str(v) for k, v in (qr.get("fields") or {}).items()}}
        gst_parts["signedQr"] = {"value": qr.get("signature"), "source": "einvoice_qr",
                                 "confidence": 0.99 if qr.get("verified") else 0.9 if qr.get("wellFormed") else 0.6,
                                 "issues": [] if qr.get("verified") else [qr.get("reason") or "signature not verified"]}
    if gst_value:
        fields["gst"] = _composite(gst_value, gst_parts, "einvoice_qr" if "signedQr" in gst_parts else gst_parts["irn"]["source"])
    for name in ("terms", "payment", "bankDetails"):
        if llm_norm and llm_norm.get(name):
            fields[name] = {"value": llm_norm[name], "confidence": 0.6, "source": "vision_llm",
                            "issues": ["read by the AI model only — verify against the document"], "needsReview": True}
    return fields


def _dedupe(issues):
    seen, out = set(), []
    for issue in issues:
        key = (issue["code"], issue.get("field"), issue["message"])
        if key not in seen:
            seen.add(key)
            out.append(issue)
    return out


def _method(chosen, qr, parsed):
    if parsed.get("method") == "einvoice_json":
        return "json"
    if parsed.get("method") == "csv":
        return "csv"
    critical = [chosen.get(name) for name in ("number", "date", "totals.grand", "seller.gstin")]
    sources = {entry["source"] for entry in critical if entry}
    if "einvoice_qr" in sources:
        return "einvoice_qr"
    if "vision_llm" in sources:
        return "vision_llm"
    return "text_layer"


def _qr_summary(qr):
    if not qr:
        return {"found": False, "verified": False, "signature": "absent"}
    return {k: qr.get(k) for k in ("found", "kind", "verified", "signature", "keySource", "keyId",
                                   "reason", "wellFormed", "mapped", "page") if qr.get(k) is not None}


def to_partial_document(fields, lines):
    """Fused fields -> dict valid as contracts_v2.PartialBusinessDocument."""
    def value(name):
        entry = fields.get(name)
        return entry.get("value") if isinstance(entry, dict) else None
    doc = {}
    doc_type = normalize_doc_type(value("type"))
    if doc_type:
        doc["type"] = doc_type
    if value("number"):
        doc["number"] = str(value("number"))
    if value("date") and parse_date(value("date")):
        doc["date"] = parse_date(value("date"))
    for role in ("seller", "buyer"):
        party = value(role)
        if isinstance(party, dict):
            doc[role] = {k: v for k, v in party.items() if k in ("name", "gstin", "pan", "stateCode") and v is not None}
            doc[role].setdefault("name", "")
    if value("placeOfSupply"):
        doc["placeOfSupply"] = value("placeOfSupply")
    if value("currency"):
        doc["currency"] = value("currency")
    if value("externalRef"):
        doc["externalRef"] = str(value("externalRef"))
    totals = value("totals")
    if isinstance(totals, dict) and totals.get("taxable") and totals.get("grand"):
        doc["totals"] = {key: money_str(parse_amount(totals.get(key)) or Decimal(0)) for key in TOTAL_KEYS}
    gst = value("gst")
    if isinstance(gst, dict):
        doc["gst"] = {k: v for k, v in gst.items() if k in ("irn", "signedQr")}
    if value("terms"):
        doc["terms"] = value("terms")
    if value("payment"):
        doc["payment"] = value("payment")
    doc_lines = []
    for line in lines or []:
        item = {"lineNo": int(line["lineNo"]), "description": line.get("description") or f"Line {line['lineNo']}",
                "uom": (line.get("uom") or "NOS") if (line.get("uom") or "NOS").upper() in UOMS else "NOS",
                "qty": line["qty"]}
        for key in ("hsn", "rate", "taxableValue", "gstRate"):
            if line.get(key) is not None:
                item[key] = line[key]
        doc_lines.append(item)
    if doc_lines:
        doc["lines"] = doc_lines
    return doc
