"""Seeded synthetic P2P worlds with ground-truth links (provenance: synthetic).

Realism added over the old generator (satya_engine/data/generator.py):
Indian invoice-number styles per supplier, PAN-sharing branch GSTINs, name
abbreviation variants, standing orders (same items monthly -> genuinely
ambiguous candidates), partial deliveries (1-3 GRNs), per-GRN or consolidated
invoices, rate drift and over-billing, printed PO references that are exact,
OCR-noisy or absent, payments with TDS (194Q/194C/194J rates), bank charges,
split and combined payments, and narrations that may or may not name invoices.
"""
import random
from datetime import date, timedelta
from decimal import Decimal

from .common import (desc_variant, fy_of, gst_split, invoice_number, make_item, make_supplier, money,
                     name_variant, narration, po_number, reference_text, utr)

D = Decimal
BUYER = {"name": "Satya Equipment Distribution Pvt Ltd", "stateCode": "27"}


def party(supplier, rng, gstin=None, p_missing_gstin=0.08):
    out = {"name": name_variant(rng, supplier["name"]), "supplierId": None}
    if rng.random() >= p_missing_gstin:
        out["gstin"] = gstin or supplier["gstins"][0]
        out["pan"] = out["gstin"][2:12]
    return out


def make_doc(doc_id, doc_type, number, day, seller, lines, **extra):
    doc = {"id": doc_id, "type": doc_type, "number": number, "date": day.isoformat(), "status": "posted",
           "seller": seller, "buyer": BUYER, "lines": lines}
    doc.update({k: v for k, v in extra.items() if v is not None})
    return doc


def invoice_lines(rng, po_lines, qty_by_line, drift_p=0.08, over_p=0.04, gst_rate=D("18"), intra=True):
    lines, taxable = [], D("0")
    for line in po_lines:
        qty = qty_by_line.get(line["lineNo"])
        if not qty:
            continue
        rate = D(line["rate"])
        if rng.random() < drift_p:
            rate = money(rate * (D("1") + D(str(rng.choice([0.02, 0.03, 0.05, -0.02, 0.06])))))
        if rng.random() < over_p:
            qty = qty + rng.randint(1, 3)
        value = money(qty * rate)
        taxable += value
        lines.append({"lineNo": len(lines) + 1, "description": desc_variant(rng, line["description"], 0.25),
                      "sku": line["sku"] if rng.random() < 0.55 else "", "hsn": line["hsn"], "uom": line["uom"],
                      "qty": str(qty), "rate": str(rate), "taxableValue": str(value), "gstRate": str(gst_rate)})
    cgst, sgst, igst = gst_split(taxable, gst_rate, intra)
    grand = taxable + cgst + sgst + igst
    rounded = grand.quantize(D("1"))
    totals = {"taxable": str(taxable), "cgst": str(cgst), "sgst": str(sgst), "igst": str(igst), "cess": "0.00",
              "roundOff": str(rounded - grand), "grand": str(rounded) + ".00"}
    return lines, totals


