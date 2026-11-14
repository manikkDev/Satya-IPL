// /api/v2/connect — machine-to-machine import API for the Tally connector and
// scripts. Authenticated by an import API key (Authorization: Bearer satk_…
// or X-Satya-Key), NOT a user session, so it must be mounted BEFORE the
// session middleware in routes/v2/index.js:
//
//   import connectRoutes from "./connect.js";
//   router.use("/connect", connectRoutes);          // before router.use(authenticateV2, loadScope)
//
// The key is scoped to one entity and to imports only: it can upload a file
// for preview, commit its own previews and read their status — nothing else.
import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import ImportRun from "../../models/ImportRun.js";
import { verifyApiKey } from "../../services/apiKeys.js";
import { previewImport, commitImport, SOURCES } from "../../services/importers/index.js";
import { writeAudit } from "../../services/audit.js";
import { fail, handle } from "./util.js";

const router = express.Router();
const MAX_MB = Number(process.env.IMPORT_MAX_MB || 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
const rawBody = express.raw({ type: ["application/xml", "text/xml", "text/plain", "text/csv", "application/octet-stream"], limit: `${MAX_MB}mb` });
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.RATE_LIMIT_CONNECT || 300), standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Too many connector requests — slow down" } });

const keyAuth = async (req, res, next) => {
  const deny = (status, code, message) => res.status(status).json({ error: { code, message, requestId: req.id } });
  try {
    const header = String(req.headers.authorization || "");
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : String(req.headers["x-satya-key"] || "").trim();
    const key = await verifyApiKey(presented);
    if (!key) return deny(401, "UNAUTHENTICATED", "Valid Satya import key required");
    if (!key.scopes.includes("import")) return deny(403, "FORBIDDEN", "This key cannot import");
    req.apiKey = key;
    next();
  } catch (e) { next(e); }
};

router.use(limiter, keyAuth);

router.get("/ping", (req, res) => res.json({ ok: true, entityId: req.apiKey.entityId, key: req.apiKey.prefix, sources: SOURCES }));

const view = (r) => ({ id: r.id, status: r.status, source: r.source, fileName: r.fileName, summary: r.summary, result: r.result || null, checks: r.checks || null, issueCount: r.issueCount, issues: (r.issues || []).slice(0, 50), canCommit: r.canCommit, detected: r.detected, createdAt: r.createdAt, committedAt: r.committedAt || null });

// POST /connect/import?source=tally_xml&commit=1&fileName=daybook.xml
// Body: multipart "file" OR the raw file bytes (application/xml, text/csv…).
router.post("/import", (req, res, next) => {
  if (String(req.headers["content-type"] || "").startsWith("multipart/")) {
    return upload.single("file")(req, res, (err) => next(err?.code === "LIMIT_FILE_SIZE" ? fail(413, "VALIDATION_FAILED", `File exceeds ${MAX_MB} MB`) : err));
  }
  return rawBody(req, res, next);
}, handle(async (req, res) => {
  const source = String(req.query.source || req.body?.source || "");
  if (!SOURCES.includes(source)) throw fail(422, "VALIDATION_FAILED", `source must be one of ${SOURCES.join(", ")}`);
  const buffer = req.file?.buffer || (Buffer.isBuffer(req.body) ? req.body : null);
  if (!buffer?.length) throw fail(422, "VALIDATION_FAILED", "Send the file as multipart 'file' or as the raw request body");
  const fileName = String(req.file?.originalname || req.query.fileName || `${source}.${source === "tally_xml" ? "xml" : "dat"}`).slice(0, 120);
  const { groupId, entityId, id: keyId, prefix } = req.apiKey;
  const actorId = `apikey:${keyId}`;
  const run = await previewImport({ groupId, entityId, actor: actorId, buffer, fileName, source, options: {}, via: "api_key" });
  let out = run;
  const wantCommit = ["1", "true", "yes"].includes(String(req.query.commit || "").toLowerCase());
  if (wantCommit && run.canCommit) out = await commitImport({ groupId, runId: run.id, actor: actorId });
  await writeAudit({ groupId, entityId, actor: actorId, actorRole: "api_key", action: `POST /api/v2/connect/import ${source}${wantCommit ? " commit" : ""}`, target: { id: run.id, key: prefix }, statusCode: 201, ip: req.ip });
  res.status(201).json(view(out));
}));

router.post("/import/:id/commit", handle(async (req, res) => {
  const { groupId, entityId, id: keyId } = req.apiKey;
  const run = await ImportRun.findOne({ groupId, id: req.params.id, entityId }, { createdBy: 1 }).lean();
  if (!run || run.createdBy !== `apikey:${keyId}`) throw fail(404, "NOT_FOUND", "Import not found");
  const out = await commitImport({ groupId, runId: req.params.id, actor: `apikey:${keyId}` });
  res.json(view(out));
}));

router.get("/import/:id", handle(async (req, res) => {
  const { groupId, entityId, id: keyId } = req.apiKey;
  const run = await ImportRun.findOne({ groupId, id: req.params.id, entityId }).lean();
  if (!run || run.createdBy !== `apikey:${keyId}`) throw fail(404, "NOT_FOUND", "Import not found");
  res.json(view(run));
}));

export default router;
