"""Calibrated scenario generator — seeded BusinessDocuments + ground-truth labels.

Every record is provenance:CONSTRUCTED_DEMO. The generator emits JSONL (one
doc per line) and labels.jsonl (true links + injected findings) so matching,
learning and evaluation can be measured honestly.
"""
import json
import random
from datetime import date, timedelta

HSN_CHAPTERS = ["73", "84", "85", "40", "90"]
FIRST_NAMES = ["Shree", "Siddhi", "Bharat", "Kaveri", "National", "Precision"]
LAST_NAMES = ["Equipments", "Industries", "Engineering", "Traders", "Components"]
LEGAL_SUFFIXES = ["Pvt Ltd", "Private Limited", "& Sons", "Corporation"]
STATES = ["27", "29", "07", "06", "24", "33", "09", "19"]


def _doc(doc_id, doc_type, number, doc_date, seller, buyer, lines, **kw):
    base = dict(
        id=doc_id, groupId="grp-demo", entityId=kw.pop("entityId", "ent-1"),
        type=doc_type, number=number, date=doc_date, fy="2026-27",
        status=kw.pop("status", "posted"), revision=1,
        seller=seller, buyer=buyer, currency=kw.pop("currency", "INR"),
        source={"channel": "created_in_satya"}, provenance="CONSTRUCTED_DEMO",
        observedAt=f"{doc_date}T09:00:00Z", createdAt=f"{doc_date}T09:00:00Z",
        createdBy="generator", updatedAt=f"{doc_date}T09:00:00Z", lines=lines,
    )
    base.update(kw)
    return base


def _line(no, qty, rate, po=None, po_line=None, uom="EA", hsn=None):
    from decimal import Decimal as D
    line = dict(lineNo=no, description="Industrial item", qty=str(qty), uom=uom,
                rate=str(rate), lineTotal=str(D(str(qty)) * D(str(rate))), hsn=hsn)
    if po:
        line["refs"] = {"poId": po, "poLineNo": po_line}
    return line


def _supplier(rng, index):
    name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)} {rng.choice(LEGAL_SUFFIXES)}"
    state = rng.choice(STATES)
    gstin = f"{state}{rng.choice('ABCDEFGHKLM')}{rng.choice('ABCDEFGHKLM')}{rng.choice('ABCDEFGHKLM')}{rng.choice('AB')}{rng.randint(1000, 9999)}{rng.choice('ABCDEFGHKLM')}1Z{rng.choice('0123456789ABCDEFGHKLM')}"
    return {"name": name, "gstin": gstin, "stateCode": state, "supplierId": f"sup-{index}"}


