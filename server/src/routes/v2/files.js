import express from "express";
import multer from "multer";
import FileDoc from "../../models/FileDoc.js";
import { putFile, streamFile } from "../../services/storage.js";
import { scopeAllows } from "../../auth/rbac.js";
import { fail, handle } from "./util.js";

const router = express.Router();
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 10);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

const ALLOWED = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp",
  "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/json",
]);
const BY_EXT = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", csv: "text/csv", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", json: "application/json" };

const sniff = async (buffer, filename, clientMime) => {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) return ALLOWED.has(detected.mime) ? detected.mime : null;
  // no magic bytes (csv/json/text) — trust extension only
  const ext = filename.split(".").pop()?.toLowerCase();
  const guess = BY_EXT[ext];
  if (guess && ["text/csv", "application/json"].includes(guess)) return guess;
  return null;
};

// POST /api/v2/files — multipart upload; magic-byte sniffed, SHA-256 dedupe.
router.post("/", (req, res, next) => {
  if (!scopeAllows(req.scope, "doc.upload", req.body?.entityId)) return next(fail(403, "FORBIDDEN", "Your role cannot upload documents"));
  upload.single("file")(req, res, (err) => {
    if (err) return next(err.code === "LIMIT_FILE_SIZE" ? fail(413, "VALIDATION_FAILED", `File exceeds ${MAX_MB} MB limit`) : err);
    next();
  });
}, handle(async (req, res) => {
  if (!req.file) throw fail(422, "VALIDATION_FAILED", "Attach a file in the 'file' field");
  const mime = await sniff(req.file.buffer, req.file.originalname || "upload", req.file.mimetype);
  if (!mime) throw fail(422, "VALIDATION_FAILED", "Unsupported file type — upload PDF, PNG, JPEG, WebP, CSV, XLSX or JSON");
  const { file, duplicateOf } = await putFile({
    buffer: req.file.buffer, filename: req.file.originalname || "upload", mime,
    groupId: req.scope.groupId, entityId: req.body.entityId || req.scope.entityIds[0],
    uploadedBy: req.user.v2id || String(req.user._id),
  });
  res.status(duplicateOf ? 200 : 201).json({ fileId: file.id, sha256: file.sha256, duplicateOf, mime: file.mime, size: file.size });
}));

router.get("/:id", handle(async (req, res) => {
  const file = await FileDoc.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!file) throw fail(404, "NOT_FOUND", "File not found");
  if (req.query.meta === "1") return res.json(file.toObject());
  return streamFile(file, res);
}));

export default router;
