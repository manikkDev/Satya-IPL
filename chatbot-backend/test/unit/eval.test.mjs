import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(dir, "../golden/cases.json"), "utf8"));

test("golden set has >=120 cases across all required categories", () => {
  assert.ok(cases.length >= 120);
  const need = ["clarification", "notFound", "refusal", "injectionSafe"];
  for (const k of need) assert.ok(cases.some((c) => c.expected[k]), `missing category ${k}`);
  assert.ok(cases.filter((c) => c.expected.mustIncludeFacts).length > 10);
});

test("every golden case has a non-empty question and expected block", () => {
  for (const c of cases) {
    assert.ok(c.id && c.question.length > 5, c.id);
    assert.ok(c.expected && Object.keys(c.expected).length > 0, c.id);
  }
});
