// gateway.js — orchestrates one LLM call: pick a key, try the model ladder,
// retry within a bounded budget, fall back to Groq, then evidence-only.
// Never throws on capacity problems; never returns an error to the user.
// Logs alias + model + task + latency + tokens only (never keys or prompts).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 300 + Math.random() * 500; // transient retry backoff

export class AiGateway {
  /**
   * @param {object} deps
   * @param {import("./keyPool.js").GeminiKeyPool} deps.pool
   * @param {import("./ladder.js").ModelLadders} deps.ladders
   * @param {import("./gemini.js").GeminiClient} deps.client
   * @param {import("./providers/groq.js").GroqProvider} [deps.groq]
   * @param {import("./usage.js").UsageMeter} [deps.meter]
   * @param {number} [deps.maxAttempts=6] key attempts per request
   * @param {number} [deps.budgetMs=25000] total wall-clock budget
   * @param {() => number} [deps.now]
   */
  constructor({ pool, ladders, client, groq = null, meter = null, maxAttempts = 6, budgetMs = 25_000, now }) {
    this.pool = pool;
    this.ladders = ladders;
    this.client = client;
    this.groq = groq;
    this.meter = meter;
    this.maxAttempts = maxAttempts;
    this.budgetMs = budgetMs;
    this.now = now || (() => Date.now());
    this.missingModels = new Set(); // models the API reported as not found
  }

  /**
   * @param {string} task ladder name (chat|understand|extract|summary|embed)
   * @param {object} requestBody Gemini generateContent body
   * @returns {Promise<{ok:true,text:string,raw:object,model:string,keyAlias:string,usage:object,provider:string,attempts:number}
   *                  |{ok:false,reason:"all_keys_exhausted"|"ai_disabled"|"bad_request",error?:string}>}
   */
  async generate(task, requestBody) {
    const started = this.now();
    const deadline = started + this.budgetMs;
    let attempts = 0;

    for (const model of this.ladders.forTask(task)) {
      if (this.missingModels.has(model)) continue;
      let modelMissing = false;
      while (!modelMissing && attempts < this.maxAttempts && this.now() < deadline) {
        const pick = this.pool.select(model);
        if (!pick) break; // no key can serve this model now → next model
        attempts += 1;
        await this.pool.semaphore.acquire();
        const callStart = this.now();
        try {
          this.pool.noteAttempt(pick.alias, model);
          const result = await this.client.generateContent(model, pick.key, requestBody);
          this.pool.recordSuccess(pick.alias, model, result.usage);
          this.meter?.record({ task, model, alias: pick.alias, usage: result.usage });
          console.log(
            `[llm] ${task} ok alias=${pick.alias} model=${model} ms=${this.now() - callStart} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`,
          );
          return {
            ok: true,
            text: result.text,
            raw: result.raw,
            model,
            keyAlias: pick.alias,
            usage: result.usage,
            provider: "gemini",
            attempts,
          };
        } catch (error) {
          const classified = error?.classified || { kind: "transient", retryAfterMs: null };
          this.pool.recordError(pick.alias, model, classified, error?.httpStatus ?? null);
          this.meter?.record({ task, model, alias: pick.alias, failed: true });
          console.warn(
            `[llm] ${task} fail alias=${pick.alias} model=${model} kind=${classified.kind} ms=${this.now() - callStart}`,
          );
          if (classified.kind === "fatal") {
            return { ok: false, reason: "bad_request", error: error.message };
          }
          if (classified.kind === "model_missing") {
            // the model is gone for this project: skip it for every key and
            // don't let the discovery burn the request's attempt budget
            this.missingModels.add(model);
            attempts -= 1;
            modelMissing = true;
          }
          if (classified.kind === "transient" && this.now() < deadline) {
            await sleep(jitter()); // retry once on a different key
          }
        } finally {
          this.pool.semaphore.release();
        }
      }
    }

    // Optional secondary provider before giving up.
    if (this.groq?.enabled) {
      try {
        const result = await this.groq.generate(requestBody);
        this.meter?.record({ task, model: this.groq.model, alias: "groq", usage: result.usage, fallback: true });
        console.log(`[llm] ${task} ok provider=groq model=${this.groq.model}`);
        return {
          ok: true,
          text: result.text,
          raw: result.raw,
          model: this.groq.model,
          keyAlias: "groq",
          usage: result.usage,
          provider: "groq",
          attempts,
        };
      } catch (error) {
        console.warn(`[llm] ${task} groq fail: ${error.message}`);
      }
    }

    this.meter?.record({ task, model: null, alias: null, failed: true, evidenceOnly: true });
    return { ok: false, reason: "all_keys_exhausted" };
  }

