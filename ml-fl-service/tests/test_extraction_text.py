import json
from decimal import Decimal
from pathlib import Path

import pytest

from satya_engine.docs import parse
from satya_engine.extraction.normalize import find_amounts, normalize_doc_type, parse_amount, parse_date
from satya_engine.extraction.text_fields import parse_text

EVAL_DIR = Path(__file__).resolve().parents[1] / "data" / "eval" / "extraction"
HAVE_FIXTURES = (EVAL_DIR / "ground_truth.json").exists()

LAYOUT = """\
                         TAX INVOICE
Supplier:                                   Bill To:
Shree Industries Pvt Ltd                    Acme Buyer Ltd
GSTIN: 27AAACR5055K1Z7                      GSTIN: 29AAACC1206D1ZC
Invoice No. : SIS/26-27/0067                Dated : 07-May-26
Buyer's Order No. : PO-1001
Sl  Description          HSN        Qty        Rate          Amount
1   Centrifugal Pump     84137010    60    3,000.00      1,80,000.00
2   Ball Valve 2 inch    84818030    50    3,000.00      1,50,000.00
                                     Taxable Value         3,30,000.00
                                     IGST @ 18%              59,400.00
                                     Round Off                   (-)0.40
                                     Grand Total           3,89,399.60
Amount Chargeable (in words): Rupees Three Lakh Eighty Nine Thousand Only
"""


@pytest.mark.parametrize("raw,expected", [
    ("3,30,855.00", "330855.00"), ("Rs. 1,234.50", "1234.50"), ("INR 330,855.00", "330855.00"),
    ("₹ 70800", "70800"), ("(-) 0.35", "-0.35"), ("-0.47", "-0.47"), (330855.0, "330855.0"), ("abc", None),
])
def test_parse_amount(raw, expected):
    value = parse_amount(raw)
    assert (value is None and expected is None) or value == Decimal(expected)


@pytest.mark.parametrize("raw,iso", [
    ("07/05/2026", "2026-05-07"), ("07-05-2026", "2026-05-07"), ("07.05.2026", "2026-05-07"),
    ("07 May 2026", "2026-05-07"), ("07-May-26", "2026-05-07"), ("2026-05-07", "2026-05-07"),
    ("7th Sept 2025", "2025-09-07"), ("May 07, 2026", "2026-05-07"), ("31/02/2026", None), ("hello", None),
])
def test_parse_date(raw, iso):
    assert parse_date(raw) == iso


def test_amount_tokens_skip_percentages_and_document_numbers():
    values = [a[0] for a in find_amounts("CGST @ 9%  27,000.00  INV-2026-00123")]
    assert values == [Decimal("27000.00")]


def test_doc_type_normalisation():
    assert normalize_doc_type("invoice") == "INVOICE_IN"
    assert normalize_doc_type("Tax Invoice") == "INVOICE_IN"
    assert normalize_doc_type("INVOICE_IN") == "INVOICE_IN"
    assert normalize_doc_type("credit note") == "CREDIT_NOTE_IN"
    assert normalize_doc_type("memo") is None


def test_layout_text_fields_roles_totals_and_lines():
    result = parse_text(LAYOUT)
    assert result["type"]["value"] == "INVOICE_IN"
    assert result["number"]["value"] == "SIS/26-27/0067"
    assert result["date"]["value"] == "2026-05-07"
    assert result["parties"]["seller"]["gstin"]["value"] == "27AAACR5055K1Z7"
    assert result["parties"]["buyer"]["gstin"]["value"] == "29AAACC1206D1ZC"
    assert result["parties"]["seller"]["name"]["value"] == "Shree Industries Pvt Ltd"
    assert result["parties"]["buyer"]["name"]["value"] == "Acme Buyer Ltd"
    assert result["poReference"]["value"] == "PO-1001"
    totals = {k: v["value"] for k, v in result["totals"].items()}
    assert totals["taxable"] == Decimal("330000.00")
    assert totals["igst"] == Decimal("59400.00")
    assert totals["roundOff"] == Decimal("-0.40")
    assert totals["grand"] == Decimal("389399.60")
    assert result["totalsClose"] is True
    assert [(l["qty"], l["rate"], l["taxableValue"], l["hsn"]) for l in result["lines"]] == [
        ("60", "3000", "180000.00", "84137010"), ("50", "3000", "150000.00", "84818030")]
    assert result["lines"][1]["description"] == "Ball Valve 2 inch"


