// keyPool.js — Gemini key state machine: failover, cooldowns, daily-exhaustion
// parking until midnight Pacific, per-model tracking, LRU+RPM selection.
//
// Design constraints (docs/plan/05 §2, verified):
//  - Limits are per Google Cloud project, not per key → the pool provides
//    resilience and honest capacity display, never limit circumvention.
//  - RPD resets at midnight America/Los_Angeles.
//  - Keys are NEVER logged or persisted — only SHA-256 hash + alias (key-01…).

import { createHash } from "node:crypto";
import { ptDayKey } from "./ptClock.js";

const MINUTE_MS = 60_000;
const PARK_WINDOW_MS = 120_000; // same-project heuristic window
const PARK_DURATION_MS = 600_000; // model parked 10 min when ≥3 keys/day-429
const MAX_LAST_MINUTE = 256;
const PERSIST_DEBOUNCE_MS = 200;

const keyHash = (key) => createHash("sha256").update(key).digest("hex");

const aliasFor = (index) => `key-${String(index + 1).padStart(2, "0")}`;

const freshModelStats = () => ({
  dayKey: null,
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  lastMinute: [],
  exhaustedDay: null,
});

const freshKeyState = () => ({
  status: "active",
  cooldownUntil: null,
  exhaustedDay: null,
  perModel: {},
  missingModels: [],
  lastErrorCode: null,
  lastErrorAt: null,
  successCount: 0,
  failureCount: 0,
  lastUsedAt: 0,
});

/** Max `max` in-flight operations; callers must release(). */
export class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release() {
    if (this.queue.length) this.queue.shift()();
    else this.active -= 1;
  }
  get waiting() {
    return this.queue.length;
  }
}

/**
 * Store contract (persistence):
 *   load() → Promise<Map<keyHash, serializedState>>
 *   save(keyHash, serializedState) → Promise<void>
 *   close() → Promise<void>
 * InMemoryStore ships as default; MongoKeyStateStore lives in store.js.
 */
export class InMemoryStore {
  constructor() {
    this.docs = new Map();
    this.saved = 0;
  }
  async load() {
    return new Map(this.docs);
  }
  async save(hash, doc) {
    this.saved += 1;
    this.docs.set(hash, structuredClone(doc));
  }
  async close() {}
}

export class GeminiKeyPool {
  /**
   * @param {string[]} keys raw API keys (order defines aliases key-01…)
   * @param {object} opts
   * @param {string[]} opts.models every model the pool may serve (union of ladders)
   * @param {object} opts.rpmLimits {model: rpm} local per-key RPM guard
   * @param {object} opts.store persistence (default InMemoryStore)
   * @param {() => number} opts.now injectable clock (epoch ms) for tests
   */
  constructor(keys, { models = [], rpmLimits = {}, store, now } = {}) {
    this.now = now || (() => Date.now());
    this.models = models;
    this.rpmLimits = rpmLimits;
    this.store = store || new InMemoryStore();
    this.keys = keys.map((key, index) => ({
      key,
      hash: keyHash(key),
      alias: aliasFor(index),
      state: freshKeyState(),
    }));
    this.byAlias = new Map(this.keys.map((k) => [k.alias, k]));
    // Same-project heuristic: recent per-day 429s per model.
    this.dayQuotaHits = new Map(); // model -> [{alias, ts}]
    this.modelParkedUntil = new Map(); // model -> epoch ms
    this._dirty = new Set();
    this.version = 0; // bumped on every state mutation; usage meter cache key
    this._persistTimer = null;
    this._restored = false;
    this.semaphore = new Semaphore(4); // ≤4 in-flight LLM calls per process
  }

  async init() {
    const saved = await this.store.load();
    for (const entry of this.keys) {
      const doc = saved.get(entry.hash);
      if (!doc) continue;
      entry.state = { ...freshKeyState(), ...doc.state, lastUsedAt: 0 };
      // Never resurrect invalid keys mid-process without a restart? Spec says
      // invalid is permanent "until restart + env change" — a restart may carry
      // a new env, so persisting 'invalid' is wrong. Force re-check on boot.
      if (entry.state.status === "invalid") entry.state.status = "active";
    }
    this._restored = true;
  }

