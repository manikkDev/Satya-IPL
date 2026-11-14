// Unit tests for the import pipeline's pure parts: readers, bank layout
// detection, MT940, Tally XML, templates, GSTR-2B matching, date rules and
// the strict auto-allocation rule. No database or network needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const samples = path.join(here, "..", "..", "docs", "samples");
const sample = (p) => readFileSync(path.join(samples, p));

const { parseCsv, toCsv } = await import("../src/services/importers/csv.js");
const { parseXml, findAll, textOf, decodeText } = await import("../src/services/importers/xml.js");
const { parseXlsx, buildXlsx } = await import("../src/services/importers/xlsx.js");
const { parseDate, parseAmount, parseQty, normName, checkGstin, normGstRate } = await import("../src/services/importers/normalize.js");
const { detectBankLayout, readBankRows, parseMt940, utrOf, modeOf, counterpartyOf } = await import("../src/services/importers/bank.js");
const { parseTallyXml, tallyTypeFor } = await import("../src/services/importers/tally.js");
const { keyedRows, recordsFromTemplate, templateRows, TEMPLATES } = await import("../src/services/importers/templates.js");
const { matchSets, variantNo } = await import("../src/services/gstr2bMatch.js");
const { evaluateDateRules, mergeFindings } = await import("../src/services/dateRules.js");
const { exactMatch, tdsOn, tdsRateFor } = await import("../src/services/allocation.js");
const { flattenGstr2b } = await import("../src/services/importers/index.js");
const { computeTotals } = await import("../src/services/importers/resolve.js");

test("normalisers: Indian dates, amounts, quantities, names, GSTIN", () => {
  assert.equal(parseDate("13/11/26"), "2026-11-13");
  assert.equal(parseDate("01-Nov-2026"), "2026-11-01");
  assert.equal(parseDate("1 Nov 2026"), "2026-11-01");
  assert.equal(parseDate("20261112"), "2026-11-12");
  assert.equal(parseDate("2026-11-05"), "2026-11-05");
  assert.equal(parseDate("31/02/2026"), null);
  assert.equal(parseDate("46339"), "2026-11-13"); // Excel serial
  assert.deepEqual(parseAmount("3,12,671.00"), { value: "312671.00", sign: 1 });
  assert.deepEqual(parseAmount("₹ 1,245.5 Cr"), { value: "1245.50", sign: 1 });
  assert.deepEqual(parseAmount("(500.00)"), { value: "500.00", sign: -1 });
  assert.deepEqual(parseAmount("1,000.00 Dr"), { value: "1000.00", sign: -1 });
  assert.equal(parseAmount("abc"), null);
  assert.deepEqual(parseQty(" 8 Nos"), { qty: "8", uom: "EA" });
  assert.deepEqual(parseQty("2.500 Kgs"), { qty: "2.5", uom: "KG" });
  assert.equal(normName("M/s. Shakti Industrial Suppliers Pvt. Ltd."), "shakti industrial suppliers");
  assert.equal(checkGstin("27AAKCS4821M1ZW").ok, true);
  assert.equal(checkGstin("27AAHCB2290K1ZX").ok, false);
  assert.equal(normGstRate("18%"), "18");
  assert.equal(normGstRate("17"), undefined);
});

