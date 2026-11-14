import express from "express";
import FileDoc from "../../models/FileDoc.js";
import ExtractionDraft from "../../models/ExtractionDraft.js";
import Document from "../../models/Document.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { scopeAllows } from "../../auth/rbac.js";
import { runExtraction } from "../../services/extract.js";
import { gatewayPost } from "../../services/gateway.js";
import { fail, handle, assertPlainInput } from "./util.js";
import { ingestConfirmSchema } from "../../lib/docSchemas.js";
import { toPaise, fromPaise, toDecimal } from "../../lib/money.js";
import { scheduleAutoCheck } from "../../services/autoChecks.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);

const view = (d) => {
  const { _id, __v, ...rest } = d.toObject ? d.toObject() : d;
  return rest;
};

// POST /ingest/files/:fileId/extract — queue + run the extraction pipeline.
router.post("/files/:fileId/extract", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "doc.upload")) throw fail(403, "FORBIDDEN", "Your role cannot ingest documents");
  const file = await FileDoc.findOne({ id: req.params.fileId, groupId: req.scope.groupId });
  if (!file) throw fail(404, "NOT_FOUND", "File not found");
  const draft = await ExtractionDraft.create({
    id: newId("drf"), groupId: req.scope.groupId, entityId: file.entityId || req.scope.entityIds[0],
    fileId: file.id, status: "queued", createdBy: actor(req),
  });
  const result = await runExtraction(draft, file); // synchronous for demo scale; job queue lands with B6
  const fresh = await ExtractionDraft.findOne({ id: draft.id }).lean();
  res.status(fresh.status === "failed" ? 502 : 200).json({ draftId: draft.id, status: fresh.status, draft: view(fresh) });
}));

router.get("/drafts", handle(async (req, res) => {
  const filter = { groupId: req.scope.groupId };
  if (req.query.status) filter.status = req.query.status;
  const items = await ExtractionDraft.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items: items.map(view), nextCursor: null });
}));

router.get("/drafts/:id", handle(async (req, res) => {
  const draft = await ExtractionDraft.findOne({ id: req.params.id, groupId: req.scope.groupId }).lean();
  if (!draft) throw fail(404, "NOT_FOUND", "Draft not found");
  res.json(view(draft));
}));

// PATCH drafts/:id — human field corrections (logged in edits[]).
router.patch("/drafts/:id", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "doc.upload")) throw fail(403, "FORBIDDEN", "Your role cannot review drafts");
  assertPlainInput(req.body);
  const draft = await ExtractionDraft.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!draft) throw fail(404, "NOT_FOUND", "Draft not found");
  if (draft.status !== "needs_review") throw fail(409, "CONFLICT", `Draft is ${draft.status} — only needs_review drafts can be edited`);
  if (req.body.fields) draft.fields = { ...draft.fields, ...req.body.fields };
  if (req.body.lines) draft.lines = req.body.lines;
  draft.edits.push({ actor: actor(req), at: new Date().toISOString(), changed: Object.keys(req.body.fields || req.body.lines ? req.body : {}) });
  await draft.save();
  res.json(view(draft));
}));

// POST drafts/:id/confirm — commit reviewed fields as a BusinessDocument.
router.post("/drafts/:id/confirm", handle(async (req, res) => {
  if (!scopeAllows(req.scope, "doc.upload")) throw fail(403, "FORBIDDEN", "Your role cannot confirm drafts");
  const draft = await ExtractionDraft.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!draft) throw fail(404, "NOT_FOUND", "Draft not found");
  if (draft.status === "confirmed") return res.json({ documentId: draft.confirmedDocumentId, status: "confirmed", idempotent: true });
  if (draft.status !== "needs_review") throw fail(409, "CONFLICT", `Draft is ${draft.status} — cannot confirm`);

  if (!req.scope.entityIds.includes(draft.entityId)) throw fail(404, "NOT_FOUND", "Draft not found");

  const field = (name) => draft.fields?.[name]?.value ?? draft.fields?.[name];
  const type = draft.detectedType || field("type") || "INVOICE_IN";
  // A posted document must be real: a number, a real date, sane lines, and
  // totals that add up (grand = taxable + taxes + round-off within ₹1).
  const checked = ingestConfirmSchema.safeParse({ type, number: field("number") ?? undefined, date: field("date") ?? undefined, lines: draft.lines || [], totals: field("totals") ?? undefined });
  if (!checked.success) {
    throw fail(422, "VALIDATION_FAILED", "Fix the highlighted fields before confirming", { fields: checked.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  const totals = checked.data.totals;
  if (totals) {
    const expected = toPaise(totals.taxable) + toPaise(totals.cgst) + toPaise(totals.sgst) + toPaise(totals.igst) + toPaise(totals.cess) + toPaise(totals.roundOff);
    const diff = expected - toPaise(totals.grand);
    if (diff > 100n || diff < -100n) {
      throw fail(422, "VALIDATION_FAILED", `Totals don't add up: taxable + taxes + round-off = ₹${fromPaise(expected)} but grand total is ₹${fromPaise(toPaise(totals.grand))}`, { fields: [{ field: "totals.grand", message: "does not equal the sum of its parts" }] });
    }
  }
  const { date, number } = checked.data;
  const doc = await Document.create({
    id: newId("doc"), groupId: draft.groupId, entityId: draft.entityId, type,
    number, externalRef: field("externalRef"),
    date, fy: fyOf(date),
    status: "posted", revision: 0,
    seller: field("seller") || { name: field("sellerName") || "Unknown supplier" },
    buyer: field("buyer") || { name: field("buyerName") || "Unknown buyer" },
    supplierId: draft.suggestions?.supplierMatch?.supplierId,
    placeOfSupply: field("placeOfSupply"),
    currency: field("currency") || "INR",
    lines: draft.lines || [], charges: field("charges") || [],
    totals: totals ? Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, ["taxable", "cgst", "sgst", "igst", "cess", "roundOff", "grand"].includes(k) ? toDecimal(v) : v])) : undefined,
    gst: field("gst"), terms: field("terms"),
    payment: field("payment"),
    source: { channel: draft.method === "einvoice_qr" ? "einvoice_json" : file_mime_channel(draft), fileId: draft.fileId, extractionDraftId: draft.id },
    provenance: "EXTRACTED_REVIEWED",
    observedAt: new Date().toISOString(), createdBy: actor(req),
  });
  draft.status = "confirmed";
  draft.confirmedDocumentId = doc.id;
  await draft.save();
  // attach to its case, ML linking, GSTR-2B match and reconcile — in the background
  await scheduleAutoCheck({ groupId: draft.groupId, documentIds: [doc.id], reason: "ingest:confirm" });
  // fire-and-forget: index document text for copilot RAG (C-owned endpoint)
  gatewayPost("/internal/rag/index", {
    groupId: draft.groupId, sourceType: "document_text", sourceId: doc.id,
    text: [type, field("number"), field("sellerName"), field("buyerName"), ...(draft.lines || []).map((l) => l.description)].filter(Boolean).join(" | "),
  }).catch(() => {});
  res.status(201).json({ documentId: doc.id, status: "confirmed" });
}));

const file_mime_channel = (draft) =>
  draft.method === "vision_llm" ? "upload_image" : draft.method === "csv" ? "csv" : draft.method === "json" ? "json" : "upload_pdf";

export default router;
