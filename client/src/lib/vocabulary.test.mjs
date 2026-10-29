import test from "node:test";
import assert from "node:assert/strict";
import { CERTAINTY_LABEL, ACTION_LABEL, BALANCE_TERMS, TERM_TIPS } from "../content/copy/vocabulary.ts";

test("certainty classes map to the plan's plain-language labels", () => {
  assert.equal(CERTAINTY_LABEL.CONFIRMED, "Confirmed");
  assert.equal(CERTAINTY_LABEL.PROBABLE, "Likely");
  assert.equal(CERTAINTY_LABEL.POSSIBLE, "Possible");
  assert.equal(CERTAINTY_LABEL.AMBIGUOUS, "Unclear — needs your decision");
  assert.equal(CERTAINTY_LABEL.INSUFFICIENT_EVIDENCE, "Missing information");
});

test("actions map to verb-first labels", () => {
  assert.equal(ACTION_LABEL.APPROVE, "Approve");
  assert.equal(ACTION_LABEL.REQUEST_CLARIFICATION, "Ask for clarification");
  assert.equal(ACTION_LABEL.ESCALATE, "Escalate");
  assert.equal(ACTION_LABEL.PLACE_ON_HOLD, "Put on hold");
});

test("balance terms keep the vocabulary map wording", () => {
  assert.equal(BALANCE_TERMS.evidenceSupportedPayable.label, "What you really owe");
  assert.equal(BALANCE_TERMS.recordedPayable.label, "What your books show");
  assert.equal(BALANCE_TERMS.disputedExposure.label, "Amount under question");
  assert.equal(BALANCE_TERMS.itcAtRisk.label, "GST credit at risk");
  for (const term of Object.values(BALANCE_TERMS)) {
    assert.ok(term.tip.split(" ").length <= 22, `${term.label} tooltip too long`);
  }
});

test("every glossary term has a plain label and short tip", () => {
  for (const [key, term] of Object.entries(TERM_TIPS)) {
    assert.ok(term.label.length > 0, key);
    assert.ok(term.tip.split(" ").length <= 22, `${key} tooltip too long`);
  }
});
