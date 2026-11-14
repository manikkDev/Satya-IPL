import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "node:crypto";
import mongoose from "mongoose";
import connectDB from "./config/db.js";
import routes from "./routes/index.js";
import { seedHsnMaster } from "./services/seed/hsn.js";
import { startWorker } from "./utils/businessService.js";
import { startJobRunner, registerHandler } from "./jobs/runner.js";
import { startOutboxWorker } from "./services/outbox.js";
import { runReconcile } from "./services/reconcile.js";
import { statusPage } from "./statusPage.js";
import { makeOriginChecker } from "./lib/origins.js";

// Startup order matters on Render: bind the port FIRST so the health check
// passes, then connect to Mongo and run demo seeding in the background.
// Seeding calls the engine (often still cold) with long retries — awaiting
// it before listen() made a cold engine crash-loop the API.
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5002;

const isAllowedOrigin = makeOriginChecker(process.env.ALLOWED_ORIGINS);
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "x-request-id"],
}));
app.use(express.json({ limit: "2mb" }));
// request id for error envelopes + audit trail (02 §2)
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set("x-request-id", req.id);
  next();
});

// Data routes need Mongo: answer 503 (instead of hanging on mongoose's
// buffer) while it connects. Health + public meta stay available.
app.use("/api", (req, res, next) => {
  if (mongoose.connection.readyState === 1) return next();
  if (req.path === "/health" || req.path.startsWith("/v2/meta")) return next();
  res.status(503).json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Database is connecting — retry shortly", details: { service: "mongo", retryAfterMs: 5000 }, requestId: req.id } });
});

app.use("/api", routes);
app.use((error, req, res, _next) => {
  const status = error.status || (error.name === "ValidationError" ? 422 : error.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(`[api] ${req.method} ${req.originalUrl} failed: ${error.stack || error.message}`);
  res.status(status).json({ message: status < 500 ? error.message : "Satya service could not complete this request" });
});

app.get("/", (req, res) => {
  if (req.accepts("text/html")) return res.type("html").send(statusPage());
  res.json({ service: "satya-business-api" });
});

// A stray rejection in background work must never take the API (and its
// health check) down.
process.on("unhandledRejection", (reason) => console.error("[api] unhandled rejection:", reason?.stack || reason));

let workersStarted = false;
const background = async () => {
  try {
    await connectDB();
  } catch (error) {
    console.error(`[startup] MongoDB unavailable — data routes return 503 until it connects (retry in 30s): ${error.message}`);
    setTimeout(background, 30000).unref();
    return;
  }
  if (!workersStarted) {
    workersStarted = true;
    registerHandler("reconcile", runReconcile);
    startJobRunner();
    startOutboxWorker();
    startWorker();
  }
  seedHsnMaster()
    .then((r) => console.log(r.seeded ? `[startup] HSN master seeded: ${r.seeded} codes (v${r.version})` : `[startup] HSN master: ${r.skipped}`))
    .catch((e) => console.warn("[startup] HSN seed skipped:", e.message));
  if (process.env.DEMO_MODE === "1") {
    try {
      const { default: seedDemoUsers } = await import("./seedDemoUsers.js");
      await seedDemoUsers();
      console.log("[startup] demo seeding finished");
    } catch (error) {
      console.error(`[startup] demo seeding failed — API keeps serving: ${error.message}`);
    }
  }
};

app.listen(PORT, () => {
  console.log(`Satya business API listening on port ${PORT}`);
  void background();
});
