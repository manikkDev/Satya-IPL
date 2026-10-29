"""Event-sourced line ledger.

Documents are normalized to ordered events, then folded into per-PO-line
counters. Link resolution: explicit refs > reviewer links > rule; model
suggestions never move a counter.
"""
from decimal import Decimal, getcontext

from ..contracts_v2 import BusinessDocument, DocumentLink

D = Decimal
ZERO = D("0")
getcontext().prec = 60

EVENT_KIND = {
    "PO": "ordered", "PO_AMENDMENT": "ordered", "GRN": "received", "QC": "accepted",
    "RETURN": "returned", "CHALLAN_IN": "received", "INVOICE_IN": "invoiced",
    "PI_IN": "proforma", "CREDIT_NOTE_IN": "credited", "PAYMENT_OUT": "paid",
    "ADVANCE_OUT": "advance", "ADJUSTMENT": "adjustment", "EWAY_BILL": "movement",
    "GSTR_2B": "reported", "DEMAND_NOTE": "disputed", "REJECTION": "rejected",
}

LINE_EVENT_TYPES = {"PO", "PO_AMENDMENT", "GRN", "QC", "RETURN", "CHALLAN_IN",
                    "INVOICE_IN", "PI_IN", "CREDIT_NOTE_IN", "REJECTION"}


def events(documents, links, knowledge_time=None):
    """Normalize documents into a time-ordered event stream."""
    stream = []
    link_index = {}
    for link in links or []:
        if isinstance(link, dict):
            link = DocumentLink.model_validate(link)
        link_index.setdefault(link.fromId, []).append(link)
    cutoff = None
    if knowledge_time is not None:
        cutoff = knowledge_time.isoformat() if hasattr(knowledge_time, "isoformat") else str(knowledge_time)
    for doc in documents:
        if isinstance(doc, dict):
            doc = BusinessDocument.model_validate(doc)
        if cutoff and doc.observedAt > cutoff:
            continue
        if doc.status in {"reversed", "cancelled"}:
            continue
        kind = EVENT_KIND.get(doc.type)
        if kind is None:
            continue
        for line in doc.lines:
            refs = line.refs
            po_id = (refs.poId if refs else None) or next(
                (l.toId for l in link_index.get(doc.id, [])
                 if l.kind in {"FULFILS", "RECEIVES", "BILLS", "SETTLES"}
                 and l.certainty == "CONFIRMED"), None)
            if not po_id:
                continue
            event = {
                "docId": doc.id, "docType": doc.type, "kind": kind, "poId": po_id,
                "poLineNo": refs.poLineNo if refs else None,
                "supplierId": doc.seller.supplierId,
                "currency": doc.currency, "date": doc.date,
                "observedAt": doc.observedAt,
                "qty": D(line.qty) if line.qty is not None else None,
                "rate": D(line.rate) if line.rate is not None else None,
                "lineTotal": D(line.lineTotal) if line.lineTotal is not None else None,
                "uom": line.uom, "status": doc.status,
            }
            stream.append(event)
    stream.sort(key=lambda e: (e["observedAt"], e["date"] or "", e["docId"]))
    return stream


class LineCounter:
    """Per-PO-line counters; the only state detectors may read."""

    def __init__(self):
        self.ordered = ZERO
        self.received = ZERO
        self.accepted = ZERO
        self.rejected = ZERO
        self.returned = ZERO
        self.invoiced_qty = ZERO
        self.invoiced_value = ZERO
        self.credited_value = ZERO
        self.paid_value = ZERO
        self.advance_available = ZERO
        self.advance_adjusted = ZERO

    def apply(self, event):
        qty = event["qty"] if event["qty"] is not None else ZERO
        value = event["lineTotal"] or (
            qty * event["rate"] if event["rate"] is not None else ZERO)
        kind = event["kind"]
        if kind == "ordered":
            self.ordered += qty
        elif kind == "received":
            self.received += qty
        elif kind == "accepted":
            if event["docType"] == "QC" and event.get("rejected"):
                self.rejected += qty
            else:
                self.accepted += qty
        elif kind == "returned":
            self.returned += qty
        elif kind == "invoiced":
            self.invoiced_qty += qty
            self.invoiced_value += value
        elif kind == "credited":
            self.credited_value += value
        elif kind == "paid":
            self.paid_value += value
        elif kind == "advance":
            self.advance_available += value
        elif kind == "adjustment":
            self.advance_adjusted += value
            self.advance_available -= value

    @property
    def delivered(self):
        return self.received - self.returned

    @property
    def supported(self):
        return min(self.accepted if self.accepted > 0 else self.delivered, self.delivered)

    def as_dict(self):
        return {
            "ordered": str(self.ordered), "received": str(self.received),
            "accepted": str(self.accepted), "rejected": str(self.rejected),
            "returned": str(self.returned), "delivered": str(self.delivered),
            "invoicedQty": str(self.invoiced_qty), "invoicedValue": str(self.invoiced_value),
            "creditedValue": str(self.credited_value), "paidValue": str(self.paid_value),
            "advanceAvailable": str(self.advance_available),
            "advanceAdjusted": str(self.advance_adjusted),
        }


def build_ledger(documents, links, knowledge_time=None):
    """Fold the event stream into {poId: {poLineNo: LineCounter}}."""
    ledger = {}
    for event in events(documents, links, knowledge_time):
        key = event["poId"]
        line_key = str(event["poLineNo"]) if event["poLineNo"] is not None else "__doc__"
        counter = ledger.setdefault(key, {}).setdefault(line_key, LineCounter())
        counter.apply(event)
    return ledger
