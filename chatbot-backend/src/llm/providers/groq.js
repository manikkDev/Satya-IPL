// providers/groq.js — secondary provider (GROQ_KEY), OpenAI-compatible chat
// completions over plain fetch. Used after the Gemini ladder fails.
//
// Speaks the same Gemini-shaped request/response as the rest of the stack:
//   * request `tools[].functionDeclarations` → OpenAI `tools`
//   * `functionCall` / `functionResponse` parts → assistant tool_calls / tool
//     messages (ids assigned by position)
//   * response tool_calls → `raw.candidates[0].content.parts[].functionCall`
// so the copilot's tool loop runs unchanged on Groq models that support tool
// calling (e.g. openai/gpt-oss-20b, llama-3.3-70b-versatile). When a model
// rejects tools the caller sees ok:false and uses deterministic retrieval.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Gemini contents → OpenAI messages (exported for tests). */
export function toOpenAiMessages({ systemInstruction, contents }) {
  const messages = [];
  const sysText = (systemInstruction?.parts || []).map((p) => p.text || "").join("");
  if (sysText) messages.push({ role: "system", content: sysText });
  let pendingIds = [];
  let turn = 0;
  for (const item of contents || []) {
    const parts = item.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    const responses = parts.filter((p) => p.functionResponse);
    const text = parts.map((p) => p.text || "").join("");
    if (item.role === "model") {
      turn += 1;
      if (calls.length) {
        pendingIds = calls.map((c, i) => c.functionCall.id || `call_${turn}_${i}`);
        messages.push({
          role: "assistant",
          content: text || null,
          tool_calls: calls.map((c, i) => ({ id: pendingIds[i], type: "function", function: { name: c.functionCall.name, arguments: JSON.stringify(c.functionCall.args || {}) } })),
        });
      } else {
        messages.push({ role: "assistant", content: text });
      }
    } else if (responses.length) {
      responses.forEach((r, i) => {
        messages.push({ role: "tool", tool_call_id: r.functionResponse.id || pendingIds[i] || `call_${turn}_${i}`, content: JSON.stringify(r.functionResponse.response ?? {}) });
      });
      if (text) messages.push({ role: "user", content: text });
    } else {
      messages.push({ role: "user", content: text });
    }
  }
  return messages;
}

const toOpenAiTools = (tools) =>
  (tools || []).flatMap((t) => t.functionDeclarations || []).map((d) => ({
    type: "function",
    function: { name: d.name, description: d.description, parameters: d.parameters || { type: "object", properties: {} } },
  }));

export class GroqProvider {
  constructor({ apiKey, model, fetchImpl, timeoutMs = 45_000 } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetch = fetchImpl || fetch;
    this.timeoutMs = timeoutMs;
    this.name = "groq";
  }

  get enabled() {
    return Boolean(this.apiKey);
  }

  async generate({ systemInstruction, contents, generationConfig = {}, tools }) {
    const openAiTools = toOpenAiTools(tools);
    const body = {
      model: this.model,
      temperature: generationConfig.temperature ?? 0.2,
      max_completion_tokens: generationConfig.maxOutputTokens ?? 1500,
      messages: toOpenAiMessages({ systemInstruction, contents }),
      ...(openAiTools.length ? { tools: openAiTools, tool_choice: "auto", parallel_tool_calls: true } : {}),
      ...(generationConfig.responseMimeType === "application/json" && !openAiTools.length ? { response_format: { type: "json_object" } } : {}),
    };
    const response = await this.fetch(GROQ_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Groq request failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
    }
    const raw = await response.json();
    const message = raw?.choices?.[0]?.message || {};
    const parts = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.tool_calls || []) {
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || "{}");
      } catch {
        args = {};
      }
      parts.push({ functionCall: { id: call.id, name: call.function?.name, args } });
    }
    return {
      text: message.content || "",
      // Gemini-shaped so tool loops are provider-agnostic
      raw: { candidates: [{ content: { role: "model", parts } }], provider: "groq", model: raw?.model },
      usage: {
        inputTokens: raw?.usage?.prompt_tokens || 0,
        outputTokens: raw?.usage?.completion_tokens || 0,
      },
    };
  }
}
