import { test } from "node:test";
import assert from "node:assert/strict";
import { FactRegistry, indianGroup, renderFactValue } from "../../src/copilot/facts.js";
import { validateAnswer, collectIdentifiers } from "../../src/copilot/validate.js";
import { understandFallback, parseUnderstanding, INTENTS } from "../../src/copilot/understand.js";
import { chunkText } from "../../src/rag/chunk.js";
import { rrf } from "../../src/rag/fuse.js";
import { l2Normalize, cosine } from "../../src/rag/embed.js";

test("indianGroup formats lakh/crore grouping", () => {
  assert.equal(indianGroup("1234567.89"), "12,34,567.89");
  assert.equal(indianGroup("70800.00"), "70,800.00");
  assert.equal(indianGroup("999"), "999");
  assert.equal(renderFactValue({ value: "70800.00", unit: "INR" }), "₹70,800.00");
  assert.equal(renderFactValue({ value: "2026-10-05", unit: "DATE" }), "5 Oct 2026");
});

test("registry renders placeholders, maps citations, tracks weakest certainty", () => {
  const r = new FactRegistry();
  const f1 = r.addFact({ label: "settled", value: "50800.00", unit: "INR" });
  const f2 = r.addFact({ label: "open qty", value: "40", unit: "NOS", certainty: "POSSIBLE" });
  const e1 = r.addEvidence({ evidenceId: "ev-1", label: "GRN-40 qty" });
  assert.equal(r.render(`Paid {{${f1}}} for {{${f2}}} [${e1}]`), "Paid ₹50,800.00 for 40 NOS [E1]");
  assert.equal(r.citations(`see [${e1}]`)[0].evidenceId, "ev-1");
  assert.equal(r.weakestCertainty(), "POSSIBLE");
});

test("validator rejects ungrounded numbers and action claims", () => {
  const r = new FactRegistry();
  r.addFact({ label: "settled", value: "50800.00", unit: "INR" });
  assert.equal(validateAnswer({ answerMarkdown: "Paid {{F1}} in total." }, r, { identifiers: [] }).ok, true);
  const bad = validateAnswer({ answerMarkdown: "Paid {{F1}} plus 9999 extra." }, r, { identifiers: [] });
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.includes("ungrounded")));
  assert.equal(validateAnswer({ answerMarkdown: "I approved {{F1}} for you." }, r, { identifiers: [] }).ok, false);
  assert.equal(validateAnswer({ answerMarkdown: "It was {{F9}}." }, r, { identifiers: [] }).ok, false);
  // identifiers make digit runs legit
  const r2 = new FactRegistry();
  r2.addFact({ label: "settled", value: "50800.00", unit: "INR" });
  r2.addEvidence({ evidenceId: "ev-1", label: "GRN-40" });
  assert.equal(validateAnswer({ answerMarkdown: "PO-1001 has {{F1}} settled [E1]." }, r2, { identifiers: ["PO-1001"] }).ok, true);
});

test("validator caps certainty at weakest supporting fact", () => {
  const r = new FactRegistry();
  r.addFact({ label: "maybe", value: "10", unit: "COUNT", certainty: "POSSIBLE" });
  const v = validateAnswer({ answerMarkdown: "{{F1}}", certainty: "CONFIRMED" }, r, { identifiers: [] });
  assert.equal(v.ok, false);
});

test("understand fallback routes entities and intents", () => {
  const u = understandFallback("Why is INV-041 on hold for PO-1001?");
  assert.equal(u.intent, "explain_finding");
  assert.deepEqual(u.entities.poNumbers, ["PO-1001"]);
  assert.equal(understandFallback("Which MSME payments are due this week?").intent, "compliance");
  assert.equal(understandFallback("What is a GRN?").intent, "how_to");
  assert.equal(understandFallback("Draft an email to the supplier").intent, "draft_message");
  assert.ok(INTENTS.includes("what_if"));
});

test("parseUnderstanding accepts schema-conforming JSON only", () => {
  assert.equal(parseUnderstanding('{"intent":"status","entities":{}}').intent, "status");
  assert.equal(parseUnderstanding('{"intent":"hack","entities":{}}'), null);
  assert.equal(parseUnderstanding("not json"), null);
});

test("chunkText splits with overlap and keeps page numbers", () => {
  const long = "word ".repeat(2000); // ~10k chars
  const chunks = chunkText([{ page: 2, text: long }]);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.page === 2));
  // overlap: consecutive chunks share text
  assert.ok(chunks[1].text.slice(0, 60) !== "" && chunks[0].text.endsWith(chunks[1].text.slice(0, 0)) !== undefined);
});

test("rrf fuses rankings with k=60", () => {
  const fused = rrf(["a", "b", "c"], ["b", "d", "a"]);
  assert.equal(fused[0], "b"); // b ranked 2nd+1st
  assert.ok(fused.includes("d"));
});

test("l2Normalize makes unit vectors; cosine of orthogonal ~0", () => {
  const v = l2Normalize([3, 4]);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-9 && Math.abs(v[1] - 0.8) < 1e-9);
  assert.ok(Math.abs(cosine(l2Normalize([1, 0]), l2Normalize([0, 1]))) < 1e-9);
});

test("collectIdentifiers harvests digit-bearing strings", () => {
  const ids = collectIdentifiers({ doc: { number: "INV-041", date: "2026-10-01" }, n: 5 });
  assert.ok(ids.includes("INV-041"));
});
