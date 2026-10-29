"""Calibrated scenario generator — seeded BusinessDocuments + ground-truth labels.

Every record is provenance:CONSTRUCTED_DEMO. The generator emits JSONL (one
doc per line) and labels.jsonl (true links + injected findings) so matching,
learning and evaluation can be measured honestly.
"""
import json
import random
from datetime import date, timedelta
from pathlib import Path

HSN_CHAPTERS = ["73", "84", "85", "40", "90"]
FIRST_NAMES = ["Shree", "Siddhi", "Bharat", "Kaveri", "National", "Precision"]
LAST_NAMES = ["Equipments", "Industries", "Engineering", "Traders", "Components"]
LEGAL_SUFFIXES = ["Pvt Ltd", "Private Limited", "& Sons", "Corporation"]
STATES = ["27", "29", "07", "06", "24", "33", "09", "19"]

LAG_FILE = Path(__file__).resolve().parents[2] / "assets" / "bpi_lag_distributions.json"
_lag_cache = None


def _lags():
    global _lag_cache
    if _lag_cache is None:
        try:
            _lag_cache = json.loads(LAG_FILE.read_text())["flows"] if LAG_FILE.exists() else {}
        except Exception:
            _lag_cache = {}
    return _lag_cache


def _sample_lag(flow, rng, fallback_lo, fallback_hi):
    """Inverse-CDF sample from BPI percentile table; randint fallback."""
    table = (_lags().get(flow) or {}).get("percentiles")
    if not table:
        return rng.randint(fallback_lo, fallback_hi)
    u = rng.uniform(0, 99)
    points = sorted((float(k[1:]), v) for k, v in table.items())
    if u <= points[0][0]:
        return int(round(points[0][1]))
    if u >= points[-1][0]:
        return int(round(points[-1][1]))
    for (p1, v1), (p2, v2) in zip(points, points[1:]):
        if p1 <= u <= p2:
            return int(round(v1 + (v2 - v1) * (u - p1) / (p2 - p1)))
    return int(round(points[-1][1]))


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
            grn_date = (date.fromisoformat(po_date) + timedelta(days=_sample_lag("po_to_grn", rng, 3, 21))).isoformat()
            grn_lines = []
            for ln in po_lines:
                received = int(ln["qty"]) if rng.random() < 0.7 else max(1, int(ln["qty"]) - rng.randint(1, 4))
                grn_lines.append(_line(ln["lineNo"], received, ln["rate"], po=po_id, po_line=ln["lineNo"], hsn=ln["hsn"]))
            grn_id = f"GRN-{1000 + po_index}"
            docs.append(_doc(grn_id, "GRN", f"GRN/{po_index + 1:04d}", grn_date, supplier, buyer, grn_lines))
            links.append({"fromId": grn_id, "toId": po_id, "kind": "RECEIVES", "certainty": "CONFIRMED", "basis": "reference"})

        # ~70% get an invoice against delivered
        if rng.random() < 0.7:
            inv_date = (date.fromisoformat(po_date) + timedelta(days=_sample_lag("grn_to_invoice", rng, 5, 30))).isoformat()
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
            pay_date = (date.fromisoformat(po_date) + timedelta(days=_sample_lag("invoice_to_clear", rng, 20, 60))).isoformat()
            pay_id = f"PAY-{3000 + po_index}"
            pay_amount = round(sum(int(l["qty"]) * float(l["rate"]) for l in po_lines) * 1.18, 2)
            docs.append(_doc(pay_id, "PAYMENT_OUT", f"PAY/{po_index + 1:04d}", pay_date, supplier, buyer,
                             [_line(1, 1, str(pay_amount), po=po_id)],
                             payment={"amount": f"{pay_amount:.2f}", "utr": f"UTR{po_index:06d}"}))
            if rng.random() < 0.15:
                labels.append({"type": "PAY_UNALLOCATED", "docId": pay_id,
                               "injected": True, "seed": seed,
                               "note": "payment without remittance/invoice target"})
            # ~6% of payments land in a different bank account than earlier ones
            if rng.random() < 0.06:
                docs[-1]["payment"]["bankAccountMasked"] = f"…{rng.randint(1000, 9999)}"
                docs[-1]["payment"]["utr"] = f"UTR{po_index:06d}B"
                labels.append({"type": "PAY_BANK_ACCOUNT_CHANGED", "docId": pay_id,
                               "injected": True, "seed": seed})

        # ~5% wrong tax type (CGST+SGST where IGST expected for out-of-state)
        if rng.random() < 0.05 and supplier["stateCode"] != buyer["stateCode"]:
            for d in docs:
                if d["type"] == "INVOICE_IN" and d["seller"]["name"] == supplier["name"]:
                    if d.get("totals") and d["totals"].get("igst") == "0":
                        labels.append({"type": "TAX_TYPE_MISMATCH", "docId": d["id"],
                                       "injected": True, "seed": seed,
                                       "note": "intra-state tax on inter-state supply"})

        # ~4% currency mismatch (payment in non-INR while PO/invoice are INR)
        if rng.random() < 0.04:
            for d in docs:
                if d["type"] == "PAYMENT_OUT" and d["seller"]["name"] == supplier["name"]:
                    d["currency"] = "USD"
                    labels.append({"type": "DOC_CURRENCY_MISMATCH", "docId": d["id"],
                                   "injected": True, "seed": seed})
                    break

        # ~4% cross-entity duplicate invoice (same number in ent-2)
        if rng.random() < 0.04:
            for d in docs:
                if d["type"] == "INVOICE_IN" and d["seller"]["name"] == supplier["name"]:
                    cross = dict(d)
                    cross["id"] = f"{d['id']}-E2"
                    cross["entityId"] = "ent-2"
                    cross["groupId"] = "grp-demo"
                    docs.append(cross)
                    labels.append({"type": "DUP_CROSS_ENTITY", "docId": cross["id"],
                                   "canonicalId": d["id"], "injected": True, "seed": seed})
                    break

    # ~5% supplier name variant (duplicate vendor master) — appended once
    if rng.random() < 0.5:
        base = rng.choice(supplier_pool)
        variant = dict(base)
        variant["name"] = base["name"].replace("Pvt Ltd", "Private Limited") if "Pvt Ltd" in base["name"] \
            else base["name"].replace("Private Limited", "Pvt Ltd")
        variant["supplierId"] = f"{base['supplierId']}-dup"
        supplier_pool.append(variant)
        labels.append({"type": "MASTER_NAME_VARIANT", "supplierId": variant["supplierId"],
                       "canonicalId": base["supplierId"], "injected": True, "seed": seed})

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