  today() {
    return ptDayKey(this.now());
  }

  _stats(entry, model) {
    const s = (entry.state.perModel[model] ||= freshModelStats());
    const today = this.today();
    if (s.dayKey !== today) {
      s.dayKey = today;
      s.requests = 0;
      s.inputTokens = 0;
      s.outputTokens = 0;
      if (s.exhaustedDay && s.exhaustedDay !== today) s.exhaustedDay = null;
    }
    return s;
  }

  _refresh(entry) {
    const { state } = entry;
    const now = this.now();
    const today = this.today();
    if (state.status === "cooling" && state.cooldownUntil && now >= Date.parse(state.cooldownUntil)) {
      state.status = "active";
      state.cooldownUntil = null;
      this._touch(entry);
    }
    if (state.status === "exhausted" && state.exhaustedDay !== today) {
      // Parked yesterday (PT) — the quota window has rolled; re-activate.
      state.status = "active";
      state.exhaustedDay = null;
      for (const s of Object.values(state.perModel)) {
        if (s.exhaustedDay && s.exhaustedDay !== today) s.exhaustedDay = null;
      }
      this._touch(entry);
    }
  }

  _pruneMinute(stats, now) {
    while (stats.lastMinute.length && now - stats.lastMinute[0] >= MINUTE_MS) stats.lastMinute.shift();
  }

  isModelParked(model) {
    const until = this.modelParkedUntil.get(model);
    return until != null && until > this.now();
  }

  /**
   * Pick the least-recently-used key eligible for `model`, honouring status,
   * per-model day-exhaustion, pool-level model parking and a local RPM guard.
   * @returns {{key:string, alias:string, hash:string}|null}
   */
  select(model) {
    const now = this.now();
    const rpm = this.rpmLimits[model] ?? Infinity;
    let best = null;
    for (const entry of this.keys) {
      this._refresh(entry);
      const { state } = entry;
      if (state.status === "invalid" || state.status === "cooling" || state.status === "exhausted") continue;
      if (state.missingModels.includes(model)) continue;
      if (this.isModelParked(model)) continue;
      const stats = this._stats(entry, model);
      if (stats.exhaustedDay === this.today()) continue;
      this._pruneMinute(stats, now);
      if (stats.lastMinute.length >= rpm) continue;
      if (!best || state.lastUsedAt < best.state.lastUsedAt) best = entry;
    }
    if (!best) return null;
    best.state.lastUsedAt = now;
    this.version += 1;
    return { key: best.key, alias: best.alias, hash: best.hash };
  }

  _touch(entry) {
    this._dirty.add(entry.hash);
    this.version += 1;
  }

  /** Mark that an HTTP request for (alias, model) was just sent. */
  noteAttempt(alias, model) {
    const entry = this.byAlias.get(alias);
    if (!entry) return;
    const stats = this._stats(entry, model);
    this._pruneMinute(stats, this.now());
    stats.lastMinute.push(this.now());
    if (stats.lastMinute.length > MAX_LAST_MINUTE) stats.lastMinute.shift();
    stats.requests += 1;
    this._touch(entry);
    this._schedulePersist();
  }

  recordSuccess(alias, model, usage = {}) {
    const entry = this.byAlias.get(alias);
    if (!entry) return;
    entry.state.successCount += 1;
    const stats = this._stats(entry, model);
    stats.inputTokens += usage.inputTokens || 0;
    stats.outputTokens += usage.outputTokens || 0;
    this._touch(entry);
    this._schedulePersist();
  }

