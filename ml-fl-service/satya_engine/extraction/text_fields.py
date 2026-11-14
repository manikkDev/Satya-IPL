"""Deterministic field parsing from a PDF text layer.

Works on layout text (see layout.py; columns separated by 2+ spaces, pages
by form feed) and degrades gracefully on plain pdfium text. Every candidate
carries the verbatim ``quote`` and ``page`` it came from plus a ``strength``
("label" = found next to an explicit label, "heuristic" = positional guess,
"derived" = inferred from other validated values) that fuse.py turns into a
confidence together with the business-rule validators.
"""
import itertools
import json
import re
from decimal import Decimal
from functools import lru_cache
from pathlib import Path

from ..india.gstin import validate_gstin
from .normalize import decimal_str, find_amounts, find_dates, money_str

GSTIN_RE = re.compile(r"(?<![0-9A-Z])([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])(?![0-9A-Z])")
IRN_RE = re.compile(r"(?<![0-9a-fA-F])([0-9a-fA-F]{64})(?![0-9a-fA-F])")
SEGMENT_SPLIT = re.compile(r" {2,}")
DOC_NUMBER_TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9/\-_.]{0,39}")
UOMS = {"NOS", "NO", "NOS.", "PCS", "PC", "KG", "KGS", "MTR", "MTRS", "M", "LTR", "LTRS", "L",
        "SET", "SETS", "BOX", "BOXES", "EA", "EACH", "UNIT", "UNITS", "MT", "TON", "TONS",
        "PAIR", "PAIRS", "ROLL", "ROLLS", "BAG", "BAGS", "DOZ", "SQM", "SQFT", "CFT", "HRS", "LOT"}
GST_SLABS = {"0", "0.1", "0.25", "1.5", "3", "5", "12", "18", "28", "40"}
STATES_ASSET = Path(__file__).resolve().parents[2] / "assets" / "gst_state_codes.json"

TITLE_TYPES = [
    (re.compile(r"\bcredit\s+note\b", re.I), "CREDIT_NOTE_IN"),
    (re.compile(r"\bdebit\s+note\b", re.I), "DEBIT_NOTE_IN"),
    (re.compile(r"\bpro\s*-?\s*forma\b", re.I), "PI_IN"),
    (re.compile(r"\bpurchase\s+order\b", re.I), "PO"),
    (re.compile(r"\bgoods\s+receipt\b|\bG\.?R\.?N\.?\b", re.I), "GRN"),
    (re.compile(r"\bdelivery\s+challan\b", re.I), "DELIVERY_CHALLAN"),
    (re.compile(r"\btax\s+invoice\b|\be-?invoice\b|\binvoice\b|\bbill\s+of\s+supply\b", re.I), "INVOICE_IN"),
]

NUMBER_LABELS = {
    "INVOICE_IN": [
        r"(?:tax\s+)?invoice\s*(?:no|number|num)\b\.?",
        r"inv\.?\s*(?:no|number)\b\.?",
        r"invoice\s*#",
        r"bill\s*(?:no|number)\b\.?",
        r"(?:document|doc)\.?\s*(?:no|number)\b\.?",
        r"serial\s+no\.?\s+of\s+invoice",
    ],
    "CREDIT_NOTE_IN": [r"(?:credit\s+note|c\.?\s*n\.?)\s*(?:no|number|#)\b\.?", r"(?:document|doc)\.?\s*(?:no|number)\b\.?"],
    "DEBIT_NOTE_IN": [r"(?:debit\s+note|d\.?\s*n\.?)\s*(?:no|number|#)\b\.?", r"(?:document|doc)\.?\s*(?:no|number)\b\.?"],
    "PO": [r"(?:p\.?\s*o\.?|purchase\s+order|order)\s*(?:no|number|#)\b\.?"],
    "PI_IN": [r"(?:proforma|p\.?\s*i\.?)\s*(?:invoice\s*)?(?:no|number|#)\b\.?", r"invoice\s*(?:no|number)\b\.?"],
    "GRN": [r"(?:grn|goods\s+receipt(?:\s+note)?|receipt)\s*(?:no|number|#)\b\.?"],
    "DELIVERY_CHALLAN": [r"(?:delivery\s+)?challan\s*(?:no|number|#)\b\.?", r"d\.?\s*c\.?\s*(?:no|#)\b\.?"],
}
NUMBER_NEGATIVE = re.compile(r"(?:\bp\.?\s*o\b|order|challan|e-?\s*way|ack|vehicle|\blr\b|ref|irn|pan|phone|mobile|tel|account|a/c|gstin|cin|udyam|msme)\W*$", re.I)
DATE_LABEL = re.compile(r"\bdate\s+of\s+(?:invoice|issue|bill|supply\s+invoice)\b|(?:(?:tax\s+)?invoice|inv\.?|bill|document|doc\.?|note|order|p\.?o\.?|grn|receipt|challan)?\s*(?:date|dt\.?)\b|\bdated\b", re.I)
DATE_NEGATIVE = re.compile(r"(?:due|ack(?:nowledg(?:e)?ment)?|irn|challan|delivery|supply|e-?\s*way|lr|despatch|dispatch|expiry|validity|payment|removal)\s*$", re.I)

