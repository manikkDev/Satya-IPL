"""Value normalisers shared by the text parser, QR mapper and LLM adapter.

Money is always Decimal internally and a plain decimal string ("330855.00")
on the wire — never float.
"""
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = r"(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?"

DATE_PATTERNS = [
    ("ymd", re.compile(r"(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)")),
    ("dmy", re.compile(r"(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?![\d/\-.]?\d)(?![A-Za-z])")),
    ("dMy", re.compile(r"(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*" + _MONTH_RE + r"[\s\-/.,']*(\d{4}|\d{2})(?![0-9A-Za-z])", re.I)),
    ("Mdy", re.compile(_MONTH_RE + r"\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)", re.I)),
]

# Indian grouping (3,30,855.00), western grouping (330,855.00) or plain.
AMOUNT_RE = re.compile(
    r"(?<![\w.,/])(?<!\w-)(\(?-?\s?)(\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,4})?(\)?)(?![\w%/]|\.\d|,\d|-\d)"
)
PERCENT_RE = re.compile(r"\d+(?:\.\d+)?\s*%")
CURRENCY_RE = re.compile(r"(?:₹|\bRs\.?|\bINR\b)\s*", re.I)

DOC_TYPES = {
    "PR", "RFQ", "QUOTATION", "PI_IN", "PI_OUT", "PO", "PO_AMENDMENT", "PO_ACK",
    "RELEASE_ORDER", "INVOICE_IN", "INVOICE_OUT", "CREDIT_NOTE_IN", "DEBIT_NOTE_OUT",
    "CREDIT_NOTE_OUT", "DEBIT_NOTE_IN", "DELIVERY_CHALLAN", "EWAY_BILL", "LR",
    "GRN", "QC", "RETURN", "PAYMENT_OUT", "PAYMENT_IN", "ADVANCE_OUT",
    "REMITTANCE_ADVICE", "TDS_ENTRY", "GSTR2B_ENTRY", "IMS_ACTION", "BANK_LINE",
    "SUPPLIER_STATEMENT_LINE",
}
TYPE_ALIASES = {
    "invoice": "INVOICE_IN", "tax_invoice": "INVOICE_IN", "inv": "INVOICE_IN",
    "bill": "INVOICE_IN", "bill_of_supply": "INVOICE_IN",
    "credit_note": "CREDIT_NOTE_IN", "crn": "CREDIT_NOTE_IN",
    "debit_note": "DEBIT_NOTE_IN", "dbn": "DEBIT_NOTE_IN",
    "purchase_order": "PO", "po": "PO", "pi": "PI_IN", "proforma": "PI_IN",
    "proforma_invoice": "PI_IN", "grn": "GRN", "goods_receipt": "GRN",
    "challan": "DELIVERY_CHALLAN", "delivery_challan": "DELIVERY_CHALLAN",
    "eway_bill": "EWAY_BILL", "bank_statement": "BANK_LINE",
}
CENT = Decimal("0.01")


def parse_amount(raw):
    """'Rs. 3,30,855.00' -> Decimal('330855.00'); '(-) 0.35' -> Decimal('-0.35')."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, Decimal)):
        return Decimal(raw)
    if isinstance(raw, float):
        return Decimal(str(raw))
    text = str(raw).strip()
    if not text:
        return None
    negative = bool(re.search(r"\(\s*-\s*\)|^\s*-|^\(.*\)$|\bless\b|\bcr\b", text, re.I))
    text = CURRENCY_RE.sub("", text)
    text = re.sub(r"\(\s*-\s*\)|/-$|\bonly\b|\bcr\b|\bdr\b|\bless\b", "", text, flags=re.I)
    text = text.replace(" ", "").strip("()").lstrip("-+:")
    if not re.fullmatch(r"\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+", text):
        return None
    try:
        value = Decimal(text.replace(",", ""))
    except InvalidOperation:
        return None
    return -value if negative and value != 0 else value


def money_str(value, places=CENT):
    if value is None:
        return None
    quantized = Decimal(value).quantize(places, rounding=ROUND_HALF_UP)
    if quantized == 0:
        quantized = abs(quantized)
    return format(quantized, "f")


def decimal_str(value):
    """Plain decimal string without exponent or redundant trailing zeros."""
    if value is None:
        return None
    value = Decimal(value)
    if value == value.to_integral_value():
        return format(value.quantize(Decimal(1)), "f")
    return format(value.normalize(), "f")


def _year(raw):
    year = int(raw)
    return year + 2000 if year < 100 else year


def _make_date(year, month, day):
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def find_dates(text):
    """All (iso, start, end, matched) date occurrences in text, in order."""
    found = []
    for kind, pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            groups = match.groups()
            if kind == "ymd":
                iso = _make_date(int(groups[0]), int(groups[1]), int(groups[2]))
            elif kind == "dmy":
                iso = _make_date(_year(groups[2]), int(groups[1]), int(groups[0]))
            elif kind == "dMy":
                iso = _make_date(_year(groups[2]), MONTHS[groups[1].lower()], int(groups[0]))
            else:
                iso = _make_date(int(groups[2]), MONTHS[groups[0].lower()], int(groups[1]))
            if iso:
                found.append((iso, match.start(), match.end(), match.group(0)))
    found.sort(key=lambda item: (item[1], -(item[2] - item[1])))
    deduped, last_end = [], -1
    for item in found:
        if item[1] >= last_end:
            deduped.append(item)
            last_end = item[2]
    return deduped


def parse_date(raw):
    """Printed date in common Indian formats -> 'YYYY-MM-DD' (day-first)."""
    if raw is None:
        return None
    text = str(raw).strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return _make_date(int(text[:4]), int(text[5:7]), int(text[8:10]))
    dates = find_dates(text)
    return dates[0][0] if dates else None


def find_amounts(text):
    """Amount tokens (Decimal, start, end, raw) with percentages removed."""
    masked = PERCENT_RE.sub(lambda m: " " * len(m.group(0)), text)
    out = []
    for match in AMOUNT_RE.finditer(masked):
        raw = match.group(0)
        value = parse_amount(raw.replace("(", "").replace(")", "") if not raw.strip().startswith("(-") else raw)
        if value is None:
            continue
        prefix = masked[max(0, match.start() - 4):match.start()]
        if "(-)" in prefix or re.search(r"-\s*$", prefix) and not re.search(r"\w-\s*$", prefix):
            value = -abs(value)
        out.append((value, match.start(), match.end(), raw.strip()))
    return out


def normalize_doc_type(raw, default=None):
    if raw is None:
        return default
    text = str(raw).strip()
    if text.upper() in DOC_TYPES:
        return text.upper()
    key = re.sub(r"[^a-z]+", "_", text.lower()).strip("_")
    if key in TYPE_ALIASES:
        return TYPE_ALIASES[key]
    if key.upper() in DOC_TYPES:
        return key.upper()
    return default
