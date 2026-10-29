// rateLimit.js — small in-process sliding-window limiter.
// Single instance per process (Render free tier runs one process); contract
// limits: copilot 30 req/min/user, extraction 20 req/min/service.
// 429 body follows the shared error contract ({error:{code:"RATE_LIMITED"}}).

import { createHash } from "node:crypto";

const SWEEP_EVERY = 128;

export function rateLimit({ windowMs = 60_000, max, keyFn, message = "Too many requests — slow down and retry" }) {
  const hits = new Map(); // key -> number[]
  let ops = 0;
  return (req, res, next) => {
    const now = Date.now();
    const key = keyFn(req);
    let list = hits.get(key);
    if (!list) hits.set(key, (list = []));
    while (list.length && now - list[0] >= windowMs) list.shift();
    if (++ops % SWEEP_EVERY === 0) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] >= windowMs) hits.delete(k);
      }
    }
    if (list.length >= max) {
      const retryAfterMs = windowMs - (now - list[0]);
      res.set("retry-after", String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message,
          details: { retryAfterMs, limitPerMinute: max },
          requestId: req.id,
        },
      });
    }
    list.push(now);
    return next();
  };
}

/** Per-authenticated-user key (falls back to caller IP when anonymous). */
export const userKey = (req) => {
  const auth = req.headers.authorization || "";
  if (auth) return `u:${createHash("sha256").update(auth).digest("hex").slice(0, 24)}`;
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
};

/** Per-calling-service key (internal endpoints). */
export const serviceKey = (req) => `svc:${req.ip || req.socket?.remoteAddress || "internal"}`;