  /**
   * Streaming generation with the same key/model failover — but only until
   * the first token is emitted (a half-streamed answer is never re-sent from
   * another model). Groq, when used, answers non-streamed and its text is
   * emitted in one piece. Same result shape as generate() plus `parts`.
   * @param {string} task
   * @param {object} requestBody
   * @param {{onText?:(t:string)=>void, signal?:AbortSignal}} [opts]
   */
  async stream(task, requestBody, { onText, signal } = {}) {
    if (typeof this.client.streamGenerateContent !== "function") {
      const out = await this.generate(task, requestBody);
      if (out.ok && out.text) onText?.(out.text);
      return out;
    }
    const started = this.now();
    const deadline = started + this.budgetMs;
    let attempts = 0;
    let emitted = false;
    const emit = (t) => {
      emitted = true;
      onText?.(t);
    };
    for (const model of this.ladders.forTask(task)) {
      if (this.missingModels.has(model)) continue;
      let modelMissing = false;
      while (!modelMissing && attempts < this.maxAttempts && this.now() < deadline && !signal?.aborted) {
        const pick = this.pool.select(model);
        if (!pick) break;
        attempts += 1;
        await this.pool.semaphore.acquire();
        const callStart = this.now();
        try {
          this.pool.noteAttempt(pick.alias, model);
          const result = await this.client.streamGenerateContent(model, pick.key, requestBody, { onText: emit, signal });
          this.pool.recordSuccess(pick.alias, model, result.usage);
          this.meter?.record({ task, model, alias: pick.alias, usage: result.usage });
          console.log(`[llm] ${task} stream ok alias=${pick.alias} model=${model} ms=${this.now() - callStart} in=${result.usage.inputTokens} out=${result.usage.outputTokens}`);
          return { ok: true, text: result.text, raw: result.raw, parts: result.parts, model, keyAlias: pick.alias, usage: result.usage, provider: "gemini", attempts };
        } catch (error) {
          const classified = error?.classified || { kind: "transient", retryAfterMs: null };
          this.pool.recordError(pick.alias, model, classified, error?.httpStatus ?? null);
          this.meter?.record({ task, model, alias: pick.alias, failed: true });
          console.warn(`[llm] ${task} stream fail alias=${pick.alias} model=${model} kind=${classified.kind}${classified.kind === "fatal" ? ` msg=${String(error?.message || "").slice(0, 300)}` : ""}`);
          if (emitted) return { ok: false, reason: "stream_interrupted" };
          if (classified.kind === "fatal") return { ok: false, reason: "bad_request", error: error.message };
          if (classified.kind === "model_missing") {
            this.missingModels.add(model);
            attempts -= 1;
            modelMissing = true;
          }
          if (classified.kind === "transient" && this.now() < deadline) await sleep(jitter());
        } finally {
          this.pool.semaphore.release();
        }
      }
    }
    if (this.groq?.enabled && !signal?.aborted) {
      try {
        const result = await this.groq.generate(requestBody);
        this.meter?.record({ task, model: this.groq.model, alias: "groq", usage: result.usage, fallback: true });
        console.log(`[llm] ${task} ok provider=groq model=${this.groq.model}`);
        if (result.text) emit(result.text);
        const parts = result.raw?.candidates?.[0]?.content?.parts || [];
        return { ok: true, text: result.text, raw: result.raw, parts, model: this.groq.model, keyAlias: "groq", usage: result.usage, provider: "groq", attempts };
      } catch (error) {
        console.warn(`[llm] ${task} groq fail: ${error.message}`);
      }
    }
    this.meter?.record({ task, model: null, alias: null, failed: true, evidenceOnly: true });
    return { ok: false, reason: "all_keys_exhausted" };
  }

  /** Embedding with the same failover rules (embed ladder). */
  async embed(texts, { taskType, outputDimensionality } = {}) {
    const results = [];
    for (const text of texts) {
      const out = await this._embedOne(text, { taskType, outputDimensionality });
      if (!out.ok) return out;
      results.push(out.vector);
    }
    return { ok: true, vectors: results };
  }

  async _embedOne(text, opts) {
    const started = this.now();
    const deadline = started + this.budgetMs;
    let attempts = 0;
    for (const model of this.ladders.forTask("embed")) {
      while (attempts < this.maxAttempts && this.now() < deadline) {
        const pick = this.pool.select(model);
        if (!pick) break;
        attempts += 1;
        await this.pool.semaphore.acquire();
        try {
          this.pool.noteAttempt(pick.alias, model);
          const vector = await this.client.embedContent(model, pick.key, text, opts);
          this.pool.recordSuccess(pick.alias, model, {});
          this.meter?.record({ task: "embed", model, alias: pick.alias, usage: {} });
          return { ok: true, vector, model, keyAlias: pick.alias };
        } catch (error) {
          const classified = error?.classified || { kind: "transient", retryAfterMs: null };
          this.pool.recordError(pick.alias, model, classified, error?.httpStatus ?? null);
          if (classified.kind === "transient" && this.now() < deadline) await sleep(jitter());
        } finally {
          this.pool.semaphore.release();
        }
      }
    }
    return { ok: false, reason: "all_keys_exhausted" };
  }

  /** True when at least one key can serve the first chat-ladder model. */
  canServe(task = "chat") {
    return this.ladders.forTask(task).some((model) => !this.missingModels.has(model) && this.pool.eligibleKeys(model).length > 0);
  }
}
