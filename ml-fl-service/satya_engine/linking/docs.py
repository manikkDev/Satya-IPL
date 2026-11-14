"""Lenient projection of BusinessDocument-like dicts into linking records.

Accepts the server's Mongo documents, engine contract documents and the
training generators' dicts. Never trusts explicit `lines[].refs.*Id` as a
feature (those ids ARE the label in training and already produce links in
production); only printed reference TEXT (externalRef, poReference, payment
narration/remarks, UTR) is evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

from .normalize import name_key

D = Decimal
ZERO = D("0")
FROM_TYPES = {"BILLS": "INVOICE_IN", "RECEIVES": "GRN", "SETTLES": "PAYMENT_OUT"}
TO_TYPES = {"BILLS": "PO", "RECEIVES": "PO", "SETTLES": "INVOICE_IN"}
KINDS = ("BILLS", "RECEIVES", "SETTLES")
TASK_OF = {"BILLS": "link_invoice_po", "RECEIVES": "link_grn_po", "SETTLES": "link_payment_invoice"}
PAYMENT_TYPES = {"PAYMENT_OUT", "ADVANCE_OUT", "BANK_LINE"}


def dec(value):
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("amount", value.get("$numberDecimal"))
        if value is None:
            return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return D(str(value))
    text = str(value).replace(",", "").replace("₹", "").strip()
    if not text:
        return None
    try:
        out = D(text)
    except InvalidOperation:
        return None
    return out if out.is_finite() else None


def parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


@dataclass
class Line:
    desc: str = ""
    sku: str = ""
    hsn: str = ""
    qty: Decimal | None = None
    rate: Decimal | None = None
    value: Decimal | None = None
    line_no: int | None = None


@dataclass
class LinkDoc:
    id: str
    type: str
    number: str = ""
    date: date | None = None
    party_name: str = ""
    gstin: str = ""
    pan: str = ""
    supplier_id: str = ""
    amount: Decimal | None = None
    taxable: Decimal | None = None
    open_amount: Decimal | None = None
    tds: Decimal | None = None
    credit_days: int | None = None
    ref_text: str = ""
    lines: list = field(default_factory=list)
    status: str = ""
    raw_party_key: str = ""

    @property
    def party_keys(self):
        keys = set()
        if self.gstin:
            keys.add("g:" + self.gstin)
        if self.pan:
            keys.add("p:" + self.pan)
        if self.supplier_id:
            keys.add("s:" + self.supplier_id)
        if self.raw_party_key:
            keys.add("n:" + self.raw_party_key)
        return keys


def _party(doc):
    party = doc.get("party") or doc.get("seller") or {}
    if isinstance(party, str):
        party = {"name": party}
    return party


def to_link_doc(doc):
    party = _party(doc)
    gstin = str(party.get("gstin") or "").strip().upper()
    pan = str(party.get("pan") or "").strip().upper() or (gstin[2:12] if len(gstin) == 15 else "")
    payment = doc.get("payment") or {}
    totals = doc.get("totals") or {}
    lines = []
    for index, raw in enumerate(doc.get("lines") or []):
        qty, rate = dec(raw.get("qty")), dec(raw.get("rate"))
        value = dec(raw.get("taxableValue")) or (qty * rate if qty is not None and rate is not None else None) \
            or dec(raw.get("lineTotal"))
        lines.append(Line(desc=str(raw.get("description") or ""), sku=str(raw.get("sku") or raw.get("itemId") or ""),
                          hsn=str(raw.get("hsn") or ""), qty=qty, rate=rate, value=value,
                          line_no=raw.get("lineNo", index + 1)))
    ref_bits = [doc.get("externalRef"), doc.get("poReference"), doc.get("reference"), doc.get("remarks"),
                doc.get("narration"), payment.get("utr"), payment.get("narration"), payment.get("remarks"),
                payment.get("reference")]
    for raw in doc.get("lines") or []:
        refs = raw.get("refs") or {}
        ref_bits += [refs.get("poNumber"), refs.get("invoiceNumber"), refs.get("grnNumber")]
    doc_type = doc.get("type") or ""
    if doc_type in PAYMENT_TYPES:
        amount = dec(payment.get("amount")) or dec(doc.get("amount"))
    else:
        amount = dec(totals.get("grand")) or dec(doc.get("amount"))
        if amount is None and lines and all(l.value is not None for l in lines):
            amount = sum((l.value for l in lines), ZERO)
    taxable = dec(totals.get("taxable"))
    if taxable is None and lines and all(l.value is not None for l in lines):
        taxable = sum((l.value for l in lines), ZERO)
    terms = doc.get("terms") or {}
    tds = dec(payment.get("tdsAmount")) or dec((payment.get("tds") or {}).get("amount") if isinstance(payment.get("tds"), dict) else None)
    return LinkDoc(
        id=str(doc["id"]), type=doc_type, number=str(doc.get("number") or ""),
        date=parse_date(doc.get("date") or payment.get("valueDate")),
        party_name=str(party.get("name") or ""), gstin=gstin, pan=pan,
        supplier_id=str(party.get("supplierId") or doc.get("supplierId") or ""),
        amount=amount, taxable=taxable, open_amount=dec(doc.get("openAmount")), tds=tds,
        credit_days=terms.get("creditDays") if isinstance(terms.get("creditDays"), int) else None,
        ref_text=" ".join(str(b) for b in ref_bits if b), lines=lines, status=str(doc.get("status") or ""),
        raw_party_key=name_key(party.get("name") or ""),
    )
