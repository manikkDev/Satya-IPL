import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDocument, classifyDocumentType, loadSchema, contentParts, toImagePart } from "../../src/extract/extract.js";

const llmOk = (text) => ({
  async generate() {
    return { ok: true, text, raw: {}, model: "gemini-2.5-flash", usage: { inputTokens: 100, outputTokens: 40 } };
  },
});
const llmDead = {
  async generate() {
    return { ok: false, reason: "all_keys_exhausted" };
  },
};

test("policy gate blocks real docs in paid_or_consented mode", async () => {
  await assert.rejects(
    () => extractDocument({ llm: llmDead, task: "invoice", text: "TAX INVOICE", dataPolicy: "demo", envPolicy: "paid_or_consented" }),
    (e) => e.code === "AI_POLICY_BLOCKED",
  );
  // consented passes the gate (then fails on dead llm with AI_UNAVAILABLE)
  await assert.rejects(
    () => extractDocument({ llm: llmDead, task: "invoice", text: "x", dataPolicy: "consented", envPolicy: "paid_or_consented" }),
    (e) => e.code === "AI_UNAVAILABLE",
  );
});

test("extract returns fields, quotes and usage", async () => {
  const payload = JSON.stringify({
    type: "invoice", number: "INV-041", date: "2026-10-01",
    lines: [{ lineNo: 1, description: "Pump", qty: "60", hsn: "8413" }],
    totals: { grand: "70800.00" },
    quotes: { number: { page: 1, quote: "Invoice No: INV-041" } },
    fieldConfidence: { number: 0.98 },
  });
  const out = await extractDocument({ llm: llmOk(payload), task: "invoice", text: "Invoice No: INV-041 ...", envPolicy: "demo_only" });
  assert.equal(out.extracted.number, "INV-041");
  assert.equal(out.quotes.number.quote, "Invoice No: INV-041");
  assert.equal(out.model, "gemini-2.5-flash");
  assert.equal(out.usage.outputTokens, 40);
});

test("malformed JSON triggers one repair retry then succeeds", async () => {
  let calls = 0;
  const llm = {
    async generate() {
      calls += 1;
      if (calls === 1) return { ok: true, text: "not-json{oops", model: "m", usage: {} };
      return { ok: true, text: '{"type":"invoice","number":"INV-041","date":"","quotes":{}}', model: "m", usage: {} };
    },
  };
  const out = await extractDocument({ llm, task: "invoice", text: "doc", envPolicy: "demo_only" });
  assert.equal(calls, 2);
  assert.equal(out.extracted.number, "INV-041");
});

test("dead AI surfaces AI_UNAVAILABLE, never raw text", async () => {
  await assert.rejects(
    () => extractDocument({ llm: llmDead, task: "po", text: "PO-1001", envPolicy: "demo_only" }),
    (e) => e.code === "AI_UNAVAILABLE",
  );
});

test("classifyDocumentType guesses doc kinds from text", () => {
  assert.equal(classifyDocumentType("TAX INVOICE with IRN 64chars and GSTIN"), "invoice");
  assert.equal(classifyDocumentType("PURCHASE ORDER PO No: 1001"), "po");
  assert.equal(classifyDocumentType("Goods Receipt Note GRN-40"), "grn");
  assert.equal(classifyDocumentType("random memo"), "generic");
});

test("schemas load and are valid JSON schema objects", () => {
  const s = loadSchema("invoice");
  assert.equal(s.type, "object");
  assert.ok(s.required.includes("quotes"));
});

// Engine /v2/docs/parse returns pageImages as bare base64 strings; the server
// now forwards {pngBase64, mime, page} objects. Both must reach Gemini.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("toImagePart accepts strings, data URLs and objects; rejects junk", () => {
  assert.deepEqual(toImagePart(PNG_B64), { inlineData: { mimeType: "image/png", data: PNG_B64 } });
  assert.deepEqual(toImagePart(`data:image/jpeg;base64,${PNG_B64}`), { inlineData: { mimeType: "image/jpeg", data: PNG_B64 } });
  assert.deepEqual(toImagePart({ pngBase64: PNG_B64, page: 1 }), { inlineData: { mimeType: "image/png", data: PNG_B64 } });
  assert.deepEqual(toImagePart({ data: PNG_B64, mime: "image/webp" }), { inlineData: { mimeType: "image/webp", data: PNG_B64 } });
  assert.equal(toImagePart(""), null);
  assert.equal(toImagePart({}), null);
  assert.equal(toImagePart(null), null);
  assert.equal(toImagePart("not base64 !!"), null);
  assert.equal(toImagePart({ data: PNG_B64, mime: "application/pdf" }), null);
});

test("contentParts sends text first and at most 3 images of either shape", () => {
  const parts = contentParts({ text: "TAX INVOICE", pageImages: [PNG_B64, { pngBase64: PNG_B64 }, { data: PNG_B64 }, PNG_B64] });
  assert.equal(parts.length, 4);
  assert.match(parts[0].text, /^<record>TAX INVOICE<\/record>$/);
  assert.ok(parts.slice(1).every((p) => p.inlineData.data === PNG_B64));
});

test("extractDocument forwards string page images to the model and strips quotes from fields", async () => {
  let body;
  const llm = {
    async generate(_task, b) {
      body = b;
      return { ok: true, text: JSON.stringify({ type: "invoice", number: "INV-9", date: "07/05/2026", lines: [], totals: {},
        quotes: { number: { page: 1, quote: "Inv No INV-9" } }, fieldConfidence: { number: 0.9 } }), model: "m", usage: {} };
    },
  };
  const out = await extractDocument({ llm, task: "invoice_in", pageImages: [PNG_B64], envPolicy: "demo_only" });
  const images = body.contents[0].parts.filter((p) => p.inlineData);
  assert.equal(images.length, 1);
  assert.equal(images[0].inlineData.data, PNG_B64);
  assert.equal(out.meta.imagesUsed, 1);
  assert.equal(out.extracted.quotes, undefined);
  assert.equal(out.extracted.fieldConfidence, undefined);
  assert.equal(out.quotes.number.quote, "Inv No INV-9");
  assert.equal(out.fieldConfidence.number, 0.9);
});

test("only unusable images and no text is a validation error, not an empty model call", async () => {
  let called = false;
  const llm = { async generate() { called = true; return { ok: true, text: "{}" }; } };
  await assert.rejects(
    () => extractDocument({ llm, task: "invoice", pageImages: [{}, ""], envPolicy: "demo_only" }),
    (e) => e.code === "VALIDATION_FAILED",
  );
  assert.equal(called, false);
});
