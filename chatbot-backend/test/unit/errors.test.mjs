import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGeminiError, GeminiHttpError } from "../../src/llm/errors.js";

test("429 with PerDay quota signal → day scope", () => {
  const body = {
    error: {
      status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded for metric: generate_requests_per_model_per_day",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaMetric: "generateRequestsPerDayPerProjectPerModel", quotaId: "GenerateRequestsPerDayPerProjectPerModel" }],
        },
      ],
    },
  };
  const c = classifyGeminiError(429, body);
  assert.equal(c.kind, "quota_day");
  assert.equal(c.scope, "day");
});

test("429 with RetryInfo and no day signal → cooling for retryDelay", () => {
  const body = {
    error: {
      status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" }],
    },
  };
  const c = classifyGeminiError(429, body);
  assert.equal(c.kind, "quota_minute");
  assert.equal(c.retryAfterMs, 23000);
});

test("429 unspecified → cooling 60s default", () => {
  const c = classifyGeminiError(429, { error: { status: "RESOURCE_EXHAUSTED" } });
  assert.equal(c.kind, "quota_minute");
  assert.equal(c.retryAfterMs, 60000);
});

test("400 API_KEY_INVALID / 401 / 403 → invalid key", () => {
  assert.equal(classifyGeminiError(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }).kind, "invalid_key");
  assert.equal(classifyGeminiError(400, { error: { status: "API_KEY_INVALID" } }).kind, "invalid_key");
  assert.equal(classifyGeminiError(401, {}).kind, "invalid_key");
  assert.equal(classifyGeminiError(403, { error: { status: "PERMISSION_DENIED" } }).kind, "invalid_key");
});

test("404 → model missing; 5xx + timeout → transient", () => {
  assert.equal(classifyGeminiError(404, {}).kind, "model_missing");
  assert.equal(classifyGeminiError(503, {}).kind, "transient");
  assert.equal(classifyGeminiError(0, {}, { timedOut: true }).kind, "transient");
});

test("GeminiHttpError carries classification", () => {
  const e = new GeminiHttpError(429, { error: { message: "generate_requests_per_model_per_day exceeded" } });
  assert.equal(e.classified.kind, "quota_day");
  const t = new GeminiHttpError(0, {}, { timedOut: true });
  assert.equal(t.classified.kind, "transient");
});
