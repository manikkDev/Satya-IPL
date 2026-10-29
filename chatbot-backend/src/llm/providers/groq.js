// providers/groq.js — optional secondary provider (existing GROQ_KEY).
// Same interface as the Gemini client path: {text, usage}. OpenAI-compatible
// chat completions over plain fetch — no SDK. Used only after the whole
// Gemini ladder fails, before evidence-only mode.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

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

  /**
   * Convert a Gemini-style request (systemInstruction + contents) into a
   * chat.completions body. Only text parts are carried over.
   */
  async generate({ systemInstruction, contents, generationConfig = {} }) {
    const messages = [];
    const sysText = (systemInstruction?.parts || []).map((p) => p.text || "").join("");
    if (sysText) messages.push({ role: "system", content: sysText });
    for (const item of contents || []) {
      messages.push({
        role: item.role === "model" ? "assistant" : "user",
        content: (item.parts || []).map((p) => p.text || "").join(""),
      });
    }
    const response = await this.fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: generationConfig.temperature ?? 0.2,
        max_completion_tokens: generationConfig.maxOutputTokens ?? 1500,
        ...(generationConfig.responseMimeType === "application/json"
          ? { response_format: { type: "json_object" } }
          : {}),
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Groq request failed: HTTP ${response.status} ${bodyText.slice(0, 200)}`);
    }
    const raw = await response.json();
    return {
      text: raw?.choices?.[0]?.message?.content || "",
      raw,
      usage: {
        inputTokens: raw?.usage?.prompt_tokens || 0,
        outputTokens: raw?.usage?.completion_tokens || 0,
      },
    };
  }
}
