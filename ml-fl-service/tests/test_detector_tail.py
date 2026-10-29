from satya_engine.recon.detectors.core import (
    cross_entity_duplicate, exact_duplicate, invoiced_exceeds_accepted, over_delivery)
from satya_engine.recon.detectors.payments import bank_account_changed, pay_unallocated
from satya_engine.recon.detectors.terms import (
    einvoice_missing, ims_rejected_paid, not_in_gstr2b, rate_mismatch, rule37_risk)
from tests.test_recon_case import doc, line


def test_exact_duplicate_confirmed():
    inv1 = doc("I-1", "INVOICE_IN", [line(1, 4, 15000)],
               totals={"taxable": "60000", "cgst": "5400", "sgst": "5400",
                       "igst": "0", "cess": "0", "roundOff": "0", "grand": "70800"})
    inv2 = dict(inv1); inv2["id"] = "I-2"; inv2["observedAt"] = inv2["date"] + "T14:00:00Z"
    findings = exact_duplicate([inv1, inv2])
    assert findings[0]["code"] == "DUP_EXACT_INVOICE"
    assert findings[0]["certainty"] == "CONFIRMED"


def test_cross_entity_duplicate():
    inv1 = doc("I-1", "INVOICE_IN", [line(1, 1, 100)], entityId="ent-1", number="INV/50")
    inv2 = doc("I-2", "INVOICE_IN", [line(1, 1, 100)], entityId="ent-2", number="INV/50")
    findings = cross_entity_duplicate([inv1, inv2])
    assert findings[0]["code"] == "DUP_CROSS_ENTITY"
    assert findings[0]["certainty"] == "PROBABLE"


def test_invoiced_exceeds_accepted_ledger():
    ledger = {"PO-1": {1: type("C", (), {"invoiced_qty": 10, "accepted": 7,
                                       "ordered": 10, "delivered": 7})()}}
    findings = invoiced_exceeds_accepted(ledger)
    assert findings[0]["code"] == "QTY_INVOICED_EXCEEDS_ACCEPTED"


def test_over_delivery_ledger():
    ledger = {"PO-1": {1: type("C", (), {"delivered": 12, "ordered": 10,
                                       "invoiced_qty": 10, "accepted": 10})()}}
    findings = over_delivery(ledger)
    assert findings[0]["code"] == "QTY_OVER_DELIVERY"


def test_pay_unallocated():
    pay = doc("P-1", "PAYMENT_OUT", [line(1, 1, 0)],
              payment={"amount": "50000", "utr": "UTR1"})
    findings = pay_unallocated([pay], [])
    assert findings[0]["code"] == "PAY_UNALLOCATED"
    assert findings[0]["certainty"] == "POSSIBLE"


def test_bank_account_changed():
    pay1 = doc("P-1", "PAYMENT_OUT", [line(1, 1, 0)],
               payment={"amount": "1000", "bankAccountMasked": "…1234"})
    pay2 = doc("P-2", "PAYMENT_OUT", [line(1, 1, 0)],
               payment={"amount": "2000", "bankAccountMasked": "…9999"})
    findings = bank_account_changed([pay1, pay2])
    assert findings[0]["code"] == "PAY_BANK_ACCOUNT_CHANGED"


def test_rule37_past_180():
    old = doc("I-1", "INVOICE_IN", [line(1, 1, 100)], date="2025-01-01")
    recent = doc("P-1", "PAYMENT_OUT", [line(1, 1, 0)], date="2025-10-01")
    findings = rule37_risk([old, recent], [])
    assert findings[0]["code"] == "TAX_RULE37_RISK"


def test_einvoice_missing_when_aato_high():
    inv = doc("I-1", "INVOICE_OUT", [line(1, 1, 100)],
              gst={"supplyType": "B2B"})
    assert einvoice_missing([inv], {"tax": {"aatoBand": ">=10cr"}})[0]["code"] == "TAX_EINVOICE_MISSING"
    assert einvoice_missing([inv], {"tax": {"aatoBand": "5-10cr"}}) == []
    assert einvoice_missing([inv], {"tax": {"aatoBand": "<5cr"}}) == []


def test_not_in_gstr2b():
    inv = doc("I-1", "INVOICE_IN", [line(1, 1, 100)], number="INV/001")
    g2b = doc("G-1", "GSTR2B_ENTRY", [line(1, 1, 0)], number="INV/999",
              seller={"name": "Other"})
    findings = not_in_gstr2b([inv, g2b])
    assert findings[0]["code"] == "TAX_NOT_IN_GSTR2B"


def test_ims_rejected_paid():
    inv = doc("I-1", "INVOICE_IN", [line(1, 1, 100)])
    ims = doc("M-1", "IMS_ACTION", [line(1, 1, 0)], refs={"invoiceId": "I-1"}, action="REJECTED")
    links = [{"fromId": "P-1", "toId": "I-1", "kind": "SETTLES", "certainty": "CONFIRMED"}]
    findings = ims_rejected_paid([inv, ims], links)
    assert findings[0]["code"] == "TAX_IMS_REJECTED_BUT_PAID"


def test_rate_mismatch_uses_verified_master():
    from satya_engine.india.hsn_master import HsnMaster
    master = HsnMaster({
        "version": "test", "builtAt": "2026-10-01T00:00:00Z",
        "sources": [{"name": "manual", "url": "file://fixture", "retrievedAt": "2026-10-01T00:00:00Z",
                     "sha256": "a" * 64}],
        "codes": [{"code": "8413", "description": "Pumps", "chapter": "84"}],
        "rateRules": [{"prefix": "8413", "description": "Pumps", "rate": "18",
                       "schedule": "test", "sNo": "1", "effectiveFrom": "2020-01-01",
                       "notificationRef": "test"}]})
    inv = doc("I-1", "INVOICE_IN", [dict(line(1, 1, 100), hsn="8413")],
              totals={"taxable": "100", "cgst": "5", "sgst": "5",
                      "igst": "0", "cess": "0", "roundOff": "0", "grand": "110"})
    findings = rate_mismatch([inv], master)
    assert findings[0]["code"] == "TAX_RATE_MISMATCH"


def test_fy_cutoff():
    wrong = doc("I-1", "INVOICE_IN", [line(1, 1, 100)], date="2026-02-15", fy="2026-27")
    right = doc("I-2", "INVOICE_IN", [line(1, 1, 100)], date="2026-10-01", fy="2026-27")
    from satya_engine.recon.detectors.core import fy_cutoff
    findings = fy_cutoff([wrong, right])
    assert len(findings) == 1
    assert findings[0]["code"] == "DOC_FY_CUTOFF"
    assert findings[0]["evidence"][0]["documentId"] == "I-1"


def test_credit_note_pending():
    from satya_engine.recon.detectors.core import credit_note_pending
    cn = doc("CN-1", "CREDIT_NOTE_IN", [line(1, 1, 100)],
             totals={"taxable": "100", "cgst": "9", "sgst": "9", "igst": "0",
                     "cess": "0", "roundOff": "0", "grand": "118"})
    findings = credit_note_pending([cn], [])
    assert findings[0]["code"] == "DOC_CREDIT_NOTE_PENDING"
    applied = credit_note_pending([cn], [{"fromId": "CN-1", "toId": "I-1", "kind": "CREDITS",
                                          "certainty": "CONFIRMED"}])
    assert applied == []
