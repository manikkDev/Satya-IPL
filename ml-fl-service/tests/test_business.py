from copy import deepcopy
from decimal import Decimal
import unittest

from business_contracts import ReconcileRequest
from business_demo import demo_bundle
from business_reconcile import reconcile


class BusinessTests(unittest.TestCase):
    def request(self, index=0, **changes):
        fixture = demo_bundle()
        case = fixture["cases"][index]
        return ReconcileRequest(caseId=case["id"], companyId="satya-demo", poId=case["poId"], records=case["records"], observedBefore=fixture["clock"], **changes)

    def test_flagship(self):
        result = reconcile(self.request())
        ledger = result["ledger"]
        self.assertEqual(ledger["received"], "60")
        self.assertEqual(ledger["settled"], "50800.00")
        self.assertEqual(ledger["supportedOutstanding"], "20000.00")
        self.assertEqual(ledger["recordedOutstanding"], "90800.00")
        self.assertIsNone(ledger["canonicalOutstanding"])
        self.assertEqual(result["unallocatedPayments"][0]["amount"], "15000.00")
        self.assertIn("SUSPECTED_DUPLICATE_CHARGE", {finding["type"] for finding in result["findings"]})
        self.assertEqual(result["ambiguities"][0]["scope"], "invoice_settlement")

    def test_reviewed_duplicate(self):
        result = reconcile(self.request(confirmedDuplicates={"AP-992": "INV-041"}))
        self.assertEqual(result["ledger"]["canonicalOutstanding"], "20000.00")
        self.assertEqual(result["ledger"]["recordedOutstanding"], "90800.00")

    def test_remittance_to_other_invoice_does_not_reduce_main(self):
        result = reconcile(self.request(confirmedDuplicates={"AP-992": "INV-041"}, paymentAllocations={"BANK-T03": "INV-042"}))
        self.assertEqual(result["ledger"]["canonicalOutstanding"], "20000.00")
        self.assertEqual(result["unallocatedPayments"], [])

    def test_legitimate_partial_not_overdue(self):
        types = {finding["type"] for finding in reconcile(self.request())["findings"]}
        self.assertIn("EXPECTED_PARTIAL_FULFILLMENT", types)
        self.assertNotIn("OVERDUE_DELIVERY_SHORTFALL", types)

    def test_missing_order_reference_requires_reviewed_link(self):
        request = self.request(1)
        request.records[2].poId = None
        result = reconcile(request)
        self.assertIsNone(result["ledger"]["canonicalOutstanding"])
        self.assertTrue(result["matchSuggestions"])
        request.invoiceLinks = {"INV-2001": "PO-2001"}
        confirmed = reconcile(request)
        self.assertEqual(confirmed["ledger"]["canonicalOutstanding"], "0.00")
        self.assertTrue(any(edge["type"] == "CONFIRMED_MATCH" for edge in confirmed["graph"]["edges"]))

    def test_inspection(self):
        result = reconcile(self.request(2))
        self.assertEqual(result["ledger"]["accepted"], "8")
        self.assertIn("BILLED_ABOVE_ACCEPTED", {finding["type"] for finding in result["findings"]})

    def test_price_rounding_tolerance_does_not_erase_balance(self):
        request = self.request(1)
        invoice = request.records[2]
        invoice.lines[0].unitPrice = '2500.005'
        invoice.netAmount = '50000.10'
        invoice.amount = '59000.10'
        result = reconcile(request)
        self.assertNotIn('UNIT_PRICE_VARIANCE', {finding['type'] for finding in result['findings']})
        self.assertEqual(result['ledger']['canonicalOutstanding'], '0.10')
        self.assertEqual(result['ledger']['supportedOutstanding'], '0.10')

    def test_currency_conflict_is_not_converted(self):
        result = reconcile(self.request(3))
        self.assertIn("CURRENCY_CONFLICT", {finding["type"] for finding in result["findings"]})
        self.assertIsNone(result["ledger"]["canonicalOutstanding"])

    def test_incomplete_warehouse(self):
        types = {finding["type"] for finding in reconcile(self.request(4))["findings"]}
        self.assertIn("SOURCE_COVERAGE_GAP", types)
        self.assertNotIn("OVERDUE_DELIVERY_SHORTFALL", types)

    def test_no_future_observations(self):
        request = self.request()
        request.observedBefore = request.records[0].observedAt
        result = reconcile(request)
        self.assertEqual(result["ledger"]["received"], "0")
        self.assertEqual(result["ledger"]["recordedGross"], "0.00")

    def test_reorder_is_invariant(self):
        request = self.request()
        original = reconcile(request)
        request.records.reverse()
        self.assertEqual(original["ledger"], reconcile(request)["ledger"])

    def test_pending_payment_not_cash(self):
        request = self.request()
        request.records[6].status = "pending"
        self.assertEqual(reconcile(request)["ledger"]["settled"], "20800.00")

    def test_duplicate_source_id_rejected(self):
        request = self.request().model_dump(mode="json")
        request["records"].append(deepcopy(request["records"][0]))
        with self.assertRaises(ValueError):
            ReconcileRequest(**request)

    def test_money_numbers_rejected(self):
        request = self.request().model_dump(mode="json")
        request["records"][6]["amount"] = 30000.0
        with self.assertRaises(ValueError):
            ReconcileRequest(**request)

    def test_unknown_pack_does_not_invent_conversion(self):
        request = self.request()
        request.records[1].lines[0].uom = "BOX"
        result = reconcile(request)
        self.assertEqual(result["ledger"]["received"], "20")
        self.assertIn("UNKNOWN_UNIT_CONVERSION", {finding["type"] for finding in result["findings"]})

    def test_final_receipt_does_not_create_invoice(self):
        request = self.request(confirmedDuplicates={"AP-992": "INV-041"})
        extra = request.records[1].model_copy(deep=True)
        extra.id = "GRN-C"
        request.records.append(extra)
        result = reconcile(request)
        self.assertEqual(result["ledger"]["received"], "100")
        self.assertEqual(result["ledger"]["canonicalOutstanding"], "20000.00")

    def test_suspected_duplicate_cannot_consume_new_delivery_support(self):
        request = self.request()
        extra = request.records[1].model_copy(deep=True)
        extra.id = "GRN-C"
        request.records.append(extra)
        result = reconcile(request)
        self.assertEqual(result["ledger"]["received"], "100")
        self.assertEqual(result["ledger"]["supportedOutstanding"], "20000.00")
        self.assertEqual(result["ledger"]["disputedExposure"], "70800.00")
        self.assertIsNone(result["ledger"]["canonicalOutstanding"])

    def test_allocations_conserve_cash(self):
        result = reconcile(self.request())
        cash = sum(Decimal(item["amount"]) for item in result["paymentAllocations"])
        remainder = sum(Decimal(item["amount"]) for item in result["unallocatedPayments"])
        self.assertEqual(cash + remainder, Decimal("65800.00"))

    def test_invalid_reviewer_allocation_rejected(self):
        with self.assertRaises(ValueError):
            reconcile(self.request(paymentAllocations={"BANK-T03": "nonexistent"}))


if __name__ == "__main__":
    unittest.main()
