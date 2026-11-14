// gemini.js — thin REST client for the Gemini API (no SDK dependency).
// generateContent, streamGenerateContent (alt=sse), embedContent, models.list.
// Every call takes the key explicitly — the key pool owns selection.
// HTTP layer errors are thrown as GeminiHttpError for errors.js classification.

import { GeminiHttpError } from "./errors.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const modelPath = (model) => encodeURIComponent(String(model).replace(/^models\//, ""));

/**
 * Per-model request tuning. `generationConfig.lowLatency: true` turns
 * thinking off on Gemini 2.5 Flash models (budget 0) — the copilot's tool
 * loop needs speed more than deliberation. Unknown keys never reach the API.
 */
export function tuneForModel(model, body) {
  const gc = body?.generationConfig;
  if (!gc || !("lowLatency" in gc)) return body;
  const { lowLatency, ...rest } = gc;
  const generationConfig = { ...rest };
  if (lowLatency && /gemini-2\.5-flash/.test(String(model))) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  return { ...body, generationConfig };
}

export class GeminiClient {
  /**
   * @param {object} opts
   * @param {typeof fetch} opts.fetchImpl injectable for tests (default global fetch)
   * @param {number} opts.timeoutMs per-request timeout (default 45s per 00 §5.7)
   */
  constructor({ fetchImpl, timeoutMs = 45_000 } = {}) {
    this.fetch = fetchImpl || fetch;
    this.timeoutMs = timeoutMs;
  }

  async _request(path, { method = "GET", apiKey, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (apiKey) headers["x-goog-api-key"] = apiKey;
    let response;
    try {
      response = await this.fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new GeminiHttpError(0, {}, { timedOut: true });
      }
      throw new GeminiHttpError(0, { error: { message: String(error?.message || error) } });
    }
    if (!response.ok) {
      let parsed = {};
      try {
        parsed = await response.json();
      } catch {
        /* body wasn't JSON — classifier still works on status */
      }
      throw new GeminiHttpError(response.status, parsed);
    }
    return response;
  }

  /**
   * Non-streaming generation.
   * @returns {Promise<{text:string, raw:object, usage:{inputTokens:number,outputTokens:number}}>}
   */
  async generateContent(model, apiKey, requestBody) {
    requestBody = tuneForModel(model, requestBody);
    const response = await this._request(`/models/${modelPath(model)}:generateContent`, {
      method: "POST",
      apiKey,
      body: requestBody,
    });
    const raw = await response.json();
    const parts = raw?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("");
    const meta = raw?.usageMetadata || {};
    return {
      text,
      raw,
      usage: {
        inputTokens: meta.promptTokenCount || 0,
        outputTokens: meta.candidatesTokenCount || 0,
      },
    };
  }

  /**
   * Server-sent events streaming. Calls `onText(chunk)` per text delta and
   * resolves with the aggregate. Caller aborts via `signal`.
   */
  async streamGenerateContent(model, apiKey, requestBody, { onText, onPart, signal } = {}) {
    requestBody = tuneForModel(model, requestBody);
    const headers = { "content-type": "application/json", "x-goog-api-key": apiKey };
    const response = await this.fetch(
      `${BASE_URL}/models/${modelPath(model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: signal || AbortSignal.timeout(this.timeoutMs * 2),
      },
    );
    if (!response.ok) {
      let parsed = {};
      try {
        parsed = await response.json();
      } catch {
        /* non-JSON */
      }
      throw new GeminiHttpError(response.status, parsed);
    }
    let full = "";
    const parts = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // the API separates SSE events with CRLF CRLF
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop();
      for (const event of events) {
        const dataLine = event.split(/\r?\n/).find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        let chunk;
        try {
          chunk = JSON.parse(dataLine.slice(5).trim());
        } catch {
          continue;
        }
        const chunkParts = chunk?.candidates?.[0]?.content?.parts || [];
        for (const part of chunkParts) {
          if (part.functionCall) {
            parts.push(part);
            onPart?.(part);
          } else if (typeof part.text === "string" && !part.thought) {
            // merge consecutive text parts; keep any thought signature
            const last = parts[parts.length - 1];
            if (last && typeof last.text === "string" && !last.functionCall) {
              last.text += part.text;
              if (part.thoughtSignature) last.thoughtSignature = part.thoughtSignature;
            } else parts.push({ ...part });
          } else if (part.thoughtSignature) {
            parts.push(part);
          }
        }
        const delta = chunkParts.filter((p) => !p.thought).map((p) => p.text || "").join("");
        if (delta) {
          full += delta;
          onText?.(delta);
        }
        if (chunk?.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount || 0,
            outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
          };
        }
      }
    }
    // drop empty trailing text parts (no content, no signature)
    const kept = parts.filter((p) => p.functionCall || p.thoughtSignature || (typeof p.text === "string" && p.text.length));
    return { text: full, parts: kept, usage, raw: { candidates: [{ content: { role: "model", parts: kept } }] } };
  }

  /** Single text → embedding vector. */
  async embedContent(model, apiKey, text, { outputDimensionality, taskType } = {}) {
    const response = await this._request(`/models/${modelPath(model)}:embedContent`, {
      method: "POST",
      apiKey,
      body: {
        content: { parts: [{ text }] },
        ...(outputDimensionality ? { outputDimensionality } : {}),
        ...(taskType ? { taskType } : {}),
      },
    });
    const raw = await response.json();
    return raw?.embedding?.values || [];
  }

  /** models.list — used at startup to filter the configured ladders. */
  async listModels(apiKey) {
    const response = await this._request("/models", { apiKey });
    const raw = await response.json();
    return (raw?.models || []).map((m) => String(m.name || "").replace(/^models\//, ""));
  }
}