def generate(seed=42, n_pos=40, suppliers=8):
    """Emit (documents, links, labels) — deterministic given seed."""
    rng = random.Random(seed)
    docs, links, labels = [], [], []
    supplier_pool = [_supplier(rng, i) for i in range(suppliers)]
    buyer = {"name": "Acme Industrial Distributors Pvt Ltd", "stateCode": "27"}

    start = date(2026, 4, 1)
    for po_index in range(n_pos):
        supplier = rng.choice(supplier_pool)
        po_date = (start + timedelta(days=rng.randint(0, 180))).isoformat()
        n_lines = rng.randint(1, 3)
        po_id = f"PO-{1000 + po_index}"
        po_lines = []
        for ln in range(1, n_lines + 1):
            po_lines.append(_line(ln, rng.randint(5, 50), rng.randint(500, 5000),
                                  po=po_id, po_line=ln, hsn=rng.choice(HSN_CHAPTERS) + f"{rng.randint(10, 99):02d}00"))
        docs.append(_doc(po_id, "PO", f"PO/{po_index + 1:04d}", po_date, supplier, buyer, po_lines))

        # ~80% of POs get a GRN (delivery may be partial)
        if rng.random() < 0.8:
            grn_date = (date.fromisoformat(po_date) + timedelta(days=rng.randint(3, 21))).isoformat()
            grn_lines = []
            for ln in po_lines:
                received = int(ln["qty"]) if rng.random() < 0.7 else max(1, int(ln["qty"]) - rng.randint(1, 4))
                grn_lines.append(_line(ln["lineNo"], received, ln["rate"], po=po_id, po_line=ln["lineNo"], hsn=ln["hsn"]))
            grn_id = f"GRN-{1000 + po_index}"
            docs.append(_doc(grn_id, "GRN", f"GRN/{po_index + 1:04d}", grn_date, supplier, buyer, grn_lines))
            links.append({"fromId": grn_id, "toId": po_id, "kind": "RECEIVES", "certainty": "CONFIRMED", "basis": "reference"})

        # ~70% get an invoice against delivered
        if rng.random() < 0.7:
            inv_date = (date.fromisoformat(po_date) + timedelta(days=rng.randint(5, 30))).isoformat()
            inv_lines = [dict(l) for l in po_lines]
            taxable = sum(int(l["qty"]) * float(l["rate"]) for l in inv_lines)
            tax = round(taxable * 0.18, 2)
            inv_id = f"INV-{2000 + po_index}"
            docs.append(_doc(inv_id, "INVOICE_IN", f"INV/{po_index + 1:04d}", inv_date, supplier, buyer, inv_lines,
                             totals={"taxable": f"{taxable:.2f}", "cgst": f"{tax / 2:.2f}", "sgst": f"{tax / 2:.2f}",
                                     "igst": "0", "cess": "0", "roundOff": "0", "grand": f"{taxable + tax:.2f}"}))
            links.append({"fromId": inv_id, "toId": po_id, "kind": "BILLS", "certainty": "CONFIRMED", "basis": "reference"})

            # Error injections (each with a label)
            if rng.random() < 0.10:
                dup_id = f"INV-D-{2000 + po_index}"
                docs.append(_doc(dup_id, "INVOICE_IN", f"INV/{po_index + 1:04d}", inv_date, supplier, buyer, inv_lines,
                                 observedAt=f"{inv_date}T14:00:00Z",
                                 totals={"taxable": f"{taxable:.2f}", "cgst": f"{tax / 2:.2f}", "sgst": f"{tax / 2:.2f}",
                                         "igst": "0", "cess": "0", "roundOff": "0", "grand": f"{taxable + tax:.2f}"}))
                labels.append({"type": "DUPLICATE_INVOICE_SUSPECT", "docId": dup_id, "canonicalId": inv_id,
                               "injected": True, "seed": seed})
            if rng.random() < 0.08:
                inv_lines2 = [dict(l) for l in po_lines]
                if inv_lines2:
                    inv_lines2[0]["qty"] = str(int(inv_lines2[0]["qty"]) + rng.randint(1, 5))
                    inv_lines2[0]["lineTotal"] = str(float(inv_lines2[0]["qty"]) * float(inv_lines2[0]["rate"]))
                inv2_id = f"INV-B-{2000 + po_index}"
                taxable2 = sum(int(l["qty"]) * float(l["rate"]) for l in inv_lines2)
                tax2 = round(taxable2 * 0.18, 2)
                docs.append(_doc(inv2_id, "INVOICE_IN", f"INV-B/{po_index + 1:04d}", inv_date, supplier, buyer, inv_lines2,
                                 totals={"taxable": f"{taxable2:.2f}", "cgst": f"{tax2 / 2:.2f}", "sgst": f"{tax2 / 2:.2f}",
                                         "igst": "0", "cess": "0", "roundOff": "0", "grand": f"{taxable2 + tax2:.2f}"}))
                links.append({"fromId": inv2_id, "toId": po_id, "kind": "BILLS", "certainty": "CONFIRMED", "basis": "reference"})
                labels.append({"type": "INVOICE_QTY_EXCEEDS_RECEIVED", "docId": inv2_id,
                               "poId": po_id, "injected": True, "seed": seed})

        # ~40% get a payment
        if rng.random() < 0.4:
            pay_date = (date.fromisoformat(po_date) + timedelta(days=rng.randint(20, 60))).isoformat()
            pay_id = f"PAY-{3000 + po_index}"
            pay_amount = round(sum(int(l["qty"]) * float(l["rate"]) for l in po_lines) * 1.18, 2)
            docs.append(_doc(pay_id, "PAYMENT_OUT", f"PAY/{po_index + 1:04d}", pay_date, supplier, buyer,
                             [_line(1, 1, str(pay_amount), po=po_id)],
                             payment={"amount": f"{pay_amount:.2f}", "utr": f"UTR{po_index:06d}"}))
            if rng.random() < 0.15:
                labels.append({"type": "PAY_UNALLOCATED", "docId": pay_id,
                               "injected": True, "seed": seed,
                               "note": "payment without remittance/invoice target"})

    return docs, links, labels


def write_jsonl(docs, links, labels, out_prefix):
    with open(f"{out_prefix}.jsonl", "w") as f:
        for d in docs:
            f.write(json.dumps(d) + "\n")
    with open(f"{out_prefix}.labels.jsonl", "w") as f:
        for l in labels + [{"type": "LINK", **l} for l in links]:
            f.write(json.dumps(l) + "\n")
    with open(f"{out_prefix}.links.json", "w") as f:
        json.dump(links, f, indent=2)