SELLER_KEYS = re.compile(r"\b(?:supplier|seller|billed\s+by|sold\s+by|consignor|vendor|issued\s+by|from|details\s+of\s+supplier)\b", re.I)
BUYER_KEYS = re.compile(r"^to\s*[,:]?$|\b(?:buyer|bill(?:ed)?\s+to|invoice\s+to|sold\s+to|recipient|receiver|customer|consignee|ship(?:ped)?\s+to|purchaser|details\s+of\s+(?:receiver|recipient|buyer))\b", re.I)
SHIP_KEYS = re.compile(r"\b(?:ship(?:ped)?\s+to|consignee|delivery\s+address)\b", re.I)
NAME_STOP = re.compile(r"gstin|\bpan\b|state|address|vihar|nagar|estate|\barea\b|sector|phase|midc|gidc|\bshed\b|\bmarg\b|\blane\b|\d{6}|phone|mobile|tel\b|e-?mail|@|\broad\b|street|\bpin\b|pincode|floor|plot|\bno\.?\s*\d|code\s*:|invoice|date|place\s+of|\birn\b|\back\b", re.I)
NAME_HEADING = re.compile(r"^(?:supplier|buyer|recipient|receiver|details|bill(?:ed)?\s+(?:to|by)|ship(?:ped)?\s+to|consignee)\b", re.I)
COMPANY_HINT = re.compile(r"\b(?:ltd|limited|pvt|private|llp|industries|enterprises|traders|trading|corporation|corp|co\.|company|& sons|works|engineering|engineers|agencies|solutions|systems|steels?|pharma|textiles|exports|imports|manufacturing|mills|motors|electricals|chemicals|plastics|foods|logistics|technologies|tech|services|associates)\b", re.I)

TOTAL_LABELS = {
    "taxable": [(r"total\s+taxable\s+(?:value|amount|amt)", 3), (r"taxable\s+(?:value|amount|amt)", 2),
                (r"sub\s*-?\s*total", 2), (r"assessable\s+value", 2), (r"total\s+before\s+tax", 2),
                (r"amount\s+before\s+tax", 2), (r"total\s+value\s+of\s+(?:goods|supply)", 1)],
    "cgst": [(r"\bcgst\b", 2), (r"central\s+tax", 2)],
    "sgst": [(r"\bsgst\b", 2), (r"\butgst\b", 2), (r"state(?:/ut)?\s+tax", 2)],
    "igst": [(r"\bigst\b", 2), (r"integrated\s+tax", 2)],
    "cess": [(r"\bcess\b", 2)],
    "roundOff": [(r"round(?:ing|ed)?\s*-?\s*off", 3), (r"\brounding\b", 2)],
    "grand": [(r"grand\s+total", 4), (r"total\s+invoice\s+(?:value|amount)", 4), (r"invoice\s+(?:total|value)", 3),
              (r"(?:total\s+)?amount\s+payable", 3), (r"net\s+payable", 3), (r"total\s+payable", 3),
              (r"balance\s+due", 2), (r"total\s+amount", 2), (r"\btotal\b", 1)],
}
TOTAL_RES = {key: [(re.compile(pattern, re.I), weight) for pattern, weight in labels] for key, labels in TOTAL_LABELS.items()}
ANY_TOTAL_LABEL = re.compile("|".join(p for labels in TOTAL_LABELS.values() for p, _ in labels), re.I)
WORDS_LINE = re.compile(r"\b(?:in\s+words|rupees\b.*\bonly|only\s*$)", re.I)
PO_REF = re.compile(r"(?:\bp\.?\s*o\.?|purchase\s+order|buyer'?s?\s+order|\border)\s*(?:no|number|ref(?:erence)?|#)?\b\.?\s*[:#.\-]?\s*", re.I)
POS_LABEL = re.compile(r"place\s+of\s+supply", re.I)