def world(seed, n_suppliers=10, months=10, source="synthetic"):
    """Return {"documents", "links", "group", "source"} for one independent buyer company."""
    rng = random.Random(seed)
    suppliers = [make_supplier(rng, f"{seed}_{i}") for i in range(n_suppliers)]
    for s in suppliers:
        s["items"] = [make_item(rng, s["category"]) for _ in range(rng.randint(3, 10))]
    po_style = rng.choice(["satya", "sap", "pur", "short"])
    start = date(2025, 4, 1) + timedelta(days=rng.randint(0, 200))
    docs, links = [], []
    po_counter = rng.randint(1, 400)
    invoices_by_supplier = {s["id"]: [] for s in suppliers}
    ids = iter(range(10 ** 9))

    def nid(prefix):
        return f"{prefix}_{seed}_{next(ids)}"

    for s in suppliers:
        n_pos = rng.randint(4, 3 * months // 2 + 4)
        standing = rng.sample(s["items"], k=min(len(s["items"]), rng.randint(1, 3)))  # repeat-order items
        intra = s["state"] == BUYER["stateCode"]
        for _ in range(n_pos):
            po_counter += 1
            po_day = start + timedelta(days=rng.randint(0, months * 30))
            if rng.random() < 0.45:
                chosen = list(standing)
            else:
                chosen = rng.sample(s["items"], k=min(len(s["items"]), rng.randint(1, 5)))
            po_lines = []
            for item in chosen:
                qty = rng.choice([1, 2, 4, 5, 6, 10, 12, 20, 25, 50, 100]) if item["uom"] not in ("KG", "MTR", "LTR") \
                    else rng.choice([50, 100, 200, 250, 500, 1000])
                rate = money(item["rate"] * (D("1") + D(rng.randint(-3, 3)) / D("100")))
                po_lines.append({"lineNo": len(po_lines) + 1, "description": item["desc"], "sku": item["sku"],
                                 "hsn": item["hsn"], "uom": item["uom"], "qty": str(qty), "rate": str(rate),
                                 "taxableValue": str(money(qty * rate))})
            po_taxable = sum(D(l["taxableValue"]) for l in po_lines)
            gst_rate = D(rng.choice(["18", "18", "12", "5", "28"]))
            cgst, sgst, igst = gst_split(po_taxable, gst_rate, intra)
            po_id = nid("po")
            po_no = po_number(po_style, po_counter, po_day)
            docs.append(make_doc(po_id, "PO", po_no, po_day, party(s, rng, p_missing_gstin=0.02), po_lines,
                                 totals={"taxable": str(po_taxable), "cgst": str(cgst), "sgst": str(sgst),
                                         "igst": str(igst), "grand": str(po_taxable + cgst + sgst + igst)}))
            # deliveries: 1-3 GRNs, sometimes short-closed
            n_grn = rng.choices([0, 1, 2, 3], weights=[6, 64, 22, 8])[0]
            remaining = {l["lineNo"]: D(l["qty"]) for l in po_lines}
            grn_qtys, day = [], po_day
            for k in range(n_grn):
                day = day + timedelta(days=rng.randint(2, 25))
                this = {}
                for no, rem in remaining.items():
                    if rem <= 0:
                        continue
                    if k == n_grn - 1:
                        q = rem if rng.random() > 0.08 else max(D("1"), (rem * D("0.8")).quantize(D("1")))
                    else:
                        q = max(D("1"), (rem * D(str(rng.choice([0.3, 0.5, 0.6])))).quantize(D("1")))
                    this[no] = q
                    remaining[no] = rem - q
                if not this:
                    break
                grn_id = nid("grn")
                grn_lines = [{"lineNo": i + 1, "description": desc_variant(rng, l["description"], 0.15),
                              "sku": l["sku"], "hsn": l["hsn"], "uom": l["uom"], "qty": str(this[l["lineNo"]])}
                             for i, l in enumerate(po_lines) if l["lineNo"] in this]
                ref = reference_text(rng, po_no, 0.45, 0.15)
                docs.append(make_doc(grn_id, "GRN", f"GRN/{fy_of(day)}/{rng.randint(100, 99999):05d}", day,
                                     party(s, rng, p_missing_gstin=0.25), grn_lines,
                                     externalRef=" ".join(x for x in [ref, f"DC {rng.randint(100, 9999)}"] if x)))
                links.append({"fromId": grn_id, "toId": po_id, "kind": "RECEIVES"})
                grn_qtys.append((day, this))
            # invoices: per GRN or one consolidated, or (invoice before GR) against PO
            invoice_plan = []
            if grn_qtys and rng.random() < 0.75:
                invoice_plan = grn_qtys
            elif grn_qtys:
                total = {}
                for _, q in grn_qtys:
                    for no, v in q.items():
                        total[no] = total.get(no, D("0")) + v
                invoice_plan = [(grn_qtys[-1][0], total)]
            elif rng.random() < 0.5:
                invoice_plan = [(po_day + timedelta(days=rng.randint(1, 20)), {l["lineNo"]: D(l["qty"]) for l in po_lines})]
            for inv_day, qtys in invoice_plan:
                if rng.random() < 0.06:
                    continue  # invoice not yet received
                inv_day = inv_day + timedelta(days=rng.randint(-3, 12))
                lines, totals = invoice_lines(rng, po_lines, qtys, gst_rate=gst_rate, intra=intra)
                if not lines:
                    continue
                inv_id = nid("inv")
                gstin = rng.choice(s["gstins"])
                docs.append(make_doc(inv_id, "INVOICE_IN", invoice_number(s, inv_day), inv_day,
                                     party(s, rng, gstin=gstin), lines, totals=totals,
                                     externalRef=reference_text(rng, po_no, 0.35, 0.25) or None,
                                     terms={"creditDays": s["creditDays"]}))
                links.append({"fromId": inv_id, "toId": po_id, "kind": "BILLS"})
                invoices_by_supplier[s["id"]].append(docs[-1])

    # payments: per supplier, walk invoices by due date
    for s in suppliers:
        pending = sorted(invoices_by_supplier[s["id"]], key=lambda d: d["date"])
        i = 0
        while i < len(pending):
            roll = rng.random()
            if roll < 0.07:  # unpaid / still open
                i += 1
                continue
            batch = [pending[i]]
            if roll > 0.86 and i + 1 < len(pending):  # combined payment for 2-4 invoices
                extra = rng.randint(1, min(3, len(pending) - i - 1))
                batch = pending[i:i + 1 + extra]
            i += len(batch)
            due = max(date.fromisoformat(b["date"]) for b in batch) + timedelta(days=s["creditDays"] + rng.randint(-12, 15))
            gross = sum(D(b["totals"]["grand"]) for b in batch)
            taxable = sum(D(b["totals"]["taxable"]) for b in batch)
            tds = money(taxable * s["tdsRate"]) if s["tdsRate"] and rng.random() < 0.85 else D("0")
            net = gross - tds
            if rng.random() < 0.04:
                net -= D(rng.choice(["11.80", "17.70", "23.60", "29.50", "59.00"]))  # bank charges netted
            parts = [net]
            if len(batch) == 1 and rng.random() < 0.08:  # split payment
                first = money(net * D(str(rng.choice([0.4, 0.5, 0.6]))))
                parts = [first, net - first]
            numbers = [b["number"] for b in batch]
            for k, amount in enumerate(parts):
                day = due + timedelta(days=k * rng.randint(7, 30))
                pay_id = nid("pay")
                seller = party(s, rng, p_missing_gstin=0.35)
                payment = {"amount": str(amount), "utr": utr(rng, day), "mode": rng.choice(["NEFT", "RTGS", "IMPS"]),
                           "valueDate": day.isoformat(), "narration": narration(rng, s["name"], numbers, day)}
                if tds and k == 0 and rng.random() < 0.5:
                    payment["tdsAmount"] = str(tds)  # some ledgers record the TDS on the voucher
                docs.append(make_doc(pay_id, "PAYMENT_OUT", f"PV/{fy_of(day)}/{rng.randint(1, 99999):05d}", day,
                                     seller, [], payment=payment))
                for b in batch:
                    links.append({"fromId": pay_id, "toId": b["id"], "kind": "SETTLES"})
    return {"documents": docs, "links": links, "group": f"syn-{seed}", "source": "synthetic"}


def worlds(n=24, seed=7, **kw):
    return [world(seed * 1000 + i, **kw) for i in range(n)]
