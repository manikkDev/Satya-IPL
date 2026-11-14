"""Synthetic Indian identities, document-number styles and OCR-like noise.

Every identity here is fictional (checksummed GSTINs are NOT proof a number
is unissued). Used by both the synthetic generator and the BPI-2019 builder,
which keeps real transaction structure but needs Indian-looking identities.
"""
import random
import string
import zlib
from decimal import ROUND_HALF_UP, Decimal

from ...india.gstin import checksum

D = Decimal
STATES = ["27", "29", "24", "33", "07", "06", "09", "19", "36", "32", "08", "23"]
PREFIX = ["Shree", "Sri", "Om", "Jai", "Balaji", "Ganesh", "Laxmi", "Sai", "Krishna", "Mahalaxmi",
          "Vishwakarma", "Bharat", "Hind", "National", "Precision", "Royal", "Supreme", "Unique",
          "Perfect", "Kaveri", "Narmada", "Shakti", "Surya", "Annapurna", "Deccan", "Western", "Ambika",
          "Amar", "Navkar", "Siddhi", "Tirupati", "Mahavir", "Gurukrupa", "Patel", "Agarwal", "Mehta"]
CORE = ["Engineering Works", "Industries", "Traders", "Enterprises", "Hydraulics", "Electricals",
        "Steel Centre", "Polymers", "Fasteners", "Bearings", "Pumps", "Valves", "Tools", "Packaging",
        "Chemicals", "Automation", "Castings", "Forgings", "Cables", "Logistics", "Facility Services"]
LEGAL = ["Pvt Ltd", "Private Limited", "LLP", "& Co", "& Sons", "", "Industries Pvt Ltd"]
ABBREV = {"Engineering": ["Engg.", "Engg", "Engineering"], "Industries": ["Inds.", "Industries", "Ind."],
          "Private Limited": ["Pvt. Ltd.", "Pvt Ltd", "Private Ltd"], "Pvt Ltd": ["Pvt. Ltd.", "Private Limited", "P Ltd"],
          "Shree": ["Shri", "Sri", "Shree"], "Enterprises": ["Ent.", "Enterprises", "Enterprise"],
          "Traders": ["Trdrs", "Traders", "Trading Co"]}
OCR_SWAP = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8", "2": "Z"}

CATALOG = {
    "Pumps": [("Centrifugal monoblock pump {p} HP, CI body", "84137010", "EA", (9000, 45000)),
              ("Submersible pump set {p} HP, 3-phase", "84137091", "EA", (12000, 60000)),
              ("Mechanical seal kit for {p} HP pump", "84842000", "SET", (800, 4000))],
    "Valves": [("Gate valve {d} mm, cast steel, PN16", "84818030", "EA", (1500, 22000)),
               ("Ball valve {d} mm SS304 screwed", "84818090", "EA", (600, 9000)),
               ("Non-return valve {d} mm CI", "84813000", "EA", (900, 12000))],
    "Bearings": [("Deep groove ball bearing 62{n}-2RS", "84821011", "EA", (90, 1600)),
                 ("Taper roller bearing 302{n}", "84822011", "EA", (300, 4200)),
                 ("Plummer block UCP 2{n}", "84831091", "EA", (350, 2600))],
    "Fasteners": [("Hex bolt M{m} x {l} HT 8.8 zinc plated", "73181500", "KG", (110, 260)),
                  ("Hex nut M{m} HT 8.8", "73181600", "KG", (105, 240)),
                  ("Spring washer M{m}", "73182100", "KG", (120, 280))],
    "Cables": [("PVC insulated copper cable {c} sq mm, 4 core", "85444999", "MTR", (60, 900)),
               ("Armoured aluminium cable {c} sq mm", "85446020", "MTR", (90, 1200))],
    "Electricals": [("MCB {a}A TP C-curve", "85362030", "EA", (450, 3200)),
                    ("Contactor {a}A 3-pole 415V", "85364900", "EA", (900, 7800)),
                    ("Induction motor {p} kW 4-pole IE2", "85015210", "EA", (8000, 90000))],
    "Steel Centre": [("MS plate {t} mm IS 2062", "72085120", "KG", (58, 82)),
                     ("MS angle 50x50x{t} mm", "72162100", "KG", (55, 78)),
                     ("SS 304 round bar {d} mm", "72221111", "KG", (190, 320))],
    "Packaging": [("Corrugated box 5-ply {l}x{l}x{l}", "48191010", "EA", (18, 140)),
                  ("Stretch film {m} micron roll", "39201019", "ROLL", (900, 2400)),
                  ("Wooden pallet 1200x1000", "44152000", "EA", (650, 2200))],
    "Chemicals": [("Hydraulic oil ISO VG {n}", "27101980", "LTR", (110, 260)),
                  ("Industrial degreaser {n} L can", "34029099", "EA", (600, 4200))],
    "Tools": [("Carbide end mill {d} mm 4-flute", "82077010", "EA", (450, 6800)),
              ("Drill bit HSS {m} mm", "82075090", "EA", (40, 900))],
    "Services": [("Annual maintenance contract - {svc}", "998719", "JOB", (15000, 250000)),
                 ("Transportation charges - {svc}", "996511", "TRIP", (2500, 45000)),
                 ("Facility housekeeping services - {svc}", "998533", "MONTH", (30000, 180000))],
}
SVC = ["Plant 1", "Warehouse", "Compressor", "DG set", "HVAC", "Pune DC", "Chakan unit"]
CATEGORY_OF = {"Pumps": "Pumps", "Valves": "Valves", "Bearings": "Bearings", "Fasteners": "Fasteners",
               "Cables": "Cables", "Electricals": "Electricals", "Steel Centre": "Steel Centre",
               "Packaging": "Packaging", "Chemicals": "Chemicals", "Tools": "Tools",
               "Logistics": "Services", "Facility Services": "Services", "Automation": "Electricals",
               "Engineering Works": "Valves", "Industries": "Bearings", "Traders": "Fasteners",
               "Enterprises": "Packaging", "Hydraulics": "Pumps", "Polymers": "Packaging",
               "Castings": "Valves", "Forgings": "Steel Centre"}


