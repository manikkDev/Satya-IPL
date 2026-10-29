// usage.js — per-(day, model, task) counters + the /api/v2/ai/usage aggregate.
// remainingToday = Σ over non-invalid, non-exhausted keys of
//   max(0, limitRPD(model) − usedToday(key, model))   (05 P1-C2, contract 02 §7)
// Limits are per-project in reality (verified), so the endpoint is always
// marked estimate:true on the free tier. Counters persist to ai_usage_daily
// when Mongo is configured; in-memory otherwise.

import { ptDayKey, nextPtMidnightIso } from "./ptClock.js";

const CACHE_MS = 5_000; // endpoint cache per contract

export class UsageMeter {
  /**
   * @param {import("./keyPool.js").GeminiKeyPool} pool
   * @param {object} opts
   * @param {object} opts.rpdLimits {model: rpd|null}
   * @param {import("./ladder.js").ModelLadders} opts.ladders
   * @param {object} [opts.dailyStore] persistence {record(day, model, task, inc), flush()}
   * @param {() => number} [opts.now]
   */
  constructor(pool, { rpdLimits = {}, ladders, dailyStore = null, now } = {}) {
    this.pool = pool;
    this.rpdLimits = rpdLimits;
    this.ladders = ladders;
    this.dailyStore = dailyStore;
    this.now = now || (() => Date.now());
    this.day = new Map(); // `${dayKey}|${model}|${task}` -> {requests,in,out,fallbacks}
    this._cache = { at: 0, isAdmin: false, payload: null, version: -1 };
  }

  record({ task, model, alias, usage = {}, failed = false, fallback = false, evidenceOnly = false }) {
    const key = `${ptDayKey(this.now())}|${model || "none"}|${task}`;
    const row =
      this.day.get(key) || { requests: 0, inputTokens: 0, outputTokens: 0, failures: 0, fallbacks: 0 };
    row.requests += 1;
    row.inputTokens += usage.inputTokens || 0;
    row.outputTokens += usage.outputTokens || 0;
    if (failed) row.failures += 1;
    if (fallback || evidenceOnly) row.fallbacks += 1;
    this.day.set(key, row);
    this._cache.at = 0;
    if (this.dailyStore) {
      const [dayKey, m, t] = key.split("|");
      void this.dailyStore
        .record(dayKey, m, t, { requests: 1, inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0, failures: failed ? 1 : 0, fallbacks: fallback || evidenceOnly ? 1 : 0 })
        .catch((e) => console.warn(`[llm] usage persist failed: ${e.message}`));
    }
  }

  /**
   * Contract 02 §7 payload. `isAdmin` controls currentKeyAlias inclusion.
   * Cached 5 s — callers pass the admin flag so the cache never leaks the
   * alias to non-admins.
   */
  summary({ isAdmin = false } = {}) {
    const now = this.now();
    if (
      this._cache.payload &&
      now - this._cache.at < CACHE_MS &&
      this._cache.isAdmin === isAdmin &&
      this._cache.version === this.pool.version
    ) {
      return this._cache.payload;
    }
    const today = ptDayKey(now);
    const models = [];
    const seen = new Set();
    for (const [task, ladderModels] of Object.entries(this.ladders.ladders)) {
      for (const model of ladderModels) {
        const dedupe = `${task}:${model}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const limit = this.rpdLimits[model] ?? null;
        const eligible = this.pool.meterEligibleKeys(model);
        const remainingToday =
          limit == null
            ? null
            : eligible.reduce(
                (sum, entry) => sum + Math.max(0, limit - this.pool.usedToday(entry.alias, model)),
                0,
              );
        models.push({
          model,
          task,
          remainingToday,
          limitToday: limit == null ? null : limit * eligible.length,
          estimate: true, // free tier: real project quota is unknown to us
        });
      }
    }
    const keys = this.pool.keyCounts();
    const chatUsable = this.ladders
      .forTask("chat")
      .some((model) => this.pool.eligibleKeys(model).length > 0);
    const payload = {
      mode: chatUsable ? "llm" : "evidence_only",
      models,
      keys,
      resetsAt: nextPtMidnightIso(new Date(now)),
    };
    if (isAdmin) {
      const alias = this.pool.lastUsedAlias();
      if (alias) payload.currentKeyAlias = alias;
    }
    this._cache = { at: now, isAdmin, payload, version: this.pool.version };
    return payload;
  }

  /** Abbreviated usage event for the copilot SSE stream. */
  abbreviated() {
    const s = this.summary();
    return { mode: s.mode, keys: s.keys, resetsAt: s.resetsAt };
  }
}
