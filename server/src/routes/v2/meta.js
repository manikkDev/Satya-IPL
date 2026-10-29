import express from "express";
import mongoose from "mongoose";
import { allFlags } from "../../lib/flags.js";

const router = express.Router();

// Public: the client reads resolved flags once at boot to gate v2 UI.
router.get("/flags", (_req, res) => res.json({ flags: allFlags() }));

const probe = async (url, timeoutMs = 2500) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r.ok ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(t);
  }
};

// Public health for the client HealthBanner: mongo state plus short probes
// into the engine and gateway. Never blocks the page — degraded deps just
// report "down" so the banner can say which piece is waking.
router.get("/health", async (_req, res) => {
  const mongo = mongoose.connection.readyState === 1 ? "ok" : "down";
  const [engine, gateway] = await Promise.all([
    probe(`${(process.env.ENGINE_API_URL || "http://localhost:8000").replace(/\/$/, "")}/health`),
    probe(`${(process.env.GATEWAY_API_URL || "http://localhost:5001").replace(/\/$/, "")}/health`),
  ]);
  res.json({
    ok: mongo === "ok",
    deps: { mongo, engine, gateway },
    flags: allFlags(),
    time: new Date().toISOString(),
  });
});

export default router;
