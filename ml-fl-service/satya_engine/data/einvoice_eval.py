"""Synthetic GST invoice eval set + field-level extraction evaluation.

    python -m satya_engine.data.einvoice_eval generate   # PDFs + ground truth
    python -m satya_engine.data.einvoice_eval evaluate   # models/extraction/evaluation.json
    python -m satya_engine.data.einvoice_eval all

Offline only: reportlab/qrcode are imported lazily here and never by runtime
code. Everything is seeded (random.Random + a deterministic RSA test key +
reportlab invariant mode), so the PDFs and the report are reproducible.

The e-invoice QRs are signed with a locally generated *test* RSA key, NOT an
NIC/IRP key, so the default evaluation honestly reports their signatures as
"not_verified". A separate pass hands the test public key to the decoder
explicitly (``extra_keys``, test-only; the HTTP API never accepts keys) to
show the verification path itself works.
"""
import argparse
import hashlib
import io
import json
import random
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from ..india.gstin import make_fictional_gstin

ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = ROOT / "data" / "eval" / "extraction"
PDF_DIR = EVAL_DIR / "pdf"
TRUTH_PATH = EVAL_DIR / "ground_truth.json"
TEST_KEY_PATH = EVAL_DIR / "test_qr_public_key.pem"
REPORT_PATH = ROOT / "models" / "extraction" / "evaluation.json"
SEED = 20261114
N_DOCS = 40
CENT = Decimal("0.01")
TEMPLATES = ("classic", "boxed", "einvoice_compact", "letterhead")
STATES = {"27": "MAHARASHTRA", "29": "KARNATAKA", "24": "GUJARAT", "33": "TAMIL NADU",
          "07": "DELHI", "09": "UTTAR PRADESH", "06": "HARYANA", "19": "WEST BENGAL"}
CITIES = {"27": ["Pune", "Mumbai", "Nashik"], "29": ["Bengaluru", "Mysuru"], "24": ["Ahmedabad", "Rajkot"],
          "33": ["Chennai", "Coimbatore"], "07": ["New Delhi"], "09": ["Noida", "Lucknow"],
          "06": ["Gurugram", "Faridabad"], "19": ["Kolkata", "Howrah"]}
SELLER_NAMES = ["Shree Ganesh Industries Pvt Ltd", "Meridian Pumps LLP", "Kaveri Steel Traders",
                "Sai Krupa Enterprises", "Bharat Electricals Pvt Ltd", "Narmada Plastics Ltd",
                "Deccan Engineering Works", "Om Sai Agencies", "Vardhman Textiles Limited",
                "Precision Valves India Pvt Ltd", "Annapurna Packaging Co.", "Raghav Chemicals LLP"]
BUYER_NAMES = ["Acme Auto Components Pvt Ltd", "Satya Demo Manufacturing Ltd", "Lotus Infra Projects LLP",
               "Bluewater Foods Pvt Ltd", "Everest Motors Limited", "Sunrise Pharma Pvt Ltd"]
STREETS = ["Plot 14, MIDC Bhosari", "Unit 3, Peenya Industrial Area", "12/A GIDC Estate",
           "45 Ambattur Ind. Estate", "B-22 Okhla Phase II", "Sector 63", "Shed 7, Udyog Vihar"]
ITEMS = [("Centrifugal Pump 5HP", "84137010", "NOS", "18"), ("Ball Valve 2 inch SS304", "84818030", "NOS", "18"),
         ("MS Angle 50x50x6", "72162100", "KGS", "18"), ("Copper Wire 2.5 sqmm", "85444999", "MTR", "18"),
         ("HDPE Granules", "39012000", "KGS", "18"), ("Corrugated Box 5 ply", "48191010", "NOS", "12"),
         ("Hydraulic Oil 68", "27101980", "LTR", "18"), ("Bearing 6205 ZZ", "84821011", "NOS", "18"),
         ("Cotton Fabric 60s", "52083190", "MTR", "5"), ("PVC Pipe 4 inch", "39172390", "NOS", "18"),
         ("Industrial Gloves", "40151900", "PAIR", "12"), ("Annual Maintenance Service", "998719", "NOS", "18"),
         ("Packing Material", "39232990", "KGS", "18"), ("LED Panel Light 18W", "94054090", "NOS", "12"),
         ("Diesel Generator Spares", "84099990", "SET", "28"), ("Rice (branded) 25kg", "10063020", "BAGS", "5")]
NUMBER_STYLES = ["{p}/{fy}/{n:04d}", "INV-{y}-{n:05d}", "GST/{fy}/{n}", "TI/{fyc}/{n:04d}",
                 "{st}/INV/{n:04d}", "{fyl}/{p}/{n:03d}", "{n:07d}"]
DATE_STYLES = ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d-%b-%y", "%Y-%m-%d", "%d-%b-%Y"]
AMOUNT_STYLES = ["indian", "indian", "indian", "western", "plain"]
CURRENCY_PREFIX = ["", "", "Rs. ", "INR "]
CRITICAL_FIELDS = ["number", "date", "seller.gstin", "buyer.gstin", "taxable", "cgst", "sgst", "igst", "grand"]


# ---------------------------------------------------------------- formatting

def indian_group(value):
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{sign}{whole}.{frac}"


def fmt_amount(value, style, prefix=""):
    if style == "indian":
        text = indian_group(value)
    elif style == "western":
        text = f"{value:,.2f}"
    else:
        text = f"{value:.2f}"
    return f"{prefix}{text}"