test("csv: quotes, embedded commas, BOM, delimiter detection, round trip", () => {
  const { rows } = parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""",3\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'he said "hi"', "3"]]);
  assert.equal(parseCsv("a;b;c\n1;2;3\n").delimiter, ";");
  assert.deepEqual(parseCsv(toCsv([["a,b", "c"]])).rows, [["a,b", "c"]]);
});

test("xlsx: a written workbook reads back (shared + inline strings)", () => {
  const buf = buildXlsx([["Item code", "Description"], ["PMP-1", "Pump, 5 HP"]], "Items");
  const { rows, sheets } = parseXlsx(buf);
  assert.deepEqual(sheets, ["Items"]);
  assert.deepEqual(rows, [["Item code", "Description"], ["PMP-1", "Pump, 5 HP"]]);
});

test("xml: UTF-16 LE (Tally default) and entities", () => {
  const xml = '<A><B NAME="x &amp; y">1&#4;2 &lt;3</B></A>';
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
  assert.equal(decodeText(buf), xml);
  const root = parseXml(buf);
  const b = findAll(root, "B")[0];
  assert.equal(b.attrs.NAME, "x & y");
  assert.equal(textOf(b), "12 <3");
});

test("bank: HDFC sample — layout detected, footer skipped, UTRs read", () => {
  const { rows } = parseCsv(sample("bank/hdfc-statement-nov-2026.csv"));
  const layout = detectBankLayout(rows);
  assert.equal(layout.bank, "HDFC");
  assert.equal(layout.headerIndex, 6);
  const { lines, issues } = readBankRows(rows, layout);
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(lines.length, 8);
  const godavari = lines.find((l) => l.amount === "312671.00");
  assert.equal(godavari.utr, "HDFCR52026111300418871");
  assert.equal(godavari.mode, "RTGS");
  assert.equal(godavari.direction, "debit");
  assert.equal(lines.find((l) => l.direction === "credit").amount, "1245.00");
  assert.equal(lines.find((l) => /IMPS/.test(l.narration)).utr, "631612345678");
});

test("bank: header layouts of ICICI, SBI, Axis, Kotak and Dr/Cr amount columns", () => {
  const cases = [
    [["S No.", "Value Date", "Transaction Date", "Cheque Number", "Transaction Remarks", "Withdrawal Amount (INR )", "Deposit Amount (INR )", "Balance (INR )"], "ICICI"],
    [["Txn Date", "Value Date", "Description", "Ref No./Cheque No.", "Branch Code", "Debit", "Credit", "Balance"], "SBI"],
    [["Tran Date", "CHQNO", "PARTICULARS", "DR", "CR", "BAL", "SOL"], "Axis"],
    [["Sl. No.", "Transaction Date", "Value Date", "Description", "Chq / Ref No.", "Debit", "Credit", "Balance"], "Kotak"],
  ];
  for (const [header, bank] of cases) {
    const layout = detectBankLayout([["Account statement"], header]);
    assert.ok(layout, bank);
    assert.equal(layout.bank, bank, header.join("|"));
    assert.equal(layout.headerIndex, 1);
  }
  const drcr = [["Date", "Description", "Amount", "Dr / Cr", "Balance"], ["05-11-2026", "NEFT TO X", "1,000.00", "DR", "9,000.00"], ["06-11-2026", "INTEREST", "10.00", "CR", "9,010.00"]];
  const layout = detectBankLayout(drcr);
  const { lines } = readBankRows(drcr, layout);
  assert.deepEqual(lines.map((l) => [l.direction, l.amount]), [["debit", "1000.00"], ["credit", "10.00"]]);
});

test("bank: narration helpers", () => {
  assert.equal(utrOf("NEFT DR-SBIN0004261-SHAKTI INDUSTRIAL SUPPLIERS-NETBANK MUM-HDFCN26318804117-PART", ""), "HDFCN26318804117");
  assert.equal(modeOf("BY CLG CHQ 004512"), "CHEQUE");
  assert.equal(counterpartyOf("NEFT DR-SBIN0004261-SHAKTI INDUSTRIAL SUPPLIERS-NETBANK MUM-HDFCN26318804117-PART"), "SHAKTI INDUSTRIAL SUPPLIERS");
});

test("mt940: sample statement parses with balances and narrations", () => {
  const { statements, issues } = parseMt940(sample("bank/hdfc-cms-mt940-nov-2026.sta"));
  assert.equal(issues.length, 0);
  assert.equal(statements.length, 1);
  const s = statements[0];
  assert.equal(s.account, "HDFC0001207/50200041127741");
  assert.equal(s.opening.amount, "1276736.95");
  assert.equal(s.closing.amount, "1360120.95");
  assert.equal(s.lines.length, 4);
  assert.deepEqual(s.lines.map((l) => l.direction), ["debit", "debit", "debit", "credit"]);
  assert.equal(s.lines[0].utr, "HDFCN26321440051");
  assert.match(s.lines[0].narration, /DVI\/26-27\/0134/);
  assert.equal(s.lines[3].utr, "HDFCR42026111700098812");
});

test("tally: day book sample -> suppliers, items, typed documents", () => {
  const out = parseTallyXml(sample("tally/tally-daybook-nov-2026.xml"));
  assert.equal(out.suppliers.length, 3);
  const phs = out.suppliers.find((s) => s.gstin === "27AAJFP5523R1ZJ");
  assert.equal(phs.msmeCategory, "micro");
  assert.equal(phs.udyam, "UDYAM-MH-26-0219874");
  assert.equal(phs.paymentTermsDays, 30);
  assert.equal(out.items.length, 2);
  assert.equal(out.items.find((i) => i.code === "PMP-CF-3HP").hsn, "84137010");
  assert.deepEqual(out.stats.byType, { GRN: 1, INVOICE_IN: 1, RETURN: 1, DEBIT_NOTE_OUT: 1, PO: 1, PAYMENT_OUT: 1 });
  assert.equal(out.stats.skipped.Sales, 1);
  const inv = out.documents.find((d) => d.type === "INVOICE_IN");
  assert.equal(inv.number, "SIS/26-27/0241");
  assert.equal(inv.date, "2026-11-13");
  assert.equal(inv.invoiceDate, "2026-11-12");
  assert.deepEqual(inv.totals, { taxable: "134800.00", cgst: "3370.00", sgst: "3370.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "141540.00" });
  assert.equal(inv.lines[0].poNumber, "SATYAD/PO/26-27/000035");
  assert.equal(inv.lines[0].grnNumber, "RN/26-27/0412");
  assert.equal(inv.lines[0].gstRate, "5");
  assert.equal(inv.terms.creditDays, 45);
  const dn = out.documents.find((d) => d.type === "DEBIT_NOTE_OUT");
  assert.equal(dn.refs.invoiceNumber, "SIS/26-27/0241");
  assert.equal(dn.totals.grand, "17692.50");
  const pay = out.documents.find((d) => d.type === "PAYMENT_OUT");
  assert.equal(pay.payment.amount, "43660.00");
  assert.equal(pay.payment.utr, "HDFCN26318702219");
  assert.equal(pay.payment.mode, "NEFT");
  assert.deepEqual(pay.payment.allocations, [{ invoiceNumber: "IFH-0480", amount: "43660.00" }]);
  assert.equal(tallyTypeFor("Purchase GST", new Map([["Purchase GST", "Purchase"]])), "INVOICE_IN");
  assert.equal(tallyTypeFor("Receipt"), null);
  assert.equal(tallyTypeFor("Receipt Note"), "GRN");
});

test("templates: every sample maps and validates as expected", () => {
  for (const kind of Object.keys(TEMPLATES)) {
    const [header, example] = templateRows(kind);
    const keyed = keyedRows(kind, [header, example]);
    assert.deepEqual(keyed.missing, [], kind);
  }
  const sup = keyedRows("suppliers", parseCsv(sample("templates/suppliers.csv")).rows);
  const recs = recordsFromTemplate("suppliers", sup.rows, "csv");
  assert.equal(recs.length, 4);
  assert.equal(recs[0].bank.ifsc, "HDFC0000146");
  assert.equal(recs[1].tdsSection, "194Q");
  assert.equal(recs[1].aatoBand, ">=10cr");
  assert.ok(recs[3].issues.some((i) => i.severity === "error" && i.field === "gstin"));
  const inv = keyedRows("purchase_invoices", parseCsv(sample("templates/purchase-invoices.csv")).rows);
  const invRecs = recordsFromTemplate("purchase_invoices", inv.rows, "csv");
  assert.equal(invRecs.length, 1);
  assert.equal(invRecs[0].lines.length, 2);
  assert.equal(invRecs[0].totals.grand, "111510.00");
  assert.equal(invRecs[0].issues.filter((i) => i.severity === "error").length, 0, JSON.stringify(invRecs[0].issues));
  // synonyms: a customer's own headings still map
  const own = keyedRows("purchase_invoices", [["Bill No", "Bill Date", "Vendor GSTIN", "Invoice Value"], ["A-1", "01/11/2026", "27AAHCS6742Q1ZJ", "1180"]]);
  assert.deepEqual(own.missing, []);
});

test("totals: intra vs inter-state GST split", () => {
  const lines = [{ qty: "20", rate: "3200.00", gstRate: "18" }, { qty: "50", rate: "610.00", gstRate: "18" }];
  assert.deepEqual(computeTotals(lines, "27", "27"), { taxable: "94500.00", cgst: "8505.00", sgst: "8505.00", igst: "0.00", cess: "0.00", roundOff: "0.00", grand: "111510.00" });
  assert.equal(computeTotals(lines, "29", "27").igst, "17010.00");
});

test("gstr2b: official JSON flattens; matcher classifies every outcome", () => {
  const flat = flattenGstr2b(JSON.parse(sample("gst/gstr2b-27AAKCS4821M1ZW-102026.json")));
  assert.equal(flat.period, "2026-10");
  assert.equal(flat.entries.length, 7);
  assert.equal(variantNo("DVI/2026-27/134"), variantNo("DVI/26-27/0134"));
  const entry = (id, gstin, number, date, totals) => ({ id, number, date, fy: "2026-27", seller: { gstin }, totals, gst: { gstr2bPeriod: "2026-10" } });
  const book = (id, gstin, number, date, totals) => ({ id, number, date, fy: "2026-27", _gstin: gstin, totals });
  const t = (taxable, cgst, grand) => ({ taxable, cgst, sgst: cgst, igst: "0", cess: "0", grand });
  const entries = [
    entry("e1", "G1", "A/26-27/001", "2026-10-02", t("100", "9", "118")),
    entry("e2", "G1", "A/2026-27/2", "2026-10-03", t("100", "9", "118")),
    entry("e3", "G2", "B-9", "2026-10-04", t("100", "6", "112")),
    entry("e4", "G3", "C-1", "2026-10-05", t("100", "9", "118")),
  ];
  const books = [
    book("b1", "G1", "A/26-27/001", "2026-10-02", t("100", "9", "118")),
    book("b2", "G1", "A/26-27/002", "2026-10-03", t("100", "9", "118.50")),
    book("b3", "G2", "B-9", "2026-10-04", t("100", "9", "118")),
    book("b4", "G2", "B-10", "2026-10-20", t("100", "9", "118")),
    book("b5", "G2", "B-11", "2026-11-02", t("100", "9", "118")),
    book("b6", "G2", "B-8", "2026-09-02", t("100", "9", "118")),
  ];
  const tol = { tax: 100n, value: 100n };
  const { invoiceResults, entryResults } = matchSets(books, entries, tol, ["2026-10"]);
  const st = Object.fromEntries(invoiceResults.map((r) => [r.invoiceId, `${r.status}:${r.basis}`]));
  assert.deepEqual(st, { b1: "matched:exact", b2: "matched:number_variant", b3: "amount_differs:exact", b4: "only_in_books:null", b5: "pending_2b:null", b6: "before_2b_import:null" });
  assert.equal(entryResults.find((r) => r.entryId === "e4").status, "only_in_2b");
});

test("date rules: MSME deadline, Rule 37, late e-invoice, GSTR-2B status", () => {
  const sup = { id: "s1", udyam: { category: "micro" }, paymentTermsDays: 30, aatoBand: ">=10cr" };
  const invoices = [
    { id: "i1", number: "X-1", date: "2026-10-01", supplierId: "s1", totals: { taxable: "1000", cgst: "90", sgst: "90", grand: "1180" } },
    { id: "i2", number: "X-2", date: "2026-05-01", supplierId: "s1", totals: { taxable: "1000", cgst: "90", sgst: "90", grand: "1180" }, gst: { irn: "abc", ackDate: "2026-06-20T10:00:00+05:30", gstr2b: { status: "only_in_books" } } },
    { id: "i3", number: "X-3", date: "2026-11-10", supplierId: "s1", totals: { taxable: "1000", cgst: "90", sgst: "90", grand: "1180" } },
  ];
  const out = evaluateDateRules({ invoices, suppliersById: new Map([["s1", sup]]), settled: new Map([["i3", 118000n]]), acceptance: new Map(), today: "2026-11-14" });
  const codes = out.map((f) => `${f.code}:${f.evidence[0].documentId}:${f.severity}`).sort();
  assert.deepEqual(codes, [
    "MSME_43BH_DEADLINE:i1:high", "MSME_43BH_DEADLINE:i2:high", "TAX_EINVOICE_LATE:i2:high",
    "TAX_NOT_IN_GSTR2B:i2:medium", "TAX_RULE37_RISK:i2:high",
  ]);
  const merged = mergeFindings([{ code: "TAX_RULE37_RISK", evidence: [{ documentId: "i2" }] }, { code: "DUP", evidence: [] }], out, invoices);
  assert.equal(merged.filter((f) => f.code === "TAX_RULE37_RISK").length, 1);
  assert.equal(merged.filter((f) => f.code === "DUP").length, 1);
});

test("auto-allocation: only an exact, unique, referenced match qualifies", () => {
  const supplier = { id: "s1", tdsSection: "194Q", pan: "AABCG1187E" };
  const open = [
    { id: "inv1", number: "GEM/26-27/04131", openAmount: "312936.00", taxable: "265200.00", supplierId: "s1" },
    { id: "inv2", number: "GEM/26-27/04200", openAmount: "312936.00", taxable: "265200.00", supplierId: "s1" },
  ];
  assert.equal(tdsOn("265200.00", "0.1"), 26500n); // ₹265.20 -> ₹265
  const net = exactMatch({ payment: { payment: { amount: "312671.00" } }, supplier, openInvoices: open, narration: "RTGS DR GODAVARI GEM 26-27 04131" });
  assert.equal(net.invoice?.id, "inv1");
  assert.equal(net.rule, "exact_net_of_tds");
  assert.equal(net.tds.amount, "265.00");
  const gross = exactMatch({ payment: { payment: { amount: "312936.00" } }, supplier, openInvoices: open, narration: "GEM/26-27/04131" });
  assert.equal(gross.rule, "exact_gross");
  assert.ok(exactMatch({ payment: { payment: { amount: "300000.00" } }, supplier, openInvoices: open, narration: "GEM/26-27/04131" }).reason);
  assert.ok(exactMatch({ payment: { payment: { amount: "312936.00" } }, supplier, openInvoices: open, narration: "OCT BILLS" }).reason);
  assert.ok(exactMatch({ payment: { payment: { amount: "312936.00" } }, supplier: null, openInvoices: open, narration: "GEM/26-27/04131" }).reason);
  assert.ok(exactMatch({ payment: { payment: { amount: "312936.00" } }, supplier, openInvoices: open, narration: "GEM/26-27/04131 + GEM/26-27/04200" }).reason, "two referenced invoices with the same amount is ambiguous");
  assert.deepEqual(tdsRateFor({ tdsSection: "194C", pan: "CQPPP4408F" }), { section: "194C", rate: "1" });
});
