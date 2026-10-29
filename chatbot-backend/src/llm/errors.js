// errors.js — classify Gemini/HTTP failures into key-pool actions.
// Reads error.status, HTTP code and google.rpc details (QuotaFailure
// quotaId/metric, RetryInfo.retryDelay) when present.

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

/**
 * @typedef {Object} ClassifiedError
 * @property {"quota_day"|"quota_minute"|"invalid_key"|"model_missing"|"transient"|"fatal"} kind
 * @property {number|null} retryAfterMs  server-hinted delay, else null
 * @property {string} scope              "day"|"minute"|"key"|"model"|"transient"|"request"
 */

export function classifyGeminiError(httpStatus, body = {}, { timedOut = false } = {}) {
  if (timedOut) return { kind: "transient", retryAfterMs: null, scope: "transient" };

  const err = body?.error || {};
  const code = err.status || "";
  const message = String(err.message || "");
  const details = Array.isArray(err.details) ? err.details : [];

  const retryInfo = details.find((d) => String(d["@type"] || "").includes("RetryInfo"));
  const retryAfterMs = retryInfo?.retryDelay ? durationToMs(retryInfo.retryDelay) : null;

  const quotaFailure = details.find((d) => String(d["@type"] || "").includes("QuotaFailure"));
  const violations = quotaFailure?.violations || [];
  const quotaText = [
    ...violations.flatMap((v) => [v.quotaId, v.quotaMetric].filter(Boolean)),
    message,
  ]
    .join(" ")
    .toLowerCase();
  const perDay = /perday|per_day|daily|per day/.test(quotaText);

  if (httpStatus === 429) {
    if (perDay) {
      return { kind: "quota_day", retryAfterMs, scope: "day" };
    }
    return { kind: "quota_minute", retryAfterMs: retryAfterMs ?? 60_000, scope: "minute" };
  }

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    (httpStatus === 400 && (code === "API_KEY_INVALID" || /api key not valid|api_key_invalid/i.test(message)))
  ) {
    // 400 API_KEY_INVALID, 401, 403 PERMISSION_DENIED → the key itself is dead.
    return { kind: "invalid_key", retryAfterMs: null, scope: "key" };
  }

  if (httpStatus === 404) {
    return { kind: "model_missing", retryAfterMs: null, scope: "model" };
  }

  if (TRANSIENT_STATUSES.has(httpStatus)) {
    return { kind: "transient", retryAfterMs, scope: "transient" };
  }

  if (httpStatus === 400) {
    // Bad request that is not a key problem — the request itself is at fault.
    return { kind: "fatal", retryAfterMs: null, scope: "request" };
  }

  return { kind: "transient", retryAfterMs, scope: "transient" };
}

function durationToMs(value) {
  if (typeof value === "number") return value * 1000;
  const text = String(value); // "42s", "1.5s", protobuf Duration JSON
  const m = text.match(/^([\d.]+)s$/);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  const n = Number(text);
  return Number.isFinite(n) ? n * 1000 : null;
}

/** Thrown by the REST client; carries everything the classifier needs. */
export class GeminiHttpError extends Error {
  constructor(httpStatus, body, { timedOut = false } = {}) {
    super(`Gemini request failed: HTTP ${httpStatus}${timedOut ? " (timeout)" : ""}`);
    this.name = "GeminiHttpError";
    this.httpStatus = httpStatus;
    this.body = body;
    this.timedOut = timedOut;
    this.classified = classifyGeminiError(httpStatus, body, { timedOut });
  }
}
