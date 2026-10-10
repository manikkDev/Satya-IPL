import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { automaticMapping, csvPayload, csvSource, inferCsvKind, orderCandidates, orderSubtotal, parseCsv, recordsCsv, requiredFields, validateOrderLines } from "./import-helpers.ts";
import { importSamples, purchaseOrderSample, sampleOrderId } from "./import-samples.ts";

test("CSV parsing preserves quoted commas, escaped quotes, BOM, CRLF and multiline values", () => {
  const result = parseCsv('\ufeffid,description\r\nPO-1,"Pump, model ""A""\nwith motor"\r\n');
  assert.deepEqual(result.columns, ["id", "description"]);
  assert.deepEqual(result.rows, [["PO-1", 'Pump, model "A"\nwith motor']]);
  assert.throws(() => parseCsv('id,id\n1,2'), /unique/);
  assert.throws(() => parseCsv('id,name\n1,"missing'), /unclosed/);
});

test("Mapping recognizes familiar headings but does not invent posting IDs or choose ambiguous columns", () => {
  const mapping = automaticMapping(["Record ID", "Supplier Name", "Currency", "Invoice Number", "Qty", "quantity", "Price Per Unit", "Unit"]);
  assert.equal(mapping.id, "Record ID");
  assert.equal(mapping.reference, "Invoice Number");
  assert.equal(mapping.quantity, "quantity");
  assert.equal(mapping.unitPrice, "Price Per Unit");
  assert.equal(mapping.uom, "Unit");
  assert.equal(automaticMapping(["Invoice Number"]).id, undefined);
  assert.equal(automaticMapping(["vendor", "supplier_name"]).supplier, undefined);
  assert.equal(inferCsvKind("sample-payments.csv"), "PAYMENT");
  assert.equal(inferCsvKind("random-export.csv"), "");
});

test("Sample files in docs exactly match the downloadable samples and map without required-field gaps", async () => {
  for (const sample of [...importSamples, purchaseOrderSample]) {
    const stored = await readFile(new URL(`../../../docs/${sample.name}`, import.meta.url), "utf8");
    assert.equal(stored, sample.content);
    const file = csvSource(sample.name, sample.content, sample.recordType);
    assert.deepEqual(requiredFields(file.recordType).filter((field) => !file.mapping[field]), []);
    assert.ok(file.rows.every((row) => row.length === file.columns.length));
  }
  const files = importSamples.map((sample) => csvSource(sample.name, sample.content));
  assert.deepEqual(orderCandidates(files), [sampleOrderId]);
  assert.equal(files.reduce((count, file) => count + file.rows.length, 0), 8);
  assert.ok(!("columns" in csvPayload("Test order", sampleOrderId, files).files[0]));
});

test("Order totals use exact arithmetic, aggregate before rounding and enforce bounded decimals", () => {
  assert.equal(orderSubtotal([{ quantity:"1", unitPrice:"0.10" }, { quantity:"1", unitPrice:"0.20" }]), "0.30");
  assert.equal(orderSubtotal([{ quantity:"1", unitPrice:"1.005" }, { quantity:"1", unitPrice:"1.005" }]), "2.01");
  assert.equal(orderSubtotal([{ quantity:"1000000000000", unitPrice:"1000000000000" }]), "1000000000000000000000000.00");
  assert.throws(() => orderSubtotal([{ quantity:"1", unitPrice:"1e3" }]), /plain/);
  assert.throws(() => validateOrderLines([{ description:"Pump", quantity:"0", unitPrice:"10" }]), /greater than zero/);
  assert.throws(() => validateOrderLines([{ description:"Pump", quantity:"-1", unitPrice:"10" }]), /plain/);
});

test("PO CSV export keeps record IDs distinct from line IDs and escapes spreadsheet formula text", () => {
  const csv = recordsCsv([{ id:"PO-TEST-1", type:"PO", reference:"PO/TEST/1", source:"form", supplier:"=SUM(1,2)", currency:"INR", status:"approved", occurredAt:"2026-10-01T10:00:00+05:30", observedAt:"2026-10-01T10:00:00+05:30", lines:[{ id:"ITEM-1", description:"Pump", quantity:"10", unitPrice:"1250", uom:"EA" }] }]);
  const { columns, rows } = parseCsv(csv);
  assert.equal(rows[0][columns.indexOf("id")], "PO-TEST-1");
  assert.equal(rows[0][columns.indexOf("lineId")], "ITEM-1");
  assert.equal(rows[0][columns.indexOf("supplier")], "'=SUM(1,2)");
});
