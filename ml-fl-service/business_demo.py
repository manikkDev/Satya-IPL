from copy import deepcopy


def line(quantity, price="1000", sku="CP100-1KW", description="Centrifugal pump CP-100 1 kW", accepted=None, uom="EA", packSize=None):
    data = {"id": "1", "sku": sku, "description": description, "quantity": str(quantity), "unitPrice": str(price), "uom": uom, "poLineId": "1"}
    if accepted is not None:
        data["acceptedQuantity"] = str(accepted)
    if packSize is not None:
        data["packSize"] = str(packSize)
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
    overbill = [
        record("PO-6001", "PO", "PO/2026/6001", 1, supplier="Shakti Bearing Works", lines=[line(50, "800", "BRG-6305", "Ball bearing 6305 ZZ")], amount="47200.00", status="approved", dueAt="2026-10-30T18:00:00+05:30"),
        record("GRN-6001", "GRN", "GRN/BRG/50", 4, supplier="Shakti Bearing Works", poId="PO-6001", lines=[line(50, "800", "BRG-6305", "Ball bearing 6305 ZZ", 50)]),
        record("INV-6001", "INVOICE", "SBW/INV/118", 6, supplier="Shakti Bearing Works", poId="PO-6001", lines=[line(70, "800", "BRG-6305", "Ball bearing 6305 ZZ")], netAmount="56000.00", taxes={"CGST": "5040.00", "SGST": "5040.00"}, amount="66080.00"),
    ]
    returned = [
        record("PO-6002", "PO", "PO/LAB/6002", 1, supplier="PrecisionLab Instruments", lines=[line(20, "12000", "CFGE-15ML", "Benchtop centrifuge 15 ml")], amount="283200.00", status="approved", dueAt="2026-10-28T18:00:00+05:30"),
        record("GRN-6002", "GRN", "GRN/LAB/20", 3, supplier="PrecisionLab Instruments", poId="PO-6002", lines=[line(20, "12000", "CFGE-15ML", "Benchtop centrifuge 15 ml", 20)]),
        record("RET-6002", "RETURN", "RET/LAB/3", 6, supplier="PrecisionLab Instruments", source="warehouse_export", poId="PO-6002", lines=[line(3, "12000", "CFGE-15ML", "Benchtop centrifuge 15 ml")]),
        record("INV-6002", "INVOICE", "PLI/INV/442", 5, supplier="PrecisionLab Instruments", poId="PO-6002", lines=[line(20, "12000", "CFGE-15ML", "Benchtop centrifuge 15 ml")], netAmount="240000.00", taxes={"IGST": "43200.00"}, amount="283200.00"),
        record("CN-6002", "CREDIT_NOTE", "CN/PLI/077", 8, supplier="PrecisionLab Instruments", invoiceId="INV-6002", amount="42480.00"),
    ]
    pricevariance = [
        record("PO-6003", "PO", "PO/2026/6003", 1, supplier="VoltEdge Switchgear", lines=[line(15, "2500", "MCB-32A", "Switchboard MCB 32 A")], amount="44250.00", status="approved", dueAt="2026-10-29T18:00:00+05:30"),
        record("GRN-6003", "GRN", "GRN/VE/15", 4, supplier="VoltEdge Switchgear", poId="PO-6003", lines=[line(15, "2500", "MCB-32A", "Switchboard MCB 32 A", 15)]),
        record("INV-6003", "INVOICE", "VE/INV/208", 6, supplier="VoltEdge Switchgear", poId="PO-6003", lines=[line(15, "2650", "MCB-32A", "Switchboard MCB 32 A")], netAmount="39750.00", taxes={"CGST": "3577.50", "SGST": "3577.50"}, amount="46905.00"),
    ]
    packconv = [
        record("PO-6004", "PO", "PO/2026/6004", 1, supplier="FerroFit Components", lines=[line(50, "120", "FIT-ELB90", "Elbow fitting 90 deg", uom="EA", packSize="10")], amount="7080.00", status="approved", dueAt="2026-10-27T18:00:00+05:30"),
        record("GRN-6004", "GRN", "GRN/FF/5BOX", 4, supplier="FerroFit Components", poId="PO-6004", lines=[line(5, "120", "FIT-ELB90", "Elbow fitting 90 deg box of 10", 5, uom="BOX")]),
        record("INV-6004", "INVOICE", "FF/INV/330", 6, supplier="FerroFit Components", poId="PO-6004", lines=[line(50, "120", "FIT-ELB90", "Elbow fitting 90 deg")], netAmount="6000.00", taxes={"IGST": "1080.00"}, amount="7080.00"),
        record("BANK-6004", "PAYMENT", "NEFT / FF/INV/330", 8, supplier="FerroFit Components", invoiceId="INV-6004", amount="7080.00", status="settled", utr="DEMO-UTR-904"),
    ]
    reversal = [
        record("PO-6005", "PO", "PO/2026/6005", 1, supplier="Kinetic Motor Co", lines=[line(40, "4500", "MTR-5KW", "Induction motor 5 kW")], amount="212400.00", status="approved", dueAt="2026-10-26T18:00:00+05:30"),
        record("GRN-6005", "GRN", "GRN/KM/40", 4, supplier="Kinetic Motor Co", poId="PO-6005", lines=[line(40, "4500", "MTR-5KW", "Induction motor 5 kW", 40)]),
        record("INV-6005", "INVOICE", "KM/INV/519", 5, supplier="Kinetic Motor Co", poId="PO-6005", lines=[line(40, "4500", "MTR-5KW", "Induction motor 5 kW")], netAmount="180000.00", taxes={"IGST": "32400.00"}, amount="212400.00"),
        record("BANK-6005A", "PAYMENT", "RTGS / KM/INV/519", 7, supplier="Kinetic Motor Co", invoiceId="INV-6005", amount="212400.00", status="settled", utr="DEMO-UTR-905", observedAt="2026-10-07T10:00:00+05:30"),
        record("BANK-6005B", "PAYMENT", "RTGS reversal / KM/INV/519", 9, supplier="Kinetic Motor Co", invoiceId="INV-6005", amount="212400.00", status="reversed", utr="DEMO-UTR-905"),
    ]
    proforma = [
        record("PO-6006", "PO", "PO/2026/6006", 1, supplier="NexaPanel Systems", lines=[line(60, "900", "PNL-DB12", "Distribution panel 12-way")], amount="63720.00", status="approved", dueAt="2026-10-25T18:00:00+05:30"),
        record("GRN-6006", "GRN", "GRN/NP/60", 4, supplier="NexaPanel Systems", poId="PO-6006", lines=[line(60, "900", "PNL-DB12", "Distribution panel 12-way", 60)]),
        record("PI-6006", "PROFORMA", "PI/NEX/118", 6, supplier="NexaPanel Systems", amount="63720.00"),
    ]
    unlinked = [
        record("PO-6007", "PO", "PO/LAB/6007", 1, supplier="SensorPro Devices", lines=[line(25, "1800", "SNS-PRX24", "Inductive proximity sensor 24V")], amount="53100.00", status="approved", dueAt="2026-10-31T18:00:00+05:30"),
        record("GRN-6007", "GRN", "GRN/SP/25", 4, supplier="SensorPro Devices", poId="PO-6007", lines=[line(25, "1800", "SNS-PRX24", "Inductive proximity sensor 24V", 25)]),
        record("INV-6007", "INVOICE", "SP/INV/611", 6, supplier="SensorPro Devices", lines=[line(25, "1800", "SNS-PRX24", "Inductive sensor, 24 V")], netAmount="45000.00", taxes={"IGST": "8100.00"}, amount="53100.00"),
    ]
    overdue = [
        record("PO-6008", "PO", "PO/2026/6008", 1, supplier="Transline Cables", lines=[line(100, "350", "CBL-4C16", "Control cable 4-core 16 sqmm", uom="M")], amount="41300.00", status="approved", dueAt="2026-10-05T18:00:00+05:30"),
        record("GRN-6008", "GRN", "GRN/TL/55", 4, supplier="Transline Cables", poId="PO-6008", lines=[line(55, "350", "CBL-4C16", "Control cable 4-core 16 sqmm", 55, uom="M")]),
        record("INV-6008", "INVOICE", "TL/INV/090", 6, supplier="Transline Cables", poId="PO-6008", lines=[line(55, "350", "CBL-4C16", "Control cable 4-core 16 sqmm", uom="M")], netAmount="19250.00", taxes={"IGST": "3465.00"}, amount="22715.00"),
    ]
    cases = []
    for identifier, title, sector, supplier, po_id, records in [
        ("pumps-1001", "Partial delivery, duplicate posting & split payments", "Industrial", "Meridian Pump Supply", "PO-1001", main),
        ("meters-2001", "Electrical meters · reconciled", "Electrical", "Meridian Pump Supply", "PO-2001", clean),
        ("balances-3001", "Inspection rejected two laboratory balances", "Laboratory", "Meridian Pump Supply", "PO-3001", inspection),
        ("valves-4001", "Import invoice in a conflicting currency", "Industrial", "Meridian Pump Supply", "PO-4001", fx),
        ("switches-5001", "Warehouse evidence is incomplete", "Electrical", "Meridian Pump Supply", "PO-5001", stale),
        ("bearings-6001", "Billed for 70 bearings, only 50 delivered", "Industrial", "Shakti Bearing Works", "PO-6001", overbill),
        ("centrifuges-6002", "Three centrifuges returned with supplier credit", "Laboratory", "PrecisionLab Instruments", "PO-6002", returned),
        ("switchboards-6003", "Invoice priced above the approved order", "Electrical", "VoltEdge Switchgear", "PO-6003", pricevariance),
        ("fittings-6004", "Box-pack fittings · fully reconciled", "Industrial", "FerroFit Components", "PO-6004", packconv),
        ("motors-6005", "Settled payment later reversed by the bank", "Industrial", "Kinetic Motor Co", "PO-6005", reversal),
        ("panels-6006", "Proforma on file, commercial invoice awaited", "Electrical", "NexaPanel Systems", "PO-6006", proforma),
        ("sensors-6007", "Supplier bill arrived without an order reference", "Laboratory", "SensorPro Devices", "PO-6007", unlinked),
        ("cables-6008", "Cable delivery overdue past promised date", "Electrical", "Transline Cables", "PO-6008", overdue),
    ]:
        cases.append({"id": identifier, "title": title, "sector": sector, "poId": po_id, "supplier": supplier, "records": deepcopy(records)})
    return {"company": {"id": "satya-demo", "name": "Satya Equipment Distribution", "country": "IN", "timezone": "Asia/Kolkata", "currency": "INR"}, "clock": "2026-10-10T12:00:00+05:30", "provenance": "CONSTRUCTED", "assumptions": ["All companies, records and UTR references are fictional.", "GST components are fixture assumptions, not HSN/rate/IRN verification.", "Bank status and references are simulated source observations; no real transfers."], "cases": cases}
