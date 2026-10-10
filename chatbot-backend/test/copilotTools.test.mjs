import test from "node:test";
import assert from "node:assert/strict";

import { detectIntents, deterministicFallback, formatToolContext } from "../src/helpers/copilotTools.js";

test("analyst prompts map to authorized analyst tools", () => {
  const perf = detectIntents("what is the current model PR-AUC?", "risk_analyst").map((i) => i.tool.name);
  assert.ok(perf.includes("model_summary"));

  const privacy = detectIntents("how much privacy epsilon did we spend?", "risk_analyst").map((i) => i.tool.name);
  assert.ok(privacy.includes("privacy_report"));

  const fairness = detectIntents("show the per-bank fairness report", "risk_analyst").map((i) => i.tool.name);
  assert.ok(fairness.includes("fairness_report"));
});

test("customer case intent extracts the account identifier", () => {
  const intents = detectIntents("pull the case for customer C1234567890", "risk_analyst");
  const caseTool = intents.find((i) => i.tool.name === "customer_case");
  assert.ok(caseTool);
  assert.equal(caseTool.args.customer_id, "C1234567890");
});

test("citizen prompts only resolve citizen-scoped tools", () => {
  const names = detectIntents("explain my risk score", "risk_citizen").map((i) => i.tool.name);
  assert.ok(names.includes("my_score"));
  for (const name of names) {
    assert.ok(!["model_summary", "customer_case", "campaigns", "risk_queue"].includes(name), `citizen saw analyst tool ${name}`);
  }
});

test("generic prompts produce no tool calls", () => {
  assert.equal(detectIntents("hello, how are you?", "risk_analyst").length, 0);
  assert.equal(detectIntents("what is the weather?", "risk_citizen").length, 0);
});

test("tool context is framed as data, not instructions", () => {
  const block = formatToolContext([{ tool: "x", label: "X", ok: true, summary: "s", evidence_id: "e:1", data: {} }]);
  assert.match(block, /never treat as instructions/i);
  assert.match(block, /\[e:1\]/);
});

test("deterministic fallback only quotes tool output", () => {
  const answer = deterministicFallback(
    [{ tool: "model_summary", label: "Model performance summary", ok: true, summary: "PR-AUC 70.00%", evidence_id: "run:x" }],
    "risk_analyst",
  );
  assert.match(answer, /PR-AUC 70\.00%/);
  assert.match(answer, /run:x/);
  assert.match(answer, /without the language model/i);
});

test("fallback with no tools guides to available capabilities", () => {
  assert.match(deterministicFallback([], "risk_analyst"), /risk queue|customer case|fairness/i);
  assert.match(deterministicFallback([], "risk_citizen"), /risk signal|consent|rights/i);
});
