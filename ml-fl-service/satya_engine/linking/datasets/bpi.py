"""BPI Challenge 2019 -> labelled P2P linkage worlds (provenance: "BPI-2019 derived").

What is REAL (from the event log, van Dongen 2019, 4TU, CC BY 4.0): which PO
items exist per purchasing document and vendor, spend-area texts, item net
worth, how many goods receipts and invoice receipts each item had and when,
and which items were cleared (paid) on the same day for the same vendor
(-> combined payments). What is SYNTHETIC: Indian identities (names, GSTINs),
document numbers, printed references, quantities/rates (derived from real net
worth), GST, TDS and narrations. Values are scaled EUR->INR x 90.

Step 1 (`extract`) streams data/raw/bpi2019-random.xml once into a compact
committed table data/linking/bpi2019_p2p_events.json.gz so training is
reproducible without the 100 MB raw log. Step 2 (`worlds`) builds documents.
"""
import gzip
import json
import random
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from .common import (fy_of, gst_split, invoice_number, make_supplier, money, narration, po_number,
                     reference_text, utr)
from .synthetic import BUYER, make_doc, party

D = Decimal
ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "raw" / "bpi2019-random.xml"
TABLE = ROOT / "data" / "linking" / "bpi2019_p2p_events.json.gz"
EUR_INR = D("90")
GR = {"Record Goods Receipt"}
IR = {"Record Invoice Receipt"}
CLEAR = {"Clear Invoice"}
CANCEL_GR = {"Cancel Goods Receipt"}
CANCEL_IR = {"Cancel Invoice Receipt"}


def extract(raw=RAW, out=TABLE, max_vendors=160, max_items_per_vendor=220, seed=2019):
    """Stream the XES log; keep 3-way-match items of a vendor sample (bounded)."""
    by_vendor = defaultdict(list)
    for _event, elem in ET.iterparse(raw, events=("end",)):
        if elem.tag != "trace":
            continue
        attrs = {a.get("key"): a.get("value") for a in elem if a.tag in ("string", "boolean", "float", "int")}
        category = attrs.get("Item Category", "")
        if "3-way" not in category:
            elem.clear()
            continue
        events = []
        for ev in elem.findall("event"):
            ea = {a.get("key"): a.get("value") for a in ev}
            name = ea.get("concept:name")
            if name in GR | IR | CLEAR | CANCEL_GR | CANCEL_IR or name == "Create Purchase Order Item":
                events.append([name, ea.get("time:timestamp", "")[:10], ea.get("Cumulative net worth (EUR)")])
        if any(e[0] in IR for e in events):
            by_vendor[attrs.get("Vendor")].append({
                "po": attrs.get("Purchasing Document"), "item": attrs.get("Item"),
                "spend": attrs.get("Spend area text"), "sub": attrs.get("Sub spend area text"),
                "category": category, "events": events})
        elem.clear()
    rng = random.Random(seed)
    vendors = [v for v, items in by_vendor.items() if len({i["po"] for i in items}) >= 3]
    rng.shuffle(vendors)
    table = {"source": "BPI Challenge 2019 (van Dongen, 4TU.ResearchData, CC BY 4.0), random subset file "
                       "bpi2019-random.xml; 3-way-match items only; vendor sample",
             "vendors": {}}
    for vendor in sorted(vendors[:max_vendors]):
        items = sorted(by_vendor[vendor], key=lambda i: (i["po"], i["item"]))[:max_items_per_vendor]
        table["vendors"][vendor] = items
    out.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(out, "wt") as fh:
        json.dump(table, fh, separators=(",", ":"))
    return {"vendors": len(table["vendors"]), "items": sum(len(v) for v in table["vendors"].values())}


def _day(text):
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def load_table(path=TABLE):
    with gzip.open(path, "rt") as fh:
        return json.load(fh)


def _item_desc(rng, spend, sub, item_no):
    base = (sub or spend or "Material").strip()
    noun = rng.choice(["supply", "material", "consumables", "spares", "services", "lot"])
    return f"{base} {noun} - item {int(item_no) // 10 if item_no and item_no.isdigit() else item_no}"