@lru_cache(maxsize=1)
def _state_names():
    states = json.loads(STATES_ASSET.read_text())["states"]
    return {entry["name"].upper(): entry["code"] for entry in states}


class Doc:
    """Layout lines with page numbers and 2+-space separated segments."""

    def __init__(self, text):
        self.lines, self.pages = [], []
        for page_no, page in enumerate(str(text or "").split("\f"), start=1):
            for line in page.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
                self.lines.append(line.rstrip())
                self.pages.append(page_no)
        self._segments = {}

    def segments(self, index):
        if index not in self._segments:
            line, out, pos = self.lines[index], [], 0
            for part in SEGMENT_SPLIT.split(line):
                start = line.find(part, pos) if part else pos
                if part.strip():
                    lead = len(part) - len(part.lstrip())
                    out.append((part.strip(), start + lead, start + len(part)))
                pos = start + len(part)
            self._segments[index] = out
        return self._segments[index]

    def segment_at(self, index, col, tolerance=8):
        best = None
        for text, start, end in self.segments(index):
            if start - tolerance <= col <= end + tolerance or abs(start - col) <= tolerance:
                distance = abs(start - col)
                if best is None or distance < best[0]:
                    best = (distance, (text, start, end))
        return best[1] if best else None


def _cand(value, doc, index, strength, quote=None, **extra):
    return {"value": value, "page": doc.pages[index] if 0 <= index < len(doc.pages) else None,
            "line": index, "quote": (quote or doc.lines[index].strip())[:200], "strength": strength, **extra}


# --------------------------------------------------------------------------- type

TITLE_REFERENCE = re.compile(r"\s*(?:no\b|no\.|number|num\b|#|date|dt\b|ref|to\b|details)", re.I)


def detect_type(doc):
    """Earliest document title in the header; 'Purchase Order No.' on an
    invoice is a reference, not a title."""
    head = "\n".join(doc.lines[:15])
    best = None
    for rank, (pattern, doc_type) in enumerate(TITLE_TYPES):
        for match in pattern.finditer(head):
            if TITLE_REFERENCE.match(head, match.end()):
                continue
            key = (match.start(), rank)
            if best is None or key < best[0]:
                best = (key, doc_type)
            break
    if best:
        index = head[:best[0][0]].count("\n")
        return _cand(best[1], doc, index, "label")
    return None


# ------------------------------------------------------------------------- number

def _value_after(doc, index, end_col, label_col, extractor):
    """Value right after a label: same segment, next segment, or next line below."""
    line = doc.lines[index]
    rest = line[end_col:]
    rest_stripped = rest.lstrip(" :.-#\t")
    first_seg = SEGMENT_SPLIT.split(rest_stripped, maxsplit=1)[0] if rest_stripped else ""
    gap = len(rest) - len(rest.lstrip())
    if first_seg and gap < 2:
        value = extractor(first_seg)
        if value:
            return value, line.strip()
    if first_seg and gap < 30:
        value = extractor(first_seg)
        if value:
            return value, line.strip()
    for below in range(index + 1, min(index + 3, len(doc.lines))):
        segment = doc.segment_at(below, label_col, tolerance=6)
        if segment:
            value = extractor(segment[0])
            if value:
                return value, f"{line.strip()} / {segment[0]}"
            break
    return None, None


