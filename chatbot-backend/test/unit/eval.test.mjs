import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_TOOL_NAMES } from "../../src/copilot/tools/index.js";
import { INTENTS } from "../../src/copilot/router.js";

const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(dir, "../golden/cases.json"), "utf8"));

test("golden set: >= 60 cases covering every evaluation category", () => {
  assert.ok(cases.length >= 60, `${cases.length} cases`);
  const cats = new Set(cases.map((c) => c.category));
  for (const need of ["payables", "suppliers", "msme_43bh", "gst", "findings", "case_doc", "payments", "calculation", "comparison", "multi_step", "proposals", "refusal", "injection", "clarification"]) {
    assert.ok(cats.has(need), `missing category ${need}`);
  }
  assert.ok(cases.filter((c) => c.expect.injection).length >= 5);
  assert.ok(cases.filter((c) => c.expect.refusal).length >= 4);
  assert.ok(cases.filter((c) => c.expect.card).length >= 10);
});

test("golden cases are well-formed and name real tools and intents", () => {
  const tools = new Set(ALL_TOOL_NAMES());
  const ids = new Set();
  for (const c of cases) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id ${c.id}`);
    ids.add(c.id);
    assert.ok(c.question.length >= 2 && c.expect, c.id);
    for (const t of c.expect.tools || []) assert.ok(tools.has(t), `${c.id}: unknown tool ${t}`);
    if (c.expect.intent) assert.ok(INTENTS.includes(c.expect.intent), `${c.id}: unknown intent ${c.expect.intent}`);
  }
});

test("recorded demo API fixture is present for offline eval", () => {
  const path = join(dir, "../golden/demo-api.json");
  assert.ok(existsSync(path));
  const fx = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(fx.today && fx.groupId && Object.keys(fx.responses).length > 20);
});
