import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDocument, classifyDocumentType, loadSchema } from "../../src/extract/extract.js";

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