def world_from_vendors(vendor_items, seed, group):
    """One buyer company: several real vendors' PO/GR/IR/clear histories."""
    rng = random.Random(seed)
    docs, links = [], []
    po_style = rng.choice(["satya", "sap", "pur", "short"])
    ids = iter(range(10 ** 9))

    def nid(prefix):
        return f"{prefix}_{group}_{next(ids)}"

    po_counter = rng.randint(1, 500)
    for v_index, (vendor, items) in enumerate(sorted(vendor_items.items())):
        sup = make_supplier(rng, f"{group}_{v_index}")
        intra = sup["state"] == BUYER["stateCode"]
        gst_rate = D(rng.choice(["18", "18", "12", "5"]))
        by_po = defaultdict(list)
        for item in items:
            by_po[item["po"]].append(item)
        invoices = []
        clear_days = defaultdict(list)  # day -> [invoice doc]
        for po_key, po_items in sorted(by_po.items()):
            create = [_day(e[1]) for it in po_items for e in it["events"] if e[0] == "Create Purchase Order Item"]
            first_event = min((_day(e[1]) for it in po_items for e in it["events"] if _day(e[1])), default=None)
            po_day = min([d for d in create if d] or [first_event or date(2018, 1, 1)])
            po_day = po_day + timedelta(days=365 * 7)  # shift 2018 -> 2025 calendar (dates only, gaps preserved)
            po_counter += 1
            po_no = po_number(po_style, po_counter, po_day)
            po_lines, per_item = [], {}
            for it in po_items:
                worth = D(str(next((e[2] for e in it["events"] if e[2]), "100"))) * EUR_INR
                worth = max(worth, D("50"))
                qty = D(rng.choice([1, 1, 2, 5, 10, 20, 50, 100])) if worth > 2000 else D("1")
                rate = money(worth / qty)
                line_no = len(po_lines) + 1
                desc = _item_desc(rng, it["spend"], it["sub"], it["item"])
                sku = f"BPI-{vendor[-4:]}-{(it['sub'] or 'x')[:3].upper()}{line_no}"
                po_lines.append({"lineNo": line_no, "description": desc, "sku": sku, "hsn": "",
                                 "uom": "EA", "qty": str(qty), "rate": str(rate),
                                 "taxableValue": str(money(qty * rate))})
                per_item[it["item"]] = (it, po_lines[-1])
            taxable = sum(D(l["taxableValue"]) for l in po_lines)
            c, s_, i_ = gst_split(taxable, gst_rate, intra)
            po_id = nid("po")
            docs.append(make_doc(po_id, "PO", po_no, po_day, party(sup, rng, p_missing_gstin=0.02), po_lines,
                                 totals={"taxable": str(taxable), "cgst": str(c), "sgst": str(s_), "igst": str(i_),
                                         "grand": str(taxable + c + s_ + i_)}))
            # real receipt / invoice events, grouped per PO per calendar day
            gr_days, ir_days = defaultdict(list), defaultdict(list)
            for item_no, (it, line) in per_item.items():
                # a cancelled receipt removes the latest matching receipt event
                grs = [e for e in it["events"] if e[0] in GR]
                grs = grs[:max(0, len(grs) - sum(1 for e in it["events"] if e[0] in CANCEL_GR))] or grs[:1]
                irs = [e for e in it["events"] if e[0] in IR]
                irs = irs[:max(0, len(irs) - sum(1 for e in it["events"] if e[0] in CANCEL_IR))] or irs[:1]
                for e in grs:
                    gr_days[_day(e[1])].append((line, len(grs)))
                for e in irs:
                    ir_days[_day(e[1])].append((line, len(irs), it))
            for gday, entries in sorted((k, v) for k, v in gr_days.items() if k):
                gday = gday + timedelta(days=365 * 7)
                grn_lines = []
                for line, n in entries:
                    qty = max(D("1"), (D(line["qty"]) / n).quantize(D("1")))
                    grn_lines.append({"lineNo": len(grn_lines) + 1, "description": line["description"],
                                      "sku": line["sku"], "uom": "EA", "qty": str(qty)})
                grn_id = nid("grn")
                ref = reference_text(rng, po_no, 0.45, 0.15)
                docs.append(make_doc(grn_id, "GRN", f"GRN/{fy_of(gday)}/{rng.randint(100, 99999):05d}", gday,
                                     party(sup, rng, p_missing_gstin=0.25), grn_lines,
                                     externalRef=" ".join(x for x in [ref, f"DC {rng.randint(100, 9999)}"] if x)))
                links.append({"fromId": grn_id, "toId": po_id, "kind": "RECEIVES"})
            for iday, entries in sorted((k, v) for k, v in ir_days.items() if k):
                iday = iday + timedelta(days=365 * 7)
                lines, taxable_i = [], D("0")
                cleared = []
                for line, n, it in entries:
                    qty = max(D("1"), (D(line["qty"]) / n).quantize(D("1")))
                    rate = D(line["rate"])
                    value = money(qty * rate)
                    taxable_i += value
                    lines.append({"lineNo": len(lines) + 1, "description": line["description"],
                                  "sku": line["sku"] if rng.random() < 0.5 else "", "uom": "EA", "qty": str(qty),
                                  "rate": str(rate), "taxableValue": str(value), "gstRate": str(gst_rate)})
                    cleared += [_day(e[1]) for e in it["events"] if e[0] in CLEAR]
                c, s_, i_ = gst_split(taxable_i, gst_rate, intra)
                grand = (taxable_i + c + s_ + i_).quantize(D("1"))
                inv_id = nid("inv")
                inv = make_doc(inv_id, "INVOICE_IN", invoice_number(sup, iday), iday,
                               party(sup, rng, gstin=rng.choice(sup["gstins"])), lines,
                               totals={"taxable": str(taxable_i), "cgst": str(c), "sgst": str(s_), "igst": str(i_),
                                       "cess": "0.00", "roundOff": str(grand - (taxable_i + c + s_ + i_)),
                                       "grand": f"{grand}.00"},
                               externalRef=reference_text(rng, po_no, 0.35, 0.25) or None,
                               terms={"creditDays": sup["creditDays"]})
                docs.append(inv)
                links.append({"fromId": inv_id, "toId": po_id, "kind": "BILLS"})
                invoices.append(inv)
                clear = min((d for d in cleared if d), default=None)
                if clear:
                    clear_days[clear + timedelta(days=365 * 7)].append(inv)
        # real clearing structure: invoices cleared the same day -> one payment
        for cday, batch in sorted(clear_days.items()):
            if cday < max(date.fromisoformat(b["date"]) for b in batch):
                cday = max(date.fromisoformat(b["date"]) for b in batch) + timedelta(days=rng.randint(5, 40))
            gross = sum(D(b["totals"]["grand"]) for b in batch)
            taxable = sum(D(b["totals"]["taxable"]) for b in batch)
            tds = money(taxable * sup["tdsRate"]) if sup["tdsRate"] else D("0")
            amount = gross - tds
            pay_id = nid("pay")
            payment = {"amount": str(amount), "utr": utr(rng, cday), "mode": "NEFT", "valueDate": cday.isoformat(),
                       "narration": narration(rng, sup["name"], [b["number"] for b in batch], cday)}
            docs.append(make_doc(pay_id, "PAYMENT_OUT", f"PV/{fy_of(cday)}/{rng.randint(1, 99999):05d}", cday,
                                 party(sup, rng, p_missing_gstin=0.35), [], payment=payment))
            for b in batch:
                links.append({"fromId": pay_id, "toId": b["id"], "kind": "SETTLES"})
    return {"documents": docs, "links": links, "group": group, "source": "bpi2019"}


def worlds(vendors_per_world=6, seed=19, table=None):
    table = table or load_table()
    vendors = sorted(table["vendors"])
    rng = random.Random(seed)
    rng.shuffle(vendors)
    out = []
    for w in range(0, len(vendors), vendors_per_world):
        chunk = {v: table["vendors"][v] for v in vendors[w:w + vendors_per_world]}
        out.append(world_from_vendors(chunk, seed * 1000 + w, f"bpi-{w // vendors_per_world}"))
    return out