  /** Apply a classified error to a key's state. See llm/errors.js kinds. */
  recordError(alias, model, classified, httpStatus = null) {
    const entry = this.byAlias.get(alias);
    if (!entry) return;
    const { state } = entry;
    const now = this.now();
    state.failureCount += 1;
    state.lastErrorCode = httpStatus;
    state.lastErrorAt = new Date(now).toISOString();
    const today = this.today();
    switch (classified.kind) {
      case "quota_day": {
        const stats = this._stats(entry, model);
        stats.exhaustedDay = today;
        this._registerDayQuotaHit(model, alias, now);
        // Key-level 'exhausted' only when every pool model is spent for today.
        const allSpent =
          this.models.length > 0 &&
          this.models.every(
            (m) => this._stats(entry, m).exhaustedDay === today || state.missingModels.includes(m),
          );
        if (allSpent) {
          state.status = "exhausted";
          state.exhaustedDay = today;
        }
        break;
      }
      case "quota_minute":
        state.status = "cooling";
        state.cooldownUntil = new Date(now + (classified.retryAfterMs ?? MINUTE_MS)).toISOString();
        break;
      case "invalid_key":
        state.status = "invalid"; // permanent until restart + env change
        break;
      case "model_missing":
        if (!state.missingModels.includes(model)) state.missingModels.push(model);
        break;
      case "transient":
      case "fatal":
      default:
        break;
    }
    this._touch(entry);
    this._schedulePersist();
  }

  _registerDayQuotaHit(model, alias, now) {
    const hits = (this.dayQuotaHits.get(model) || []).filter(
      (h) => now - h.ts < PARK_WINDOW_MS,
    );
    hits.push({ alias, ts: now });
    this.dayQuotaHits.set(model, hits);
    // If ≥3 distinct keys hit a per-day 429 for the same model inside 2 min,
    // the keys almost certainly share one project quota → park the model.
    const distinct = new Set(hits.map((h) => h.alias));
    if (distinct.size >= 3) this.modelParkedUntil.set(model, now + PARK_DURATION_MS);
  }

  /** Counts for the usage meter. */
  keyCounts() {
    const counts = { total: this.keys.length, active: 0, cooling: 0, exhausted: 0, invalid: 0 };
    for (const entry of this.keys) {
      this._refresh(entry);
      counts[entry.state.status] += 1;
    }
    return counts;
  }

  /** Requests sent through this gateway today (PT) for (alias, model). */
  usedToday(alias, model) {
    const entry = this.byAlias.get(alias);
    if (!entry) return 0;
    const s = entry.state.perModel[model];
    return s && s.dayKey === this.today() ? s.requests : 0;
  }

  /** Keys usable right now for `model` (same rules as select(), minus LRU). */
  eligibleKeys(model) {
    const now = this.now();
    const rpm = this.rpmLimits[model] ?? Infinity;
    if (this.isModelParked(model)) return [];
    return this.keys.filter((entry) => {
      this._refresh(entry);
      const { state } = entry;
      if (state.status !== "active") return false;
      if (state.missingModels.includes(model)) return false;
      const stats = this._stats(entry, model);
      if (stats.exhaustedDay === this.today()) return false;
      this._pruneMinute(stats, now);
      return stats.lastMinute.length < rpm;
    });
  }

  /**
   * Keys that count toward today's remaining-capacity estimate: anything not
   * invalid and not day-exhausted (cooling keys still have quota left).
   */
  meterEligibleKeys(model) {
    return this.keys.filter((entry) => {
      this._refresh(entry);
      const { state } = entry;
      if (state.status === "invalid" || state.status === "exhausted") return false;
      if (state.missingModels.includes(model)) return false;
      const stats = entry.state.perModel[model];
      return !stats || stats.exhaustedDay !== this.today();
    });
  }

  lastUsedAlias() {
    let best = null;
    for (const entry of this.keys) {
      if (entry.state.lastUsedAt && (!best || entry.state.lastUsedAt > best.state.lastUsedAt)) best = entry;
    }
    return best?.alias || null;
  }

  _schedulePersist() {
    if (!this._restored || this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async flush() {
    const dirty = [...this._dirty];
    this._dirty.clear();
    for (const hash of dirty) {
      const entry = this.keys.find((k) => k.hash === hash);
      if (!entry) continue;
      const { key: _key, ...serializable } = entry;
      await this.store.save(hash, {
        keyHash: hash,
        alias: entry.alias,
        updatedAt: new Date(this.now()).toISOString(),
        state: { ...serializable.state, lastUsedAt: undefined },
      });
    }
  }

  async close() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    await this.flush();
    await this.store.close();
  }
}
