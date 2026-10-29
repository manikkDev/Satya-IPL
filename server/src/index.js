import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import crypto from "node:crypto";
import connectDB from "./config/db.js";
import routes from "./routes/index.js";
import seedDemoUsers from "./seedDemoUsers.js";
import { seedHsnMaster } from "./services/seed/hsn.js";
import { startWorker } from "./utils/businessService.js";
import { startJobRunner, registerHandler } from "./jobs/runner.js";
import { runReconcile } from "./services/reconcile.js";
import { statusPage } from "./statusPage.js";

// Connect to database
await connectDB();
await seedDemoUsers();
seedHsnMaster().then((r) => r.seeded && console.log(`HSN master seeded: ${r.seeded} codes (v${r.version})`)).catch((e) => console.warn("HSN seed skipped:", e.message));
registerHandler("reconcile", runReconcile);
startJobRunner();
startWorker();
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5002;

// Middleware
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",");
const corsOptions = { origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] };
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
// request id for error envelopes + audit trail (02 §2)
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.set("x-request-id", req.id);
  next();
});

// API Routes
app.use("/api", routes);
app.use((error, _req, res, _next) => {
  const status = error.status || (error.name === "ValidationError" ? 422 : error.code === 11000 ? 409 : 500);
  res.status(status).json({ message: status < 500 ? error.message : "Satya service could not complete this request" });
});

// Base route
app.get("/", (req, res) => {
  if (req.accepts("text/html")) return res.type("html").send(statusPage());
  res.json({ service: "satya-business-api" });
});

// Start server
app.listen(PORT, () => console.log(`Satya business API listening on port ${PORT}`));