def fmt_qty(value):
    return format(value.normalize(), "f") if value != value.to_integral_value() else str(int(value))


ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
        "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _words_below_100(n):
    return ONES[n] if n < 20 else (TENS[n // 10] + (" " + ONES[n % 10] if n % 10 else ""))


def _words(n):
    parts = []
    for size, name in ((10 ** 7, "Crore"), (10 ** 5, "Lakh"), (1000, "Thousand"), (100, "Hundred")):
        if n >= size:
            parts.append(f"{_words(n // size) if size > 100 else _words_below_100(n // size)} {name}")
            n %= size
    if n:
        parts.append(_words_below_100(n))
    return " ".join(parts) or "Zero"


def amount_words(value):
    rupees = int(value)
    paise = int((value - rupees) * 100)
    return f"Rupees {_words(rupees)}" + (f" and {_words_below_100(paise)} Paise" if paise else "") + " Only"


# ------------------------------------------------------- deterministic test key

def _is_probable_prime(n, rng, rounds=40):
    if n < 4:
        return n in (2, 3)
    for small in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37):
        if n % small == 0:
            return n == small
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        a = rng.randrange(2, n - 2)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(rng, bits):
    while True:
        candidate = rng.getrandbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if _is_probable_prime(candidate, rng) and (candidate - 1) % 65537 != 0:
            return candidate


def eval_signing_key(seed=SEED):
    """Deterministic 2048-bit RSA key for the synthetic QRs (NOT an NIC key)."""
    from cryptography.hazmat.primitives.asymmetric import rsa

    rng = random.Random(f"satya-eval-test-key-{seed}")
    e = 65537
    while True:
        p, q = _prime(rng, 1024), _prime(rng, 1024)
        if p != q:
            break
    n, phi = p * q, (p - 1) * (q - 1)
    d = pow(e, -1, phi)
    numbers = rsa.RSAPrivateNumbers(p=p, q=q, d=d, dmp1=rsa.rsa_crt_dmp1(d, p), dmq1=rsa.rsa_crt_dmq1(d, q),
                                    iqmp=rsa.rsa_crt_iqmp(p, q), public_numbers=rsa.RSAPublicNumbers(e, n))
    return numbers.private_key()


def _b64(raw):
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def signed_qr_token(key, data, as_string=True):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    header = _b64(json.dumps({"alg": "RS256", "kid": "SATYA-EVAL-TEST-KEY", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = {"data": json.dumps(data, separators=(",", ":")) if as_string else data,
               "iss": "SATYA-EVAL synthetic (not NIC)"}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = key.sign(f"{header}.{body}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{header}.{body}.{_b64(signature)}"


# ---------------------------------------------------------------- invoices

def _pan_stub(rng, name, entity):
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    return (rng.choice(letters) + rng.choice(letters) + rng.choice(letters) + entity + name[0].upper()
            + f"{rng.randrange(1000, 9999)}" + rng.choice(letters))


def _party(rng, name, state):
    entity = "C" if any(w in name for w in ("Ltd", "Limited")) else "F" if "LLP" in name or "Co." in name else rng.choice("CFP")
    gstin = make_fictional_gstin(state, _pan_stub(rng, name, entity))
    city = rng.choice(CITIES[state])
    return {"name": name, "gstin": gstin, "stateCode": state, "stateName": STATES[state],
            "address": [rng.choice(STREETS), f"{city} - {rng.randrange(110001, 699999)}"]}


def _fy(day):
    start = day.year if day.month >= 4 else day.year - 1
    return start, start + 1


def build_invoice(rng, index):
    template = TEMPLATES[index % len(TEMPLATES)]
    seller_state = rng.choice(list(STATES))
    intra = rng.random() < 0.5
    buyer_state = seller_state if intra else rng.choice([s for s in STATES if s != seller_state])
    seller = _party(rng, rng.choice(SELLER_NAMES), seller_state)
    buyer = _party(rng, rng.choice(BUYER_NAMES), buyer_state)
    day = date(2025, 4, 1) + timedelta(days=rng.randrange(0, 560))
    fy_start, fy_end = _fy(day)
    style = NUMBER_STYLES[index % len(NUMBER_STYLES)]
    prefix = "".join(w[0] for w in seller["name"].split()[:3]).upper()
    number = style.format(p=prefix, fy=f"{fy_start % 100:02d}-{fy_end % 100:02d}", fyc=f"{fy_start % 100:02d}{fy_end % 100:02d}",
                          fyl=f"{fy_start}-{fy_end % 100:02d}", y=day.year, st=seller_state, n=rng.randrange(1, 9999))
    two_page = index % 9 == 4
    n_lines = rng.randrange(3, 7) if two_page else rng.randrange(1, 7)
    items = rng.sample(ITEMS, n_lines)
    lines = []
    for line_no, (desc, hsn, uom, gst_rate) in enumerate(items, start=1):
        if uom in ("KGS", "MTR", "LTR") and rng.random() < 0.5:
            qty = Decimal(rng.randrange(5, 4000)) / Decimal(rng.choice([1, 2, 4, 10]))
        else:
            qty = Decimal(rng.randrange(1, 250))
        rate = (Decimal(rng.randrange(800, 9_000_000)) / 100).quantize(CENT)
        if rng.random() < 0.3:
            rate = rate.to_integral_value()
        amount = (qty * rate).quantize(CENT, ROUND_HALF_UP)
        pct = Decimal(gst_rate)
        if intra:
            half = (amount * pct / 200).quantize(CENT, ROUND_HALF_UP)
            cgst, sgst, igst = half, half, Decimal(0)
        else:
            cgst, sgst, igst = Decimal(0), Decimal(0), (amount * pct / 100).quantize(CENT, ROUND_HALF_UP)
        lines.append({"lineNo": line_no, "description": desc, "hsn": hsn, "uom": uom, "qty": qty, "rate": rate,
                      "amount": amount, "gstRate": gst_rate, "cgst": cgst, "sgst": sgst, "igst": igst})
    taxable = sum((l["amount"] for l in lines), Decimal(0))
    cgst = sum((l["cgst"] for l in lines), Decimal(0))
    sgst = sum((l["sgst"] for l in lines), Decimal(0))
    igst = sum((l["igst"] for l in lines), Decimal(0))
    exact = taxable + cgst + sgst + igst
    rounded = rng.random() < 0.75
    grand = exact.quantize(Decimal(1), ROUND_HALF_UP) if rounded else exact
    round_off = (grand - exact).quantize(CENT)
    # each template gets QRs on half of its documents
    has_qr = (index % 4 in (0, 1)) if (index // 4) % 2 == 0 else (index % 4 in (2, 3))
    irn = hashlib.sha256(f"{seller['gstin']}{fy_start}-{fy_end % 100:02d}INV{number}".encode()).hexdigest() if has_qr else None
    return {
        "id": f"inv_{index + 1:02d}", "template": template, "twoPage": two_page, "hasQr": has_qr,
        "intra": intra, "seller": seller, "buyer": buyer, "number": number, "date": day,
        "dateStyle": DATE_STYLES[(index * 3) % len(DATE_STYLES)],
        "amountStyle": AMOUNT_STYLES[index % len(AMOUNT_STYLES)],
        "currencyPrefix": CURRENCY_PREFIX[(index // 2) % len(CURRENCY_PREFIX)],
        "poReference": f"PO-{rng.randrange(1000, 9999)}" if rng.random() < 0.5 else None,
        "lines": lines, "irn": irn, "ackNo": str(rng.randrange(10 ** 14, 10 ** 15)) if has_qr else None,
        "qrDataAsString": index % 10 != 6,
        "totals": {"taxable": taxable, "cgst": cgst, "sgst": sgst, "igst": igst, "cess": Decimal(0),
                   "roundOff": round_off, "grand": grand},
    }


def ground_truth(inv):
    t = inv["totals"]
    return {
        "id": inv["id"], "file": f"pdf/{inv['id']}.pdf", "template": inv["template"], "twoPage": inv["twoPage"],
        "hasQr": inv["hasQr"], "supplyType": "intra" if inv["intra"] else "inter",
        "number": inv["number"], "date": inv["date"].isoformat(), "printedDate": inv["date"].strftime(inv["dateStyle"]),
        "seller": {k: inv["seller"][k] for k in ("name", "gstin", "stateCode")},
        "buyer": {k: inv["buyer"][k] for k in ("name", "gstin", "stateCode")},
        "poReference": inv["poReference"], "irn": inv["irn"],
        "totals": {k: f"{v:.2f}" for k, v in t.items()},
        "lineCount": len(inv["lines"]),
        "lines": [{"lineNo": l["lineNo"], "description": l["description"], "hsn": l["hsn"], "uom": l["uom"],
                   "qty": fmt_qty(l["qty"]), "rate": f"{l['rate']:.2f}", "amount": f"{l['amount']:.2f}",
                   "gstRate": l["gstRate"]} for l in inv["lines"]],
    }


def qr_data(inv):
    main = max(inv["lines"], key=lambda l: l["amount"])
    return {"SellerGstin": inv["seller"]["gstin"], "BuyerGstin": inv["buyer"]["gstin"], "DocNo": inv["number"],
            "DocTyp": "INV", "DocDt": inv["date"].strftime("%d/%m/%Y"), "TotInvVal": float(inv["totals"]["grand"]),
            "ItemCnt": len(inv["lines"]), "MainHsnCode": main["hsn"], "Irn": inv["irn"],
            "IrnDt": f"{inv['date'].isoformat()} 1{inv['lines'][0]['lineNo']}:2{len(inv['lines'])}:00"}


# ------------------------------------------------------------------ drawing

class Pen:
    def __init__(self, canvas):
        self.c = canvas

    def text(self, x, y, value, size=8.5, bold=False, right=False):
        self.c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        (self.c.drawRightString if right else self.c.drawString)(x, y, value)

    def rule(self, x1, y1, x2, y2):
        self.c.setLineWidth(0.5)
        self.c.line(x1, y1, x2, y2)


def _qr_image(token):
    import qrcode
    from reportlab.lib.utils import ImageReader

    image = qrcode.make(token, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=3, border=2)
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    buffer.seek(0)
    return ImageReader(buffer)


def _money(inv, value, prefix=True):
    return fmt_amount(value, inv["amountStyle"], inv["currencyPrefix"] if prefix else "")


def _tax_label(inv, kind, style):
    rates = {l["gstRate"] for l in inv["lines"]}
    rate = Decimal(next(iter(rates))) if len(rates) == 1 else None
    if kind == "igst":
        name = {"classic": "IGST", "boxed": "Add: IGST", "einvoice_compact": "Integrated Tax", "letterhead": "Output IGST"}[style]
        return f"{name} @ {fmt_qty(rate)}%" if rate is not None and style != "einvoice_compact" else name
    name = {"classic": {"cgst": "CGST", "sgst": "SGST"}, "boxed": {"cgst": "Add: CGST", "sgst": "Add: SGST"},
            "einvoice_compact": {"cgst": "Central Tax", "sgst": "State Tax"},
            "letterhead": {"cgst": "Output CGST", "sgst": "Output SGST"}}[style][kind]
    return f"{name} @ {fmt_qty(rate / 2)}%" if rate is not None and style != "einvoice_compact" else name


def _items_columns(style):
    if style == "classic":
        return [("Sl", 40, False), ("Description of Goods", 62, False), ("HSN/SAC", 245, False), ("Qty", 330, True),
                ("Unit", 340, False), ("Rate", 450, True), ("Amount", 555, True)]
    if style == "boxed":
        return [("S.No", 40, False), ("Item Description", 70, False), ("HSN", 230, False), ("Rate", 345, True),
                ("Qty", 395, True), ("UOM", 405, False), ("Taxable Value", 515, True), ("GST %", 555, True)]
    if style == "letterhead":
        return [("Sl No.", 40, False), ("Particulars", 75, False), ("HSN Code", 250, False), ("Quantity", 350, True),
                ("Price", 440, True), ("Per", 448, False), ("Value", 555, True)]
    return [("#", 40, False), ("HSN", 55, False), ("Description", 110, False), ("Qty", 330, True),
            ("Rate", 420, True), ("Amount", 500, True), ("Tax%", 555, True)]


def _item_cells(inv, line, style):
    qty, rate, amount = fmt_qty(line["qty"]), _money(inv, line["rate"], False), _money(inv, line["amount"], False)
    if style == "classic":
        return [str(line["lineNo"]), line["description"], line["hsn"], qty, line["uom"], rate, amount]
    if style == "boxed":
        return [str(line["lineNo"]), line["description"], line["hsn"], rate, qty, line["uom"], amount, f"{line['gstRate']}%"]
    if style == "letterhead":
        return [f"{line['lineNo']}.", line["description"], line["hsn"], qty, rate, line["uom"].lower(), amount]
    return [str(line["lineNo"]), line["hsn"], line["description"], qty, rate, amount, f"{line['gstRate']}%"]


def _draw_items(pen, inv, lines, y, style):
    columns = _items_columns(style)
    pen.rule(36, y + 11, 559, y + 11)
    for (label, x, right) in columns:
        pen.text(x, y, label, 8, bold=True, right=right)
    pen.rule(36, y - 4, 559, y - 4)
    y -= 16
    for line in lines:
        for (label, x, right), cell in zip(columns, _item_cells(inv, line, style)):
            pen.text(x, y, cell, 8.5, right=right)
        y -= 14
    pen.rule(36, y + 8, 559, y + 8)
    return y - 6


def _draw_totals(pen, inv, y, style):
    t = inv["totals"]
    labels = {"classic": ("Taxable Value", "Round Off", "Grand Total"),
              "boxed": ("Sub Total", "Rounding", "Total Invoice Value"),
              "einvoice_compact": ("Total Taxable Amount", "Round off", "Amount Payable"),
              "letterhead": ("Total", "Rounded Off (+/-)", "Invoice Total")}[style]
    rows = [(labels[0], t["taxable"])]
    if inv["intra"]:
        rows += [(_tax_label(inv, "cgst", style), t["cgst"]), (_tax_label(inv, "sgst", style), t["sgst"])]
    else:
        rows += [(_tax_label(inv, "igst", style), t["igst"])]
    if t["roundOff"] != 0:
        sign_style = inv["index"] % 3
        value = t["roundOff"]
        printed = (f"(-){_money(inv, abs(value), False)}" if value < 0 and sign_style == 0 else
                   f"-{_money(inv, abs(value), False)}" if value < 0 else _money(inv, value, False))
        rows.append((labels[1], printed))
    for label, value in rows:
        pen.text(330, y, label, 8.5)
        pen.text(555, y, value if isinstance(value, str) else _money(inv, value), 8.5, right=True)
        y -= 13
    pen.rule(326, y + 9, 559, y + 9)
    pen.text(330, y - 2, labels[2], 9.5, bold=True)
    pen.text(555, y - 2, _money(inv, t["grand"]), 9.5, bold=True, right=True)
    y -= 20
    pen.text(40, y, f"Amount Chargeable (in words): {amount_words(t['grand'])}", 7.5)
    return y - 16


def _draw_hsn_summary(pen, inv, y):
    pen.text(40, y, "HSN/SAC Summary", 8, bold=True)
    y -= 12
    heads = [("HSN/SAC", 40, False), ("Taxable Value", 210, True), ("Central Tax", 290, True),
             ("State Tax", 370, True), ("Integrated Tax", 460, True), ("Total Tax", 555, True)]
    for label, x, right in heads:
        pen.text(x, y, label, 7.5, bold=True, right=right)
    y -= 11
    for line in inv["lines"]:
        cells = [line["hsn"], line["amount"], line["cgst"], line["sgst"], line["igst"], line["cgst"] + line["sgst"] + line["igst"]]
        for (label, x, right), cell in zip(heads, cells):
            pen.text(x, y, cell if isinstance(cell, str) else _money(inv, cell, False), 7.5, right=right)
        y -= 10
    t = inv["totals"]
    cells = ["Total", t["taxable"], t["cgst"], t["sgst"], t["igst"], t["cgst"] + t["sgst"] + t["igst"]]
    for (label, x, right), cell in zip(heads, cells):
        pen.text(x, y, cell if isinstance(cell, str) else _money(inv, cell, False), 7.5, bold=True, right=right)
    return y - 16


def _party_block(pen, x, y, heading, party, gstin_label="GSTIN"):
    pen.text(x, y, heading, 8, bold=True)
    pen.text(x, y - 12, party["name"], 9, bold=True)
    pen.text(x, y - 23, party["address"][0], 8)
    pen.text(x, y - 33, party["address"][1], 8)
    pen.text(x, y - 44, f"{gstin_label}: {party['gstin']}", 8.5)
    pen.text(x, y - 55, f"State: {party['stateName'].title()}, Code: {party['stateCode']}", 8)


def render_pdf(inv, key):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas as rl_canvas

    buffer = io.BytesIO()
    canvas = rl_canvas.Canvas(buffer, pagesize=A4, invariant=1)
    canvas.setTitle(f"Synthetic GST invoice {inv['id']}")
    pen = Pen(canvas)
    style = inv["template"]
    printed_date = inv["date"].strftime(inv["dateStyle"])
    token = signed_qr_token(key, qr_data(inv), as_string=inv["qrDataAsString"]) if inv["hasQr"] else None
    lines = inv["lines"]
    first, rest = (lines[: len(lines) // 2], lines[len(lines) // 2:]) if inv["twoPage"] else (lines, [])

    if style == "classic":
        pen.text(297, 812, "TAX INVOICE", 14, bold=True, right=False)
        pen.text(40, 790, inv["seller"]["name"], 11, bold=True)
        pen.text(40, 778, inv["seller"]["address"][0], 8)
        pen.text(40, 768, inv["seller"]["address"][1], 8)
        pen.text(40, 757, f"GSTIN: {inv['seller']['gstin']}", 8.5)
        pen.text(40, 746, f"State: {inv['seller']['stateName'].title()}, Code: {inv['seller']['stateCode']}", 8)
        pen.text(300, 790, f"Invoice No. : {inv['number']}", 9)
        pen.text(300, 778, f"Dated : {printed_date}", 9)
        if inv["poReference"]:
            pen.text(300, 766, f"Buyer's Order No. : {inv['poReference']}", 8.5)
        pen.text(300, 754, f"Place of Supply : {inv['buyer']['stateCode']}-{inv['buyer']['stateName'].title()}", 8.5)
        if token:
            canvas.drawImage(_qr_image(token), 460, 690, width=100, height=100)
            pen.text(40, 728, f"IRN : {inv['irn']}", 7)
            pen.text(40, 719, f"Ack No. : {inv['ackNo']}    Ack Date : {inv['date'].strftime('%d-%m-%Y')}", 7)
        _party_block(pen, 40, 700, "Bill To:", inv["buyer"])
        _party_block(pen, 300, 700, "Ship To:", inv["buyer"])
        y = _draw_items(pen, inv, first, 615, style)
    elif style == "boxed":
        pen.text(40, 812, "TAX INVOICE", 13, bold=True)
        pen.text(555, 812, "Original for Recipient", 7.5, right=True)
        canvas.rect(36, 708, 523, 94, stroke=1, fill=0)
        canvas.line(297, 708, 297, 802)
        _party_block(pen, 42, 790, "Supplier", inv["seller"], "GSTIN/UIN")
        _party_block(pen, 303, 790, "Recipient", inv["buyer"], "GSTIN/UIN")
        canvas.rect(36, 660, 523, 44, stroke=1, fill=0)
        pen.text(42, 690, "Inv. No.", 8.5, bold=True)
        pen.text(130, 690, inv["number"], 8.5)
        pen.text(303, 690, "Invoice Date", 8.5, bold=True)
        pen.text(400, 690, printed_date, 8.5)
        pen.text(42, 670, "Buyer's Order No.", 8.5, bold=True)
        pen.text(130, 670, inv["poReference"] or "-", 8.5)
        pen.text(303, 670, "Place of Supply", 8.5, bold=True)
        pen.text(400, 670, f"{inv['buyer']['stateCode']}-{inv['buyer']['stateName']}", 8.5)
        if token:
            pen.text(150, 812, f"IRN: {inv['irn']}", 6.5)
        y = _draw_items(pen, inv, first, 635, style)
    elif style == "letterhead":
        seller = inv["seller"]
        pen.text(297, 810, seller["name"].upper(), 13, bold=True)
        pen.text(297, 797, ", ".join(seller["address"]), 8)
        pen.text(297, 786, f"GSTIN : {seller['gstin']}  |  PAN : {seller['gstin'][2:12]}", 8)
        pen.text(270, 764, "INVOICE", 12, bold=True)
        pen.text(40, 740, "To,", 8.5)
        pen.text(40, 728, f"M/s {inv['buyer']['name']}", 9, bold=True)
        pen.text(40, 717, inv["buyer"]["address"][0], 8)
        pen.text(40, 707, inv["buyer"]["address"][1], 8)
        pen.text(40, 696, f"GSTIN : {inv['buyer']['gstin']}", 8.5)
        pen.text(360, 740, f"Invoice # : {inv['number']}", 8.5)
        pen.text(360, 728, f"Date of Invoice : {printed_date}", 8.5)
        if inv["poReference"]:
            pen.text(360, 716, f"Order Ref : {inv['poReference']}", 8.5)
        if token:
            pen.text(40, 682, f"IRN {inv['irn']}", 6.5)
        y = _draw_items(pen, inv, first, 660, style)
    else:
        pen.text(40, 812, "e-Invoice" if token else "INVOICE", 13, bold=True)
        if token:
            canvas.drawImage(_qr_image(token), 455, 712, width=105, height=105)
            pen.text(40, 798, f"IRN: {inv['irn']}", 7)
            pen.text(40, 788, f"Ack No: {inv['ackNo']}", 7)
            pen.text(40, 778, f"Ack Date: {inv['date'].strftime('%d-%b-%Y')}", 7)
        pen.text(40, 760, f"Bill No: {inv['number']}", 9, bold=True)
        pen.text(250, 760, f"Bill Date: {printed_date}", 9)
        if inv["poReference"]:
            pen.text(40, 748, f"PO No: {inv['poReference']}", 8)
        pen.text(40, 728, "Billed by", 8, bold=True)
        pen.text(40, 716, inv["seller"]["name"], 9, bold=True)
        pen.text(40, 705, f"GSTIN {inv['seller']['gstin']}", 8.5)
        pen.text(40, 694, ", ".join(inv["seller"]["address"]), 7.5)
        pen.text(310, 728, "Billed to", 8, bold=True)
        pen.text(310, 716, inv["buyer"]["name"], 9, bold=True)
        pen.text(310, 705, f"GSTIN {inv['buyer']['gstin']}", 8.5)
        pen.text(310, 694, ", ".join(inv["buyer"]["address"]), 7.5)
        pen.text(310, 683, f"Place of Supply: {inv['buyer']['stateName'].title()} ({inv['buyer']['stateCode']})", 7.5)
        y = _draw_items(pen, inv, first, 655, style)

    if rest:
        pen.text(555, y - 4, "Continued on page 2 ...", 7.5, right=True)
        pen.text(297, 30, "Page 1 of 2", 7, right=True)
        canvas.showPage()
        pen.text(40, 812, "TAX INVOICE (continued)", 11, bold=True)
        pen.text(40, 798, f"Invoice No. : {inv['number']}", 8.5)
        y = _draw_items(pen, inv, rest, 770, style)
    y = _draw_totals(pen, inv, y - 4, style)
    if style == "classic" and (inv["index"] // 4) % 2 == 1:
        y = _draw_hsn_summary(pen, inv, y)
    if token and style in ("boxed", "letterhead"):
        canvas.drawImage(_qr_image(token), 40, max(y - 115, 40), width=105, height=105)
        y = max(y - 115, 40) + 105
    pen.text(555, max(y - 10, 80), f"for {inv['seller']['name']}", 8, right=True)
    pen.text(555, max(y - 40, 50), "Authorised Signatory", 8, right=True)
    if rest:
        pen.text(297, 30, "Page 2 of 2", 7, right=True)
    canvas.showPage()
    canvas.save()
    return buffer.getvalue()


def generate(n=N_DOCS, seed=SEED):
    from cryptography.hazmat.primitives import serialization

    rng = random.Random(seed)
    key = eval_signing_key(seed)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    truths = []
    for index in range(n):
        inv = build_invoice(rng, index)
        inv["index"] = index
        (PDF_DIR / f"{inv['id']}.pdf").write_bytes(render_pdf(inv, key))
        truths.append(ground_truth(inv))
    TRUTH_PATH.write_text(json.dumps({
        "name": "satya-synthetic-gst-invoices-v1", "seed": seed, "n": n,
        "provenance": "synthetic (reportlab-generated GST invoices with known ground truth)",
        "note": "Fictional parties; GSTINs are checksummed synthetic IDs (not proof they are unissued). "
                "QRs are signed with a deterministic TEST RSA key, not an NIC/IRP key.",
        "documents": truths}, indent=1))
    TEST_KEY_PATH.write_bytes(key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    return truths


# --------------------------------------------------------------- evaluation

def _dec(value):
    from ..extraction.normalize import parse_amount

    if value is None:
        return None
    amount = parse_amount(value)
    return amount.quantize(CENT) if amount is not None else None


def predictions_from_fused(fused):
    fields = fused["fields"]
    def val(name):
        entry = fields.get(name)
        return entry.get("value") if entry else None
    def conf(name):
        entry = fields.get(name)
        return entry if entry else None
    totals = val("totals") or {}
    total_parts = (fields.get("totals") or {}).get("parts") or {}
    out = {
        "number": (val("number"), conf("number")), "date": (val("date"), conf("date")),
        "seller.gstin": ((val("seller") or {}).get("gstin"), ((fields.get("seller") or {}).get("parts") or {}).get("gstin")),
        "buyer.gstin": ((val("buyer") or {}).get("gstin"), ((fields.get("buyer") or {}).get("parts") or {}).get("gstin")),
        "irn": ((val("gst") or {}).get("irn"), ((fields.get("gst") or {}).get("parts") or {}).get("irn")),
        "lineCount": (len(fused["lines"]) if fused["lines"] else None, None),
    }
    for key in ("taxable", "cgst", "sgst", "igst", "grand"):
        out[key] = (totals.get(key), total_parts.get(key))
    return out


def predictions_from_qr(qr):
    mapped = (qr or {}).get("mapped") or {}
    return {"number": mapped.get("number"), "date": mapped.get("date"), "seller.gstin": mapped.get("seller.gstin"),
            "buyer.gstin": mapped.get("buyer.gstin"), "grand": mapped.get("totals.grand"),
            "irn": mapped.get("gst.irn"), "lineCount": mapped.get("lineCount")}


def _truth_value(truth, field):
    if field in ("taxable", "cgst", "sgst", "igst", "grand"):
        return truth["totals"][field]
    if field in ("seller.gstin", "buyer.gstin"):
        role, _ = field.split(".")
        return truth[role]["gstin"]
    return {"number": truth["number"], "date": truth["date"], "irn": truth["irn"], "lineCount": truth["lineCount"]}[field]


def _match(field, predicted, expected):
    if predicted is None or expected is None:
        return False
    if field in ("taxable", "cgst", "sgst", "igst", "grand"):
        return _dec(predicted) == _dec(expected)
    if field == "lineCount":
        return int(predicted) == int(expected)
    return str(predicted).strip() == str(expected).strip()


def _line_scores(pred_lines, truth_lines):
    scores = {"line.qty": [0, 0], "line.rate": [0, 0], "line.amount": [0, 0]}
    for position, truth in enumerate(truth_lines):
        pred = pred_lines[position] if position < len(pred_lines) else {}
        for key, pkey in (("qty", "qty"), ("rate", "rate"), ("amount", "taxableValue")):
            scores[f"line.{key}"][1] += 1
            if pred.get(pkey) is not None and Decimal(str(pred[pkey])) == Decimal(truth[key]):
                scores[f"line.{key}"][0] += 1
    return scores


class Tally:
    def __init__(self):
        self.hits, self.totals = {}, {}

    def add(self, field, ok, count=1, hits=None):
        self.totals[field] = self.totals.get(field, 0) + count
        self.hits[field] = self.hits.get(field, 0) + (hits if hits is not None else int(bool(ok)))

    def rows(self):
        return [{"field": f, "exactMatch": round(self.hits[f] / self.totals[f], 4), "n": self.totals[f]}
                for f in self.totals]

    def micro(self, fields):
        hits = sum(self.hits.get(f, 0) for f in fields)
        total = sum(self.totals.get(f, 0) for f in fields)
        return round(hits / total, 4) if total else None


CONFUSIONS = {"0": "O", "O": "0", "1": "l", "l": "1", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8",
              "2": "Z", "6": "G", ",": ".", ".": ","}


def ocr_noise(text, rng, rate=0.015):
    out = []
    for char in text or "":
        if (char.isalnum() or char in ",.") and rng.random() < rate:
            if rng.random() < 0.25:
                continue
            out.append(CONFUSIONS.get(char, char))
        else:
            out.append(char)
    return "".join(out)


def _score_probe(state, fused, truth, threshold):
    state["n"] += 1
    for name, (pred, entry) in predictions_from_fused(fused).items():
        expected = _truth_value(truth, name)
        if name == "irn" and expected is None:
            continue
        ok = _match(name, pred, expected)
        state["tally"].add(name, ok)
        if name in CRITICAL_FIELDS and entry is not None:
            state["scored"] += 1
            if not entry.get("needsReview") and entry["confidence"] >= threshold:
                state["accepted"] += 1
                state["acceptedWrong"] += int(not ok)


def evaluate(threshold=0.9):
    from ..docs import parse
    from ..extraction.fuse import fuse
    from ..extraction.qr import load_public_key, scan_images

    manifest = json.loads(TRUTH_PATH.read_text())
    truths = manifest["documents"]
    test_key = load_public_key(TEST_KEY_PATH.read_bytes(), "satya-eval-test-key")
    tallies = {"text_layer": Tally(), "einvoice_qr": Tally(), "fused": Tally()}
    by_template = {}
    signature_counts = {"not_verified_default": 0, "verified_with_supplied_test_key": 0, "qrDecoded": 0, "qrDocs": 0}
    auto = {"accepted": 0, "acceptedWrong": 0, "total": 0}
    calib_bins = {}
    doc_all_correct, failures, review_flags = 0, [], 0
    methods = {}
    robust, noise_rng = {}, random.Random(SEED + 1)
    for truth in truths:
        pdf = (EVAL_DIR / truth["file"]).read_bytes()
        parsed = parse(pdf, "application/pdf")
        parsed_no_qr = {**parsed, "qr": {"found": False}}
        text_only = fuse(parsed_no_qr)
        fused = fuse(parsed)
        methods[fused["method"]] = methods.get(fused["method"], 0) + 1
        # text-layer alone
        for name, (pred, _entry) in predictions_from_fused(text_only).items():
            expected = _truth_value(truth, name)
            if name == "irn" and expected is None:
                continue
            tallies["text_layer"].add(name, _match(name, pred, expected))
        for key, (hits, count) in _line_scores(text_only["lines"], truth["lines"]).items():
            tallies["text_layer"].add(key, None, count, hits)
        # QR alone
        if truth["hasQr"]:
            signature_counts["qrDocs"] += 1
            qr = parsed.get("qr") or {}
            if qr.get("kind") == "irp_jwt":
                signature_counts["qrDecoded"] += 1
                signature_counts["not_verified_default"] += int(qr.get("signature") == "not_verified")
                from ..extraction.qr import decode_token
                if decode_token(qr["raw"], extra_keys=[test_key])["signature"] == "verified":
                    signature_counts["verified_with_supplied_test_key"] += 1
            for name, pred in predictions_from_qr(qr).items():
                tallies["einvoice_qr"].add(name, _match(name, pred, _truth_value(truth, name)))
        # fused
        all_ok = True
        for name, (pred, entry) in predictions_from_fused(fused).items():
            expected = _truth_value(truth, name)
            if name == "irn" and expected is None:
                continue
            ok = _match(name, pred, expected)
            tallies["fused"].add(name, ok)
            if name in CRITICAL_FIELDS:
                by_template.setdefault(truth["template"], Tally()).add(name, ok)
                all_ok &= ok
                if entry is not None:
                    auto["total"] += 1
                    confidence = entry["confidence"]
                    bucket = f"{min(int(confidence * 10), 9) / 10:.1f}"
                    calib_bins.setdefault(bucket, [0, 0])
                    calib_bins[bucket][0] += int(ok)
                    calib_bins[bucket][1] += 1
                    if not entry.get("needsReview") and confidence >= threshold:
                        auto["accepted"] += 1
                        auto["acceptedWrong"] += int(not ok)
                    else:
                        review_flags += 1
                if not ok:
                    failures.append({"doc": truth["id"], "template": truth["template"], "field": name,
                                     "expected": expected, "predicted": pred})
        for key, (hits, count) in _line_scores(fused["lines"], truth["lines"]).items():
            tallies["fused"].add(key, None, count, hits)
        doc_all_correct += int(all_ok)
        # robustness probes (no new PDFs): pdfium's plain text instead of the
        # layout reconstruction, and OCR-style character noise on the layout text
        for probe, probe_parsed in (
                ("plain_text_no_layout", {"text": parsed["text"], "method": "pdf_text"}),
                ("ocr_noise_text_only", {"layoutText": ocr_noise(parsed["layoutText"], noise_rng), "method": "pdf_text"}),
                ("ocr_noise_with_qr", {"layoutText": ocr_noise(parsed["layoutText"], noise_rng), "method": "pdf_text",
                                       "qr": parsed.get("qr")})):
            if probe == "ocr_noise_with_qr" and not truth["hasQr"]:
                continue
            _score_probe(robust.setdefault(probe, {"tally": Tally(), "accepted": 0, "acceptedWrong": 0, "scored": 0,
                                                  "n": 0}), fuse(probe_parsed), truth, threshold)

    qr_fields = ["number", "date", "seller.gstin", "buyer.gstin", "grand", "irn", "lineCount"]
    robustness = {}
    for probe, state in robust.items():
        robustness[probe] = {
            "n": state["n"], "overall": state["tally"].micro(CRITICAL_FIELDS),
            "fields": {row["field"]: row["exactMatch"] for row in state["tally"].rows()},
            "autoAcceptRate": round(state["accepted"] / state["scored"], 4) if state["scored"] else None,
            "autoAcceptErrorRate": round(state["acceptedWrong"] / state["accepted"], 4) if state["accepted"] else None,
        }
    robustness["note"] = ("ocr_noise_*: seeded character-level corruption (digit/letter confusions, comma/period swaps, "
                          "dropped characters, ~1.5% of alphanumerics) applied to the layout text to mimic a poor OCR "
                          "read — it is NOT a real scan benchmark. It shows how often the validators keep a corrupted "
                          "value out of the 'green' (auto-accept) set.")
    report = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "dataset": {"name": manifest["name"], "n": len(truths), "seed": manifest["seed"],
                    "provenance": manifest["provenance"], "templates": list(TEMPLATES),
                    "withQr": sum(1 for t in truths if t["hasQr"]),
                    "twoPage": sum(1 for t in truths if t["twoPage"]),
                    "intraState": sum(1 for t in truths if t["supplyType"] == "intra"),
                    "lines": sum(t["lineCount"] for t in truths),
                    "location": "ml-fl-service/data/eval/extraction/"},
        "criticalFields": CRITICAL_FIELDS,
        "fields": tallies["fused"].rows(),
        "overall": tallies["fused"].micro(CRITICAL_FIELDS),
        "byMethod": {
            "text_layer": {"fields": tallies["text_layer"].rows(), "overall": tallies["text_layer"].micro(CRITICAL_FIELDS),
                           "n": len(truths)},
            "einvoice_qr": {"fields": tallies["einvoice_qr"].rows(), "overall": tallies["einvoice_qr"].micro(qr_fields),
                            "n": signature_counts["qrDocs"],
                            "note": "QR carries only number/date/GSTINs/grand/IRN/item count; micro-average over those"},
            "fused": {"fields": tallies["fused"].rows(), "overall": tallies["fused"].micro(CRITICAL_FIELDS), "n": len(truths),
                      "draftMethods": methods},
            "vision_llm": {"measured": False,
                           "note": "No LLM API key in the eval environment; the Gemini vision path is not measured."},
        },
        "byTemplate": {name: {"overall": tally.micro(CRITICAL_FIELDS),
                              "n": sum(1 for t in truths if t["template"] == name)}
                       for name, tally in sorted(by_template.items())},
        "robustness": robustness,
        "documentAllCriticalCorrect": round(doc_all_correct / len(truths), 4),
        "confidence": {
            "autoAcceptThreshold": threshold,
            "autoAcceptRate": round(auto["accepted"] / auto["total"], 4) if auto["total"] else None,
            "autoAcceptErrorRate": round(auto["acceptedWrong"] / auto["accepted"], 4) if auto["accepted"] else None,
            "fieldsScored": auto["total"],
            "definition": "share of critical (doc, field) predictions with confidence >= threshold and no issues "
                          "(needsReview=false); error rate = wrong among those. Drafts are never auto-confirmed — "
                          "this measures how trustworthy a 'green' field is.",
            "reliability": {bucket: {"accuracy": round(h / n, 4), "n": n} for bucket, (h, n) in sorted(calib_bins.items())},
        },
        "qrSignature": {**signature_counts,
                        "note": "Eval QRs are signed with a deterministic local TEST key (not NIC). Default decoding "
                                "correctly reports not_verified; verification succeeds only when the test public key "
                                "is supplied explicitly (test-only code path)."},
        "failures": failures[:40],
        "limitations": [
            "Synthetic, born-digital PDFs from 3 reportlab templates; real supplier invoices vary far more in layout.",
            "No scanned/photographed documents: OCR noise, skew and low-resolution QRs are not exercised.",
            "Vision-LLM (Gemini) path not measured — no API key in the eval environment.",
            "QR signatures use a local test key; real NIC-signed QRs were not available, so 'verified' against "
            "the installed NIC keys is untested end to end here.",
            "Helvetica Type1 fonts cannot render the rupee sign; amounts use 'Rs.'/'INR' prefixes or none.",
            "No discounts, cess, freight/other charges, or multi-currency documents in the set.",
            "Templates were written by the same author as the parser; expect optimistic accuracy versus unseen layouts.",
            "Partial held-out check: the 'letterhead' template was added after the parser was built. On its first run "
            "all critical values were exact, but 7/10 invoice dates fell back to the positional heuristic "
            "(confidence 0.6 -> review) because 'Date of Invoice' was not a known label, and buyers were only "
            "assigned by order ('To,' block). Both labels were then added, so the letterhead numbers below are no "
            "longer held-out.",
        ],
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=1) + "\n")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("command", choices=["generate", "evaluate", "all"])
    args = parser.parse_args(argv)
    if args.command in ("generate", "all"):
        generate()
    if args.command in ("evaluate", "all"):
        report = evaluate()
        print(json.dumps({k: report[k] for k in ("overall", "documentAllCriticalCorrect", "confidence")}, indent=1))
        for row in report["fields"]:
            print(f"  {row['field']:<14} {row['exactMatch']:.3f}  n={row['n']}")


if __name__ == "__main__":
    main()