def test_title_beats_a_purchase_order_reference():
    text = "Purchase Order No.: PO-77\n          TAX INVOICE\nInvoice No: A/1"
    assert parse_text(text)["type"]["value"] == "INVOICE_IN"
    assert parse_text("PURCHASE ORDER\nPO No: 4500012345")["type"]["value"] == "PO"
    assert parse_text("PURCHASE ORDER\nPO No: 4500012345")["number"]["value"] == "4500012345"


def test_swapped_rate_qty_columns_use_the_header():
    text = ("S.No  Item              HSN         Rate        Qty  UOM    Taxable Value\n"
            "1     Packing Material  39232990   60777.14     631  KGS     38350375.34\n")
    line = parse_text(text)["lines"][0]
    assert (line["qty"], line["rate"]) == ("631", "60777.14")


def _truth():
    return json.loads((EVAL_DIR / "ground_truth.json").read_text())["documents"]


def _pick():
    if not HAVE_FIXTURES:
        return []
    docs, seen = [], set()
    for doc in _truth():
        key = (doc["template"], doc["twoPage"])
        if key not in seen:
            seen.add(key)
            docs.append(doc)
    return docs


@pytest.mark.skipif(not HAVE_FIXTURES, reason="eval fixtures not mounted")
@pytest.mark.parametrize("doc", _pick(), ids=lambda d: f"{d['template']}{'-2page' if d['twoPage'] else ''}")
def test_generated_pdfs_parse_exactly(doc):
    result = parse((EVAL_DIR / doc["file"]).read_bytes(), "application/pdf")
    fields = result["fields"]
    assert result["method"] == "pdf_text"
    assert fields["number"]["value"] == doc["number"]
    assert fields["date"]["value"] == doc["date"]
    assert fields["seller"]["value"]["gstin"] == doc["seller"]["gstin"]
    assert fields["buyer"]["value"]["gstin"] == doc["buyer"]["gstin"]
    assert fields["seller"]["value"]["stateCode"] == doc["seller"]["stateCode"]
    for key in ("taxable", "cgst", "sgst", "igst", "roundOff", "grand"):
        assert Decimal(fields["totals"]["value"][key]) == Decimal(doc["totals"][key]), key
    assert len(result["lines"]) == doc["lineCount"]
    for got, want in zip(result["lines"], doc["lines"]):
        assert Decimal(got["qty"]) == Decimal(want["qty"])
        assert Decimal(got["rate"]) == Decimal(want["rate"])
        assert Decimal(got["amount"]) == Decimal(want["amount"])
    assert fields["totals"]["confidence"] >= 0.95 and not fields["totals"]["needsReview"]
    assert result["coverage"]["ratio"] == 1.0
    if doc["twoPage"]:
        assert result["pages"] == 2


@pytest.mark.skipif(not HAVE_FIXTURES, reason="eval fixtures not mounted")
def test_backward_compatible_parse_keys():
    doc = _truth()[0]
    result = parse((EVAL_DIR / doc["file"]).read_bytes(), "application/pdf")
    for key in ("detectedType", "method", "pages", "textLayer", "qr", "extracted", "needsLlm", "pageImages",
                "issues", "text"):
        assert key in result
    assert result["needsLlm"] is False and result["llmRecommended"] is False
    assert result["extracted"]["seller"]["gstin"] == doc["seller"]["gstin"]
