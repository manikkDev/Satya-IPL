import unittest

from business_imports import PreviewRequest, preview


class ImportTests(unittest.TestCase):
    def file(self, content, mapping=None, number_format="plain"):
        return {"name": "purchase-orders.csv", "recordType": "PO", "source": "procurement_export", "content": content, "mapping": mapping or {key: key for key in ["id", "reference", "supplier", "currency", "occurredAt", "status", "lineId", "description", "quantity", "unitPrice", "uom"]}, "numberFormat": number_format}

    def request(self, files):
        return PreviewRequest(title="Source import preview", poId="PO-1", files=files, ingestedAt="2026-10-10T12:00:00+05:30")

    def test_csv_preserves_ids_and_provenance(self):
        content = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\nPO-1,PO/0001,Example Supplier,INR,2026-10-01T10:00:00+05:30,approved,01,Pump 1 kW,10,1000,EA\n'
        result = preview(self.request([self.file(content)]))
        self.assertTrue(result["canCommit"])
        record = result["records"][0]
        self.assertEqual(record["reference"], "PO/0001")
        self.assertEqual(record["lines"][0]["id"], "01")
        self.assertEqual(record["coverage"], "unknown")
        self.assertEqual(record["fieldEvidence"]["lines/01/quantity"]["row"], 2)
        self.assertEqual(record["fieldEvidence"]["lines/01/quantity"]["column"], "quantity")
        self.assertEqual(record["observedAt"], "2026-10-10T12:00:00+05:30")

    def test_bad_numeric_row_blocks_entire_commit(self):
        content = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\nPO-1,PO/0001,Example Supplier,INR,2026-10-01T10:00:00+05:30,approved,1,Pump,not-a-number,1000,EA\n'
        result = preview(self.request([self.file(content)]))
        self.assertFalse(result["canCommit"])
        self.assertGreater(result["issueCount"], 0)
        self.assertEqual(result["records"], [])

    def test_indian_separators_require_declared_format(self):
        content = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\nPO-1,PO/0001,Example Supplier,INR,2026-10-01T10:00:00+05:30,approved,1,Pump,1,"₹1,18,000.00",EA\n'
        self.assertFalse(preview(self.request([self.file(content)]))["canCommit"])
        result = preview(self.request([self.file(content, number_format="en-IN")]))
        self.assertTrue(result["canCommit"])
        self.assertEqual(result["records"][0]["lines"][0]["unitPrice"], "118000.00")
        self.assertEqual(result["records"][0]["fieldEvidence"]["lines/1/unitPrice"]["rawValue"], "₹1,18,000.00")

    def test_conflicting_header_rows_are_not_silently_merged(self):
        header = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\n'
        content = header + 'PO-1,PO/0001,Supplier A,INR,2026-10-01T10:00:00+05:30,approved,1,Pump,1,1000,EA\nPO-1,PO/0001,Supplier B,INR,2026-10-01T10:00:00+05:30,approved,2,Valve,1,1000,EA\n'
        result = preview(self.request([self.file(content)]))
        self.assertFalse(result["canCommit"])
        self.assertTrue(any("header" in issue["message"].lower() for issue in result["issues"]))

    def test_multiple_lines_do_not_duplicate_header_total(self):
        header = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\n'
        content = header + 'PO-1,PO/0001,Supplier A,INR,2026-10-01T10:00:00+05:30,approved,1,Pump,1,1000,EA\nPO-1,PO/0001,Supplier A,INR,2026-10-01T10:00:00+05:30,approved,2,Valve,2,500,EA\n'
        result = preview(self.request([self.file(content)]))
        self.assertTrue(result["canCommit"])
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(len(result["records"][0]["lines"]), 2)

    def test_missing_currency_is_not_guessed(self):
        content = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\nPO-1,PO/0001,Example Supplier,,2026-10-01T10:00:00+05:30,approved,1,Pump,1,1000,EA\n'
        self.assertFalse(preview(self.request([self.file(content)]))["canCommit"])

    def test_same_file_repeated_does_not_create_new_records(self):
        content = 'id,reference,supplier,currency,occurredAt,status,lineId,description,quantity,unitPrice,uom\nPO-1,PO/0001,Example Supplier,INR,2026-10-01T10:00:00+05:30,approved,1,Pump,1,1000,EA\n'
        result = preview(self.request([self.file(content), self.file(content)]))
        self.assertTrue(result["canCommit"])
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["duplicateFilesIgnored"], 1)

    def test_missing_mapping_column_is_explained(self):
        result = preview(self.request([self.file("id,reference\nPO-1,PO/1\n")]))
        self.assertFalse(result["canCommit"])
        self.assertTrue(result["issues"])


if __name__ == "__main__":
    unittest.main()