def money(value):
    return D(value).quantize(D("0.01"), rounding=ROUND_HALF_UP)


def make_pan(rng, name, entity="C"):
    letters = "".join(rng.choice(string.ascii_uppercase) for _ in range(3))
    return f"{letters}{entity}{(name[:1] or 'X').upper()}{rng.randint(1000, 9999)}{rng.choice(string.ascii_uppercase)}"


def make_gstin(state, pan, entity_no=1):
    prefix = f"{state}{pan}{entity_no}Z"
    return prefix + checksum(prefix)


def make_supplier(rng, index, category=None):
    core = rng.choice(CORE) if category is None else category
    name = f"{rng.choice(PREFIX)} {core} {rng.choice(LEGAL)}".strip()
    entity = rng.choice("CCCCFFP")
    pan = make_pan(rng, name, entity)
    state = rng.choice(STATES)
    gstins = [make_gstin(state, pan, 1)]
    if rng.random() < 0.2:  # a branch in another state: same PAN, different GSTIN
        gstins.append(make_gstin(rng.choice([s for s in STATES if s != state]), pan, 2))
    inv_style = rng.choice(["slash_fy", "dash_year", "plain", "gst_fy", "ti_year", "padded"])
    initials = "".join(w[0] for w in name.split()[:3] if w[0].isalpha()).upper() or "SUP"
    return {"id": f"sup_{index}", "name": name, "pan": pan, "gstins": gstins, "state": state,
            "category": CATEGORY_OF.get(core, "Bearings"), "invStyle": inv_style, "initials": initials,
            "creditDays": rng.choice([30, 30, 45, 45, 60, 90]), "tdsRate": rng.choice(
                [None, None, None, D("0.001"), D("0.01"), D("0.02")] if core not in ("Logistics", "Facility Services")
                else [D("0.01"), D("0.02")]),
            "counter": rng.randint(10, 900)}


def name_variant(rng, name, p=0.45):
    if rng.random() > p:
        return name
    out = name
    for key, options in ABBREV.items():
        if key in out and rng.random() < 0.7:
            out = out.replace(key, rng.choice(options))
    if rng.random() < 0.3:
        out = "M/s " + out
    if rng.random() < 0.2:
        out = out.upper()
    if rng.random() < 0.15:
        out = out.replace(" ", "  ", 1).replace(".", "")
    return out


def fy_of(day):
    start = day.year if day.month >= 4 else day.year - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def invoice_number(supplier, day):
    supplier["counter"] += 1
    n, fy, ini = supplier["counter"], fy_of(day), supplier["initials"]
    return {
        "slash_fy": f"{ini}/{fy}/{n:04d}", "dash_year": f"INV-{day.year}-{n:05d}", "plain": f"{n}",
        "gst_fy": f"GST/{fy}/{n}", "ti_year": f"TI/{day.year}/{n:05d}", "padded": f"{n:07d}",
    }[supplier["invStyle"]]


