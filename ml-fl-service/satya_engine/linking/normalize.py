"""Normalisation for Indian P2P identifiers, names and free text.

Invoice/PO numbers: strip separators, financial-year fragments ("26-27",
"2026-27", "/24-25"), common prefixes (INV, PO, BILL, TI, GST...), leading
zeros, and fold OCR confusions (O->0, I/L->1, S->5, B->8, Z->2) so that
"SIS/26-27/0067", "sis 67" and "SIS-26-27-OO67" compare equal on the core.

Supplier names: NFKC, Devanagari->Latin transliteration (rule-based, lossy but
deterministic), honorific/legal-form removal (M/s, Shri/Shree/Sri, Pvt Ltd,
LLP...), common Indian spelling variants (engg/engineering, inds/industries).
"""
import re
import unicodedata

from rapidfuzz import fuzz

PREFIXES = ("invoice", "inv", "bill", "tinv", "ti", "gst", "taxinv", "po", "pur", "purchase",
            "order", "grn", "mrn", "gr", "dc", "pv", "pmt", "pay")
FY_RE = re.compile(r"(?<!\d)(?:20)?(\d{2})\s*[-/]\s*(?:20)?(\d{2})(?!\d)")
OCR_FOLD = str.maketrans({"o": "0", "i": "1", "l": "1", "s": "5", "b": "8", "z": "2", "g": "6", "q": "0"})
NON_ALNUM = re.compile(r"[^a-z0-9]+")

# Minimal Devanagari -> Latin map (vowel signs dropped, consonants with inherent
# 'a'). Good enough to make "शक्ति इंडस्ट्रीज" collide with "Shakti Industries"
# after phonetic folding; IndicXlit would be the production upgrade.
_DEV = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ट": "t",
    "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h", "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
    "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ं": "n", "ँ": "n", "्": "", "ः": "h", "़": "",
    "ृ": "ri", "ॉ": "o",
}
LEGAL = re.compile(
    r"\b(m\s*/\s*s|messrs|shri|shree|sri|sree|pvt|private|ltd|limited|llp|inc|co|company|corp|"
    r"corporation|and|the|opc|plc|india|bharat)\b")
VARIANTS = [
    (re.compile(r"\bengg\b|\bengineer(?:s|ing)?\b|\beng\b"), "engineering"),
    (re.compile(r"\binds?\b|\bindustry\b|\bindustrial\b"), "industries"),
    (re.compile(r"\btrdrs?\b|\btrading\b|\btrader\b"), "traders"),
    (re.compile(r"\bentp?s?\b|\benterprise\b"), "enterprises"),
    (re.compile(r"\bmfg\b|\bmanufacturers?\b|\bmanufacturing\b"), "manufacturing"),
    (re.compile(r"\bsupp?l(?:ie)?rs?\b|\bsuppl(?:y|ies)\b"), "suppliers"),
    (re.compile(r"\bequip(?:ment)?s?\b"), "equipments"),
    (re.compile(r"\bsons?\b"), "sons"),
]


def transliterate(text):
    return "".join(_DEV.get(ch, ch) for ch in text)


def phonetic(text):
    """Fold romanisation variance: sh/s, aa/a, ee/i, oo/u, w/v, ph/f, z/j."""
    text = text.replace("sh", "s").replace("aa", "a").replace("ee", "i").replace("oo", "u")
    text = text.replace("w", "v").replace("ph", "f").replace("z", "j").replace("ck", "k")
    return re.sub(r"(.)\1+", r"\1", text)


def norm_name(name):
    text = unicodedata.normalize("NFKC", str(name or "")).lower()
    text = transliterate(text).replace("&", " and ")
    text = NON_ALNUM.sub(" ", text)
    for pattern, repl in VARIANTS:
        text = pattern.sub(repl, text)
    text = LEGAL.sub(" ", text)
    return " ".join(text.split())


def name_key(name):
    return phonetic(norm_name(name).replace(" ", ""))


def name_similarity(a, b):
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    pa, pb = phonetic(na), phonetic(nb)
    return max(fuzz.token_sort_ratio(na, nb), fuzz.token_set_ratio(pa, pb) * 0.97) / 100


def compact(number):
    return NON_ALNUM.sub("", str(number or "").lower())


def _numeric_token(token):
    numeric_share = sum(ch.isdigit() for ch in token) / len(token)
    if numeric_share >= 0.5:  # OCR confusions live in the numeric parts
        token = token.translate(OCR_FOLD)
    if token.isdigit():
        token = token.lstrip("0") or "0"
    return token


def core_number(number):
    """Core of a document number: no FY fragment, prefix or zero padding; OCR
    confusions folded inside numeric tokens."""
    text = str(number or "").lower()
    text = FY_RE.sub(" ", text)
    tokens = [t for t in NON_ALNUM.split(text) if t and t not in PREFIXES]
    tokens = [_numeric_token(t) for t in tokens]
    joined = "".join(tokens)
    for prefix in PREFIXES:
        if joined.startswith(prefix) and len(joined) > len(prefix) + 2 and joined[len(prefix)].isdigit():
            joined = joined[len(prefix):]
            break
    return joined


def digits(number):
    return re.sub(r"\D", "", core_number(number))


def number_similarity(a, b):
    """0..1 similarity of two document numbers after normalisation."""
    ca, cb = core_number(a), core_number(b)
    if not ca or not cb:
        return 0.0
    if ca == cb:
        return 1.0
    da, db = digits(a), digits(b)
    digit_match = 0.0
    if da and db and len(da) >= 2 and len(db) >= 2:
        if da == db:
            digit_match = 0.92
        elif da.endswith(db) or db.endswith(da):
            digit_match = 0.85
    return max(digit_match, fuzz.ratio(ca, cb) / 100 * 0.9)


def text_mentions(text, number):
    """Best similarity of `number` against reference-like tokens in `text`.

    Used for: invoice printed PO reference, payment narration naming invoices.
    """
    if not text or not number:
        return 0.0
    core = core_number(number)
    if len(core) < 2:
        return 0.0
    raw = str(text).lower()
    candidates = set(re.split(r"[\s,;|]+", raw)) | {raw}
    best = 0.0
    for token in candidates:
        if not token or len(token) > 60:
            continue
        best = max(best, number_similarity(token, number))
        if best >= 1.0:
            break
    # number embedded inside a longer narration token (NEFT-...-INV0067-...)
    if best < 0.9 and len(core) >= 3 and core in raw.translate(OCR_FOLD).replace("/", "").replace("-", ""):
        best = max(best, 0.9)
    return best


TOKEN_RE = re.compile(r"[a-z0-9]+")
STOP = {"of", "and", "the", "for", "with", "to", "in", "nos", "no", "pcs", "set", "ea", "x", "mm", "type"}


def tokens(text):
    return [t for t in TOKEN_RE.findall(unicodedata.normalize("NFKC", str(text or "")).lower()) if t not in STOP]


def desc_similarity(a, b):
    if not a or not b:
        return 0.0
    return fuzz.token_set_ratio(" ".join(tokens(a)), " ".join(tokens(b))) / 100
