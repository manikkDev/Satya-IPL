import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthorizedInvestigationMode } from "../src/helpers/riskMode.js";

test("default copilot mode resolves from the authenticated role", () => {
  assert.equal(resolveAuthorizedInvestigationMode("copilot", { role: "citizen" }), "risk_citizen");
  assert.equal(resolveAuthorizedInvestigationMode(undefined, { role: "analyst" }), "risk_analyst");
  assert.equal(resolveAuthorizedInvestigationMode("default", { role: "admin" }), "risk_analyst");
});

test("citizens cannot select the analyst risk persona", () => {
  assert.equal(resolveAuthorizedInvestigationMode("risk_analyst", { role: "citizen" }), null);
});

test("analysts cannot select the citizen risk persona", () => {
  assert.equal(resolveAuthorizedInvestigationMode("risk_citizen", { role: "analyst" }), null);
});