def po_number(style, n, day):
    fy = fy_of(day)
    return {"satya": f"SATYAD/PO/{fy}/{n:06d}", "sap": f"45000{n:05d}", "pur": f"PUR-{day.year}-{n:04d}",
            "short": f"PO/{fy}/{n:04d}"}[style]


def ocr_noise(rng, text, rate=0.12):
    chars = list(text)
    for i, ch in enumerate(chars):
        if ch in OCR_SWAP and rng.random() < rate:
            chars[i] = OCR_SWAP[ch]
    out = "".join(chars)
    if rng.random() < 0.3:
        out = out.replace("/", rng.choice(["-", " ", "", "/"]))
    if rng.random() < 0.2 and len(out) > 4:
        cut = rng.randint(1, 2)
        out = out[cut:] if rng.random() < 0.5 else out[:-cut]
    return out


def reference_text(rng, number, p_exact, p_noisy, label=None):
    """Printed reference to another document: exact, OCR-noisy or absent."""
    roll = rng.random()
    label = label or rng.choice(["PO No.", "PO:", "Your Order No", "Ref PO", "Against PO", "Order Ref"])
    if roll < p_exact:
        return f"{label} {number}"
    if roll < p_exact + p_noisy:
        return f"{label} {ocr_noise(rng, number)}"
    return ""


def desc_variant(rng, desc, p=0.3):
    if rng.random() > p:
        return desc
    swaps = [("Centrifugal", "C/F"), ("monoblock", "mono-block"), ("cast steel", "CS"), ("stainless", "SS"),
             ("copper", "Cu"), ("aluminium", "Al"), ("insulated", "insul."), ("bearing", "brg"),
             ("valve", "VLV"), ("zinc plated", "ZP"), ("Annual maintenance contract", "AMC")]
    out = desc
    for a, b in swaps:
        if a.lower() in out.lower() and rng.random() < 0.6:
            idx = out.lower().index(a.lower())
            out = out[:idx] + b + out[idx + len(a):]
    if rng.random() < 0.3:
        out = out.upper()
    return out


def make_item(rng, category):
    template, hsn, uom, (lo, hi) = rng.choice(CATALOG.get(category, CATALOG["Bearings"]))
    desc = template.format(p=rng.choice([1, 2, 3, 5, 7.5, 10, 15]), d=rng.choice([15, 25, 40, 50, 80, 100, 150]),
                           n=rng.choice([5, 6, 8, 10, 12, 46, 68]), m=rng.choice([8, 10, 12, 16, 20, 23]),
                           l=rng.choice([30, 40, 50, 60, 80]), c=rng.choice([2.5, 4, 6, 10, 16, 25]),
                           a=rng.choice([16, 25, 32, 40, 63]), t=rng.choice([5, 6, 8, 10, 12]), svc=rng.choice(SVC))
    rate = money(D(str(rng.randint(lo, hi))))
    return {"sku": f"{category[:3].upper()}-{zlib.crc32((desc + hsn).encode()) % 100000:05d}", "desc": desc, "hsn": hsn,
            "uom": uom, "rate": rate}


def gst_split(taxable, rate, intra):
    tax = money(taxable * rate / D("100"))
    if intra:
        half = money(tax / 2)
        return half, tax - half, D("0.00")
    return D("0.00"), D("0.00"), tax


def utr(rng, day):
    bank = rng.choice(["HDFCR5", "ICICR", "SBINR5", "UTIBR", "KKBKR5"])
    return f"{bank}{day:%Y%m%d}{rng.randint(10 ** 7, 10 ** 8 - 1)}"


def narration(rng, supplier_name, inv_numbers, day, p_numbers=0.35, p_noisy=0.15):
    short = supplier_name.upper().replace("PRIVATE LIMITED", "").replace("PVT LTD", "")[:18].strip()
    mode = rng.choice(["NEFT", "RTGS", "IMPS"])
    roll = rng.random()
    if roll < p_numbers:
        refs = " ".join(inv_numbers)
        return f"{mode}/{utr(rng, day)}/{short}/INV {refs}"
    if roll < p_numbers + p_noisy:
        refs = " ".join(ocr_noise(rng, n) for n in inv_numbers)
        return f"{mode}-{short}-BILL {refs}"
    return f"{mode}/{utr(rng, day)}/{short}"
