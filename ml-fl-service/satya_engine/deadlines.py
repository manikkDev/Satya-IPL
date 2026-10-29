"""Compliance deadline engine — MSME 45d, Rule 37 180d, e-invoice 30d, PO schedule."""
from datetime import date, timedelta

DEFAULTS = {"msmeDays": 45, "rule37Days": 180, "einvoiceDays": 30}


def _settled(d, links):
    return any(l.get("kind") == "SETTLES" and l.get("toId") == d["id"] for l in links)


def deadlines(request, links=None):
    links = links or []
    policy = request.policy
    msme_days = policy.msmeDays if policy and policy.msmeDays else DEFAULTS["msmeDays"]
    rule37_days = policy.rule37Days if policy and policy.rule37Days else DEFAULTS["rule37Days"]
    einv_days = policy.einvoiceDays if policy and policy.einvoiceDays else DEFAULTS["einvoiceDays"]
    as_of = date.fromisoformat(request.asOf) if request.asOf else date.today()

    msme_suppliers = {s.id for s in (request.suppliers or []) if s.msme or (s.udyam and s.udyam.category in {"micro", "small"})}
    docs = [d.model_dump() for d in request.documents]
    supplier_of = {}
    for d in docs:
        sid = (d.get("seller") or {}).get("supplierId")
        if sid:
            supplier_of[d["id"]] = sid

    out = []

    def emit(kind, doc_id, supplier_id, due, amount, basis):
        out.append({"kind": kind, "documentId": doc_id,
                    "supplierId": supplier_id,
                    "dueDate": due.isoformat(), "daysLeft": (due - as_of).days,
                    "amount": amount, "basis": basis})

    for d in docs:
        if d["status"] in {"reversed", "cancelled", "draft"}:
            continue
        doc_date = date.fromisoformat(d["date"])
        settled = _settled(d, links)
        supplier = supplier_of.get(d["id"])
        grand = {"amount": d["totals"]["grand"], "currency": d["currency"]} if d.get("totals") else None

        if d["type"] == "INVOICE_IN" and not settled:
            if supplier in msme_suppliers:
                emit("MSME_45", d["id"], supplier, doc_date + timedelta(days=msme_days),
                     grand, f"MSME Act — micro/small supplier, {msme_days}-day payment limit")
            emit("RULE_37_180", d["id"], supplier, doc_date + timedelta(days=rule37_days),
                 grand, f"CGST Rule 37 — ITC reversal if unpaid beyond {rule37_days} days")
            if d.get("gst") and not d["gst"].get("irn"):
                emit("EINVOICE_30", d["id"], supplier, doc_date + timedelta(days=einv_days),
                     grand, "GSTN advisory — e-invoice must be reported within 30 days (AATO ≥ ₹10cr)")

        if d["type"] == "PO":
            for line in d["lines"]:
                if line.get("scheduleDate"):
                    emit("PO_DELIVERY", d["id"], supplier, date.fromisoformat(line["scheduleDate"]),
                         None, f"PO line {line['lineNo']} delivery schedule")

    out.sort(key=lambda x: (x["daysLeft"], x["kind"]))
    return {"deadlines": out}