def _number_token(text):
    match = DOC_NUMBER_TOKEN.match(text.strip())
    if not match:
        return None
    token = match.group(0).rstrip(".-/")
    if not re.search(r"\d", token) or find_dates(token) and len(find_dates(token)[0][3]) >= len(token) - 1:
        return None
    if re.fullmatch(r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", token):
        return None
    return token


def find_number(doc, doc_type):
    labels = NUMBER_LABELS.get(doc_type or "INVOICE_IN", NUMBER_LABELS["INVOICE_IN"])
    for rank, label in enumerate(labels):
        pattern = re.compile(r"(?<![A-Za-z])" + label, re.I)
        for index, line in enumerate(doc.lines):
            for match in pattern.finditer(line):
                if NUMBER_NEGATIVE.search(line[:match.start()]):
                    continue
                value, quote = _value_after(doc, index, match.end(), match.start(), _number_token)
                if value:
                    return _cand(value, doc, index, "label", quote, labelRank=rank)
    return None


# --------------------------------------------------------------------------- date

def _first_date(text):
    dates = find_dates(text)
    return dates[0][0] if dates and dates[0][1] <= 3 else None


def find_date(doc, doc_type):
    best = None
    for index, line in enumerate(doc.lines):
        for match in DATE_LABEL.finditer(line):
            prefix = line[:match.start()] + match.group(0).split("date")[0].split("Date")[0]
            if DATE_NEGATIVE.search(prefix.rstrip()) or DATE_NEGATIVE.search(match.group(0).rsplit(" ", 1)[0] if " " in match.group(0).strip() else ""):
                continue
            value, quote = _value_after(doc, index, match.end(), match.start(), _first_date)
            if value:
                specific = bool(re.search(r"invoice|inv|bill|document|doc|note|order|grn|receipt|challan|dated", match.group(0), re.I))
                cand = _cand(value, doc, index, "label", quote, specific=specific)
                if specific:
                    return cand
                best = best or cand
    if best:
        return best
    for index, line in enumerate(doc.lines[:30]):
        dates = find_dates(line)
        if dates and not DATE_NEGATIVE.search(line[:dates[0][1]].rstrip(" :.-")):
            return _cand(dates[0][0], doc, index, "heuristic")
    return None


# ------------------------------------------------------------------------ parties

def _role_from_context(doc, index, col):
    """Nearest role keyword above (or before, same line) an occurrence at col."""
    same_line = doc.lines[index][:col]
    for keys, role in ((BUYER_KEYS, "buyer"), (SELLER_KEYS, "seller")):
        tail = same_line[-40:]
        if keys.search(tail) and not SEGMENT_SPLIT.search(tail[keys.search(tail).end():]):
            return role, index
    for above in range(index - 1, max(-1, index - 12), -1):
        segment = doc.segment_at(above, col, tolerance=10)
        if not segment:
            continue
        text = segment[0]
        buyer, seller = BUYER_KEYS.search(text), SELLER_KEYS.search(text)
        if buyer and (not seller or buyer.start() <= seller.start()):
            return ("ship" if SHIP_KEYS.search(text) else "buyer"), above
        if seller and not re.search(r"\bfrom\b", text, re.I) or seller and text.lower().startswith("from"):
            return "seller", above
    return None, None


def _clean_name(text):
    text = re.sub(r"^(?:supplier|seller|buyer|bill(?:ed)?\s+(?:to|by)|ship(?:ped)?\s+to|recipient|receiver|consignee|customer|sold\s+(?:to|by)|from|to|invoice\s+to|vendor|details\s+of\s+\w+)\s*(?:\(.*?\))?\s*[:\-]?\s*", "", text.strip(), flags=re.I)
    text = re.sub(r"^M/s\.?\s*", "", text, flags=re.I).strip(" :,-")
    if len(text) < 3 or len(text) > 100 or not re.search(r"[A-Za-z]{2}", text) or NAME_STOP.search(text) \
            or NAME_HEADING.match(text):
        return None
    return text


def _party_name(doc, gstin_index, col, keyword_index):
    if keyword_index is not None:
        segment = doc.segment_at(keyword_index, col, tolerance=10)
        if segment:
            name = _clean_name(segment[0])
            if name:
                return name, keyword_index
        for below in range(keyword_index + 1, gstin_index + 1):
            segment = doc.segment_at(below, col, tolerance=10)
            if segment:
                name = _clean_name(segment[0])
                if name:
                    return name, below
    fallback = None
    for above in range(gstin_index - 1, max(-1, gstin_index - 8), -1):
        segment = doc.segment_at(above, col, tolerance=10)
        if not segment:
            continue
        name = _clean_name(segment[0])
        if name and COMPANY_HINT.search(name):
            return name, above
        if name and fallback is None:
            fallback = (name, above)
    return fallback or (None, None)


def find_parties(doc):
    occurrences = []
    for index, line in enumerate(doc.lines):
        for match in GSTIN_RE.finditer(line):
            occurrences.append((index, match.start(), match.group(1)))
    assigned, seen = {}, []
    for index, col, gstin in occurrences:
        role, keyword_index = _role_from_context(doc, index, col)
        seen.append((index, col, gstin, role, keyword_index))
    for wanted in ("seller", "buyer"):
        for index, col, gstin, role, keyword_index in seen:
            if role == wanted and wanted not in assigned:
                assigned[wanted] = (index, col, gstin, keyword_index, "label")
    if "buyer" not in assigned:
        for index, col, gstin, role, keyword_index in seen:
            if role == "ship" and (not assigned.get("seller") or assigned["seller"][2] != gstin):
                assigned["buyer"] = (index, col, gstin, keyword_index, "label")
                break
    taken = {value[2] for value in assigned.values()}
    first_buyer_line = next((i for i, line in enumerate(doc.lines) if BUYER_KEYS.search(line)), len(doc.lines))
    for index, col, gstin, role, keyword_index in seen:
        if gstin in taken:
            continue
        for wanted in ("seller", "buyer"):
            if wanted not in assigned:
                # Unlabelled GSTIN in the letterhead, above any buyer block, is the
                # issuer by convention — a positional but strong signal.
                header = wanted == "seller" and index < first_buyer_line and index < 20 and role is None
                assigned[wanted] = (index, col, gstin, keyword_index, "label" if header else "heuristic")
                taken.add(gstin)
                break
    parties = {}
    for role, (index, col, gstin, keyword_index, strength) in assigned.items():
        check = validate_gstin(gstin)
        name, name_index = _party_name(doc, index, col, keyword_index)
        parties[role] = {
            "gstin": _cand(gstin, doc, index, strength, checksumValid=check["checksumValid"] and check["wellFormed"]),
            "name": _cand(name, doc, name_index, "label" if keyword_index is not None else "heuristic") if name else None,
        }
    return parties


# ------------------------------------------------------------------------- totals

def _label_hits(line):
    hits = []
    for key, patterns in TOTAL_RES.items():
        for pattern, weight in patterns:
            for match in pattern.finditer(line):
                hits.append((match.start(), match.end(), key, weight))
    hits.sort(key=lambda h: (h[0], -(h[1] - h[0]), -h[3]))
    kept, last_end = [], -1
    for hit in hits:
        if hit[0] >= last_end:
            kept.append(hit)
            last_end = hit[1]
    return kept


def total_candidates(doc, item_lines):
    out = {key: [] for key in TOTAL_LABELS}
    for index, line in enumerate(doc.lines):
        if index in item_lines or WORDS_LINE.search(line):
            continue
        hits = _label_hits(line)
        if not hits or len(hits) > 4 and not find_amounts(line):
            continue
        for position, (start, end, key, weight) in enumerate(hits):
            stop = hits[position + 1][0] if position + 1 < len(hits) else len(line)
            region = line[end:stop]
            amounts = find_amounts(region)
            if not amounts:
                continue
            value, a_start, _a_end, raw = amounts[-1]
            prefix = line[:start].lower()
            if key == "roundOff" and (re.search(r"less|\(-\)|minus", prefix + region[:a_start].lower())):
                value = -abs(value)
            if key in {"cgst", "sgst", "igst", "cess"} and re.search(r"\brate\b|%\s*$", region[:a_start].lower()) and len(amounts) == 1 and value < 100 and "." not in raw:
                continue
            out[key].append(_cand(value, doc, index, "label", weight=weight, raw=raw))
    return out


def _distinct(cands, limit):
    seen, out = set(), []
    for cand in sorted(cands, key=lambda c: (-c["weight"], -c["line"])):
        if cand["value"] in seen:
            continue
        seen.add(cand["value"])
        out.append(cand)
        if len(out) >= limit:
            break
    return out


def solve_totals(cands, lines_taxable=None):
    """Pick the label candidates whose arithmetic closes (±₹1)."""
    zero = {"value": Decimal(0), "strength": "derived", "weight": 0, "line": -1, "quote": "", "page": None}
    taxable_opts = _distinct(cands["taxable"], 4)
    if lines_taxable is not None and lines_taxable not in {c["value"] for c in taxable_opts}:
        taxable_opts.append({**zero, "value": lines_taxable, "quote": "sum of line taxable values"})
    options = {key: _distinct(cands[key], 3) + [zero] for key in ("cgst", "sgst", "igst", "cess", "roundOff")}
    grand_opts = _distinct(cands["grand"], 5)
    best, best_score = None, None
    for taxable in taxable_opts:
        for cgst, sgst, igst, cess, round_off in itertools.product(*(options[k] for k in ("cgst", "sgst", "igst", "cess", "roundOff"))):
            if (cgst["value"] > 0) != (sgst["value"] > 0):
                continue
            if igst["value"] > 0 and cgst["value"] > 0:
                continue
            parts = taxable["value"] + cgst["value"] + sgst["value"] + igst["value"] + cess["value"] + round_off["value"]
            for grand in grand_opts:
                diff = abs(parts - grand["value"])
                if diff > 1:
                    continue
                score = (sum(c["weight"] for c in (taxable, cgst, sgst, igst, cess, round_off, grand))
                         + (2 if diff <= Decimal("0.01") else 0)
                         + (1 if lines_taxable is not None and taxable["value"] == lines_taxable else 0)
                         + grand["line"] / 10000)
                if best_score is None or score > best_score:
                    best_score = score
                    best = {"taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst,
                            "cess": cess, "roundOff": round_off, "grand": grand}
    if best:
        return best, True
    picked = {}
    for key in TOTAL_LABELS:
        ranked = _distinct(cands[key], 1)
        if ranked:
            picked[key] = ranked[0]
    if "taxable" not in picked and lines_taxable is not None:
        picked["taxable"] = {**zero, "value": lines_taxable, "quote": "sum of line taxable values"}
    return picked, False


# -------------------------------------------------------------------------- lines

def _numeric_tokens(line):
    tokens = []
    for value, start, end, raw in find_amounts(line):
        tokens.append({"value": value, "start": start, "end": end, "raw": raw})
    return tokens


HEADER_COLUMNS = {
    "qty": re.compile(r"\bqty\b|\bquantity\b|\bqnty\b", re.I),
    "rate": re.compile(r"\brate\b|\bprice\b|unit\s+price|\brate/unit\b", re.I),
    "amount": re.compile(r"\bamount\b|\bamt\b|taxable\s+value|\bvalue\b|\btotal\b", re.I),
}


def _header_columns(line):
    """Column spans of qty / rate / amount headers on an items-table header line."""
    spans = {}
    for name, pattern in HEADER_COLUMNS.items():
        match = pattern.search(line)
        if match:
            spans[name] = (match.start(), match.end())
    return spans if "qty" in spans and "rate" in spans else None


def _nearest_column(token, header):
    centre = (token["start"] + token["end"]) / 2
    best = min(header.items(), key=lambda item: min(abs(token["start"] - item[1][0]), abs(token["end"] - item[1][1]),
                                                     abs(centre - (item[1][0] + item[1][1]) / 2)))
    return best[0]


def _pick_triple(nums, header=None):
    best, best_score = None, None
    for i, j, k in itertools.permutations(range(len(nums)), 3):
        qty, rate, amount = nums[i], nums[j], nums[k]
        if qty["value"] <= 0 or rate["value"] <= 0 or amount["value"] <= 0:
            continue
        if abs(qty["value"] * rate["value"] - amount["value"]) > 1:
            continue
        score = 0
        if header:
            score += 3 if _nearest_column(qty, header) == "qty" else 0
            score += 3 if _nearest_column(rate, header) == "rate" else 0
        score += 2 if "." in rate["raw"] and "." not in qty["raw"] else 0
        score += 2 if k > i and k > j else 0
        score += 1 if i < j else 0
        score += 1 if "." in amount["raw"] else 0
        score += 1 if "," not in qty["raw"] else 0
        score += 1 if len(qty["raw"].replace(",", "")) <= len(rate["raw"].replace(",", "")) else 0
        score -= 2 if qty["value"] == amount["value"] and rate["value"] != 1 else 0
        if best_score is None or score > best_score:
            best, best_score = (i, j, k), score
    return best


def find_lines(doc):
    """Line items: rows whose numbers contain a qty x rate = amount (±₹1) triple."""
    items, used, header = [], set(), None
    for index, line in enumerate(doc.lines):
        if not line.strip() or WORDS_LINE.search(line):
            continue
        spans = _header_columns(line)
        if spans and not re.search(r"\d{2,}", line):
            header = spans
            continue
        if ANY_TOTAL_LABEL.search(line) and not re.match(r"\s*\d{1,3}\s", line):
            continue
        # dates and document numbers (2025-26/ABC/0012) are not quantities
        scrubbed = line
        for _iso, start, end, _raw in find_dates(line):
            scrubbed = scrubbed[:start] + " " * (end - start) + scrubbed[end:]
        scrubbed = re.sub(r"\S*[/]\S*", lambda m: " " * len(m.group(0)), scrubbed)
        nums = _numeric_tokens(scrubbed)
        if len(nums) < 3:
            continue
        triple = _pick_triple(nums, header)
        if not triple:
            continue
        qty, rate, amount = (nums[t] for t in triple)
        rest = [n for t, n in enumerate(nums) if t not in triple]
        hsn_options = [n["raw"] for n in rest if re.fullmatch(r"\d{4,8}", n["raw"])]
        hsn = next((raw for raw in hsn_options if len(raw) in (4, 6, 8)), hsn_options[0] if hsn_options else None)
        masked = list(line)
        serial_match = re.match(r"\s*(\d{1,3})(?:[.)])?\s", line)
        consumed = [qty, rate, amount] + [n for n in rest if n["raw"] == hsn]
        consumed += [n for n in rest if n["start"] > amount["end"] or "," in n["raw"] or "." in n["raw"]]
        if serial_match:
            consumed += [n for n in nums if n["start"] == serial_match.start(1)]
        for n in consumed:
            for pos in range(n["start"], n["end"]):
                masked[pos] = " "
        text = "".join(masked)
        text = re.sub(r"\d+(?:\.\d+)?\s*%", " ", text)
        uom = None
        words = []
        for segment in SEGMENT_SPLIT.split(text.strip()):
            segment = segment.strip(" |")
            if not segment:
                continue
            if segment.upper().rstrip(".") in UOMS or segment.upper() in UOMS:
                uom = uom or segment.upper().rstrip(".")
                continue
            if re.search(r"[A-Za-z]{2}", segment):
                words.append(segment)
        if not words:
            continue
        description = max(words, key=len)
        serial = re.match(r"\s*(\d{1,3})(?:[.)])?\s", line)
        rates = [Decimal(m.group(1)) for m in re.finditer(r"(\d+(?:\.\d+)?)\s*%", line)]
        gst_rate = None
        if len(rates) == 1:
            gst_rate = rates[0]
        elif len(rates) == 2 and rates[0] == rates[1]:
            gst_rate = rates[0] * 2
        line_no = int(serial.group(1)) if serial and int(serial.group(1)) == len(items) + 1 else len(items) + 1
        item = {"lineNo": line_no, "description": description[:500], "qty": decimal_str(qty["value"]),
                "rate": decimal_str(rate["value"]), "taxableValue": money_str(amount["value"]),
                "page": doc.pages[index], "quote": line.strip()[:240], "_line": index}
        if hsn:
            item["hsn"] = hsn
        if uom:
            item["uom"] = uom
        if gst_rate is not None and decimal_str(gst_rate) in GST_SLABS:
            item["gstRate"] = decimal_str(gst_rate)
        items.append(item)
        used.add(index)
    return items, used


# -------------------------------------------------------------------------- other

def find_irn(doc):
    for index, line in enumerate(doc.lines):
        match = IRN_RE.search(line)
        if match:
            strength = "label" if re.search(r"\birn\b", line, re.I) else "heuristic"
            return _cand(match.group(1).lower(), doc, index, strength)
    # IRN wrapped over two lines ("IRN: 3f9c...\n...a1")
    for index, line in enumerate(doc.lines[:-1]):
        match = re.search(r"\bIRN\b\s*[:.]?\s*([0-9a-fA-F]{20,63})\s*$", line)
        if match:
            nxt = re.match(r"\s*([0-9a-fA-F]+)", doc.lines[index + 1])
            compact = match.group(1) + (nxt.group(1) if nxt else "")
            if re.fullmatch(r"[0-9a-fA-F]{64}", compact):
                return _cand(compact.lower(), doc, index, "heuristic")
    return None


def find_po_reference(doc, doc_type):
    if doc_type == "PO":
        return None
    for index, line in enumerate(doc.lines):
        for match in PO_REF.finditer(line):
            if not re.search(r"\b(?:no|number|ref|#)", match.group(0), re.I):
                continue
            value, quote = _value_after(doc, index, match.end(), match.start(), _number_token)
            if value:
                return _cand(value, doc, index, "label", quote)
    return None


def find_place_of_supply(doc):
    names = _state_names()
    for index, line in enumerate(doc.lines):
        match = POS_LABEL.search(line)
        if not match:
            continue
        rest = line[match.end():match.end() + 60]
        code = re.search(r"(?<!\d)(\d{2})(?!\d)", rest)
        if code:
            return _cand(code.group(1), doc, index, "label")
        upper = rest.upper()
        for name, state_code in names.items():
            if name in upper:
                return _cand(state_code, doc, index, "label")
    return None


def find_currency(doc):
    for index, line in enumerate(doc.lines):
        if re.search(r"₹|\bINR\b|\bRs\.?(?=\s|\d)|\brupees\b", line, re.I):
            return _cand("INR", doc, index, "label")
    return None


def parse_text(text, doc_type_hint=None):
    """All deterministic candidates from one document's (layout) text."""
    doc = Doc(text)
    if not any(line.strip() for line in doc.lines):
        return {"empty": True}
    doc_type = detect_type(doc)
    resolved_type = doc_type["value"] if doc_type else (doc_type_hint or "INVOICE_IN")
    lines, item_lines = find_lines(doc)
    lines_taxable = sum((Decimal(line["taxableValue"]) for line in lines), Decimal(0)) if lines else None
    totals, closes = solve_totals(total_candidates(doc, item_lines), lines_taxable)
    return {
        "empty": False,
        "type": doc_type,
        "number": find_number(doc, resolved_type),
        "date": find_date(doc, resolved_type),
        "parties": find_parties(doc),
        "totals": totals,
        "totalsClose": closes,
        "taxLabelsSeen": any(re.search(r"\b(?:cgst|sgst|igst|utgst)\b|central\s+tax|state\s+tax|integrated\s+tax", line, re.I)
                             for line in doc.lines),
        "linesTaxable": lines_taxable,
        "lines": lines,
        "irn": find_irn(doc),
        "poReference": find_po_reference(doc, resolved_type),
        "placeOfSupply": find_place_of_supply(doc),
        "currency": find_currency(doc),
    }
