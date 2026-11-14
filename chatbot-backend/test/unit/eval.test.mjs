import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_TOOL_NAMES } from "../../src/copilot/tools/index.js";
import { INTENTS } from "../../src/copilot/router.js";
import { normalizeOptions, MODES } from "../../src/copilot/options.js";

const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(dir, "../golden/cases.json"), "utf8"));

test("golden set: >= 60 cases covering every evaluation category", () => {
  assert.ok(cases.length >= 60, `${cases.length} cases`);
  const cats = new Set(cases.map((c) => c.category));
  for (const need of ["payables", "suppliers", "msme_43bh", "gst", "findings", "case_doc", "payments", "calculation", "comparison", "multi_step", "proposals", "refusal", "injection", "clarification", "agent_options"]) {
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

test("agent-options cases cover every mode and option, with valid options", () => {
  const withOpts = cases.filter((c) => c.options);
  assert.ok(withOpts.length >= 10, `${withOpts.length} cases with options`);
  for (const mode of MODES.filter((m) => m !== "ask")) assert.ok(withOpts.some((c) => c.options.mode === mode), `no case for mode ${mode}`);
  for (const key of ["showWorking", "includeScreening", "confirmedOnly"]) assert.ok(withOpts.some((c) => c.options[key] === true), `no case for ${key}`);
  assert.ok(withOpts.some((c) => c.options.scope?.supplierId) && withOpts.some((c) => c.options.scope?.from), "scope cases");
  assert.ok(withOpts.some((c) => c.options.attachmentDocumentIds?.length && c.inject), "an injection case through an attachment");
  const synthetic = JSON.parse(readFileSync(join(dir, "../golden/synthetic-api.json"), "utf8"));
  for (const c of withOpts) {
    const o = normalizeOptions(c.options);
    assert.equal(o.mode, c.options.mode || "ask", `${c.id}: mode survives normalisation`);
    for (const id of o.attachmentIds) assert.ok(synthetic.responses[`/api/v2/ingest/drafts/${id}`], `${c.id}: synthetic draft ${id} exists`);
  }
  // synthetic responses are attachment drafts only — nothing else is invented
  assert.ok(Object.keys(synthetic.responses).every((p) => p.startsWith("/api/v2/ingest/drafts/")));
});

test("recorded demo API fixture is present for offline eval", () => {
  const path = join(dir, "../golden/demo-api.json");
  assert.ok(existsSync(path));
  const fx = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(fx.today && fx.groupId && Object.keys(fx.responses).length > 20);
});
