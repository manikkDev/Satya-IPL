from copy import deepcopy


def line(quantity, price="1000", sku="CP100-1KW", description="Centrifugal pump CP-100 1 kW", accepted=None):
    data = {"id": "1", "sku": sku, "description": description, "quantity": str(quantity), "unitPrice": str(price), "uom": "EA", "poLineId": "1"}
    if accepted is not None:
        data["acceptedQuantity"] = str(accepted)
    return data


def record(identifier, kind, reference, day, **values):
    timestamp = f"2026-10-{day:02d}T10:00:00+05:30"
    return {"id": identifier, "type": kind, "reference": reference, "source": {"PO": "procurement_export", "GRN": "warehouse_export", "INVOICE": "accounts_payable_export", "PAYMENT": "bank_export"}.get(kind, "supplier_export"), "supplier": "Meridian Pump Supply", "currency": "INR", "occurredAt": timestamp, "observedAt": timestamp, "provenance": "CONSTRUCTED", **values}


def demo_bundle():
    main = [
        record("PO-1001", "PO", "PO/2026/1001", 1, lines=[line(100)], amount="118000.00", status="approved", dueAt="2026-10-20T18:00:00+05:30"),
        record("GRN-A", "GRN", "GRN/40", 3, poId="PO-1001", lines=[line(40, accepted=40)]),
        record("GRN-B", "GRN", "GRN/20", 5, poId="PO-1001", lines=[line(20, accepted=20)]),
        record("INV-041", "INVOICE", "INV-M-041", 6, poId="PO-1001", lines=[line(60, description="CP100 pump, 1 kW")], netAmount="60000.00", taxes={"CGST": "5400.00", "SGST": "5400.00"}, amount="70800.00", dueAt="2026-11-05T18:00:00+05:30"),
        record("AP-992", "INVOICE", "INV M 041", 7, poId="PO-1001", lines=[line(60, description="CP100 pump, 1 kW")], netAmount="60000.00", taxes={"CGST": "5400.00", "SGST": "5400.00"}, amount="70800.00", dueAt="2026-11-05T18:00:00+05:30"),
        record("INV-042", "INVOICE", "INV-M-042", 6, poId="PO-1002", lines=[line(15)], netAmount="15000.00", amount="15000.00"),
        record("BANK-T01", "PAYMENT", "NEFT / INV-M-041", 8, invoiceId="INV-041", amount="30000.00", status="settled", utr="DEMO-UTR-001"),
        record("BANK-T02", "PAYMENT", "RTGS / INV-M-041", 9, invoiceId="INV-041", amount="20800.00", status="settled", utr="DEMO-UTR-002"),
        record("BANK-T03", "PAYMENT", "NEFT / vendor transfer", 9, amount="15000.00", status="settled", utr="DEMO-UTR-003"),
    ]
    clean = [
        record("PO-2001", "PO", "PO/2026/2001", 1, lines=[line(20, "2500", "METER-230V", "Digital meter 230 V")], status="approved", dueAt="2026-10-18T18:00:00+05:30"),
        record("GRN-2001", "GRN", "GRN/E/20", 4, poId="PO-2001", lines=[line(20, "2500", "METER-230V", "Digital meter 230 V", 20)]),
        record("INV-2001", "INVOICE", "INV/E/201", 5, poId="PO-2001", lines=[line(20, "2500", "METER-230V", "Digital meter 230 V")], netAmount="50000.00", taxes={"CGST": "4500.00", "SGST": "4500.00"}, amount="59000.00"),
        record("BANK-2001", "PAYMENT", "NEFT / INV/E/201", 8, invoiceId="INV-2001", amount="59000.00", status="settled"),
    ]
    inspection = [
        record("PO-3001", "PO", "PO/LAB/3001", 1, lines=[line(10, "8000", "BALANCE-200G", "Laboratory balance 200 g")], status="approved", matchingLevel="four_way", dueAt="2026-10-18T18:00:00+05:30"),
        record("GRN-3001", "GRN", "GRN/LAB/10", 5, poId="PO-3001", lines=[line(10, "8000", "BALANCE-200G", "Laboratory balance 200 g", 8)]),
        record("INV-3001", "INVOICE", "INV/LAB/301", 6, poId="PO-3001", lines=[line(10, "8000", "BALANCE-200G", "Laboratory balance 200 g")], netAmount="80000.00", taxes={"IGST": "14400.00"}, amount="94400.00"),
    ]
    fx = [
        record("PO-4001", "PO", "PO/IMPORT/4001", 1, currency="USD", lines=[line(5, "100", "VALVE-50MM", "Valve 50 mm")], status="approved", dueAt="2026-10-18T18:00:00+05:30"),
        record("GRN-4001", "GRN", "GRN/IMPORT/5", 5, currency="USD", poId="PO-4001", lines=[line(5, "100", "VALVE-50MM", "Valve 50 mm", 5)]),
        record("INV-4001", "INVOICE", "INV/IMPORT/401", 6, currency="EUR", poId="PO-4001", lines=[line(5, "100", "VALVE-50MM", "Valve 50 mm")], netAmount="500.00", amount="500.00"),
    ]
    stale = [
        record("PO-5001", "PO", "PO/2026/5001", 1, lines=[line(30, "500", "SWITCH-16A", "Circuit switch 16 A")], status="approved", coverage="unknown", dueAt="2026-10-05T18:00:00+05:30"),
        record("INV-5001", "INVOICE", "INV/S/501", 6, poId="PO-5001", lines=[line(30, "500", "SWITCH-16A", "Circuit switch 16 A")], netAmount="15000.00", amount="17700.00", taxes={"CGST": "1350.00", "SGST": "1350.00"}),
    ]
    cases = []
    for identifier, title, sector, po_id, records in [
        ("pumps-1001", "Partial delivery, duplicate posting & split payments", "Industrial", "PO-1001", main),
        ("meters-2001", "Electrical meters · reconciled", "Electrical", "PO-2001", clean),
        ("balances-3001", "Inspection rejected two laboratory balances", "Laboratory", "PO-3001", inspection),
        ("valves-4001", "Import invoice in a conflicting currency", "Industrial", "PO-4001", fx),
        ("switches-5001", "Warehouse evidence is incomplete", "Electrical", "PO-5001", stale),
    ]:
        cases.append({"id": identifier, "title": title, "sector": sector, "poId": po_id, "supplier": "Meridian Pump Supply", "records": deepcopy(records)})
    return {"company": {"id": "satya-demo", "name": "Satya Equipment Distribution", "country": "IN", "timezone": "Asia/Kolkata", "currency": "INR"}, "clock": "2026-10-10T12:00:00+05:30", "provenance": "CONSTRUCTED", "assumptions": ["All companies, records and UTR references are fictional.", "GST components are fixture assumptions, not HSN/rate/IRN verification.", "Bank status and references are simulated source observations; no real transfers."], "cases": cases}
