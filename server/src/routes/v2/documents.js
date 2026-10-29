import express from "express";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import Entity from "../../models/Entity.js";
import Supplier from "../../models/Supplier.js";
import { newId } from "../../lib/ids.js";
import { fyOf } from "../../lib/fy.js";
import { amountInWords } from "../../lib/words.js";
import { draftSchema, patchSchema } from "../../lib/docSchemas.js";
import { scopeAllows } from "../../auth/rbac.js";
import { enginePost } from "../../services/engine.js";
import { nextNumber } from "../../services/numbering.js";
import { contentHashOf, requiredApproversFor, lineLifecycle, ensureCaseForPo, estimateGrand } from "../../services/documents.js";
import { SoD, sodDeny } from "../../auth/sod.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();

const nowIso = () => new Date().toISOString();
const actorOf = (req) => req.user.v2id || String(req.user._id);

const view = (d) => {
  const { _id, __v, ...rest } = d.toObject ? d.toObject() : d;
  return rest;
};

const loadDoc = async (req) => {
  const doc = await Document.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!doc || (!req.scope.wildcard && !req.scope.entityIds.includes(doc.entityId))) {
    throw fail(404, "NOT_FOUND", "Document not found");
  }
  return doc;
};

const expectRevision = (doc, body) => {
  if (body?.expectedRevision !== undefined && body.expectedRevision !== doc.revision) {
    throw fail(409, "STALE_REVISION", "This document changed since you loaded it — refresh and try again", { currentRevision: doc.revision });
  }
};

const rolesOn = (scope, entityId) =>
  new Set([...(scope.rolesByEntity["*"] || []), ...(scope.rolesByEntity[entityId] || [])]);

const CREATE_PERMS = { PO: "po.create", PI_OUT: "po.create", PO_AMENDMENT: "po.create", PI_IN: "doc.upload" };

// ---------- draft / patch / compute ----------

router.post("/draft", handle(async (req, res) => {
  assertPlainInput(req.body);
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the document details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  const data = parsed.data;
  const perm = CREATE_PERMS[data.type] || "doc.upload";
  if (!scopeAllows(req.scope, perm, data.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot create this document type", { reason: `Requires ${perm}` });
  if (!req.scope.wildcard && !req.scope.entityIds.includes(data.entityId)) throw fail(404, "NOT_FOUND", "Entity not found");

  const doc = await Document.create({
    id: newId("doc"), groupId: req.scope.groupId, ...data,
    fy: fyOf(data.date), status: "draft", revision: 0,
    provenance: "USER_PROVIDED", source: { channel: "created_in_satya" },
    observedAt: nowIso(), createdBy: actorOf(req),
  });
  res.status(201).json(view(doc));
}));

router.patch("/:id", handle(async (req, res) => {
  assertPlainInput(req.body);
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check the patch", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const doc = await loadDoc(req);
  if (doc.status !== "draft") throw fail(409, "CONFLICT", `Only drafts can be edited (status: ${doc.status})`);
  expectRevision(doc, parsed.data);
  Object.assign(doc, parsed.data.patch);
  if (parsed.data.patch.date) doc.fy = fyOf(parsed.data.patch.date);
  doc.revision += 1;
  await doc.save();
  res.json(view(doc));
}));

router.post("/:id/compute", handle(async (req, res) => {
  const doc = await loadDoc(req);
  const entity = await Entity.findOne({ id: doc.entityId }).lean();
  const request = {
    seller: { gstin: doc.seller?.gstin, stateCode: doc.seller?.stateCode },
    buyer: { gstin: doc.buyer?.gstin, stateCode: doc.buyer?.stateCode },
    ...(doc.placeOfSupply ? { placeOfSupply: doc.placeOfSupply } : {}),
    docDate: doc.date,
    currency: doc.currency || "INR",
    policy: { ...(entity?.aatoBand ? { aatoBand: entity.aatoBand } : {}), ...(entity?.einvoiceApplicable !== undefined ? { einvoiceApplicable: entity.einvoiceApplicable } : {}) },
    lines: (doc.lines || []).map((l) => ({
      lineNo: l.lineNo, hsn: l.hsn, qty: l.qty, rate: l.rate,
      discountPct: l.discountPct, uom: l.uom, gstRateOverride: l.gstRate,
    })),
    charges: doc.charges || [],
    roundOff: true,
  };
  const result = await enginePost("/v2/tax/compute", request);
  doc.taxSummary = result.taxSummary || [];
  doc.taxWarnings = result.warnings || [];
  doc.totals = result.totals;
  doc.lines = (doc.lines || []).map((line) => {
    const computed = (result.lines || []).find((l) => l.lineNo === line.lineNo);
    return computed ? { ...line, ...computed } : line;
  });
  await doc.save();
  res.json(result);
}));

// ---------- approval flow ----------

router.post("/:id/submit", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (!scopeAllows(req.scope, CREATE_PERMS[doc.type] || "doc.upload", doc.entityId)) {
    throw fail(403, "FORBIDDEN", "Your role cannot submit this document type");
  }
  if (doc.status !== "draft") throw fail(409, "CONFLICT", `Cannot submit a ${doc.status} document`);
  const roles = await requiredApproversFor(doc.entityId, doc.groupId, doc.type, estimateGrand(doc));
  doc.status = "pending_approval";
  doc.requiredApprovers = roles;
  doc.revision += 1;
  await doc.save();
  res.json({ status: doc.status, approvers: [{ roles }] });
}));

router.post("/:id/approve", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (doc.status !== "pending_approval") throw fail(409, "CONFLICT", `Cannot approve a ${doc.status} document`);
  expectRevision(doc, req.body);
  const actor = actorOf(req);
  if (doc.createdBy === actor) return sodDeny(res, SoD.NOT_APPROVER, req.id);
  if (!scopeAllows(req.scope, "po.approve", doc.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot approve documents", { reason: "Requires po.approve" });
  const held = rolesOn(req.scope, doc.entityId);
  if (doc.requiredApprovers.length && !doc.requiredApprovers.some((r) => held.has(r)) && !held.has("platform_admin")) {
    throw fail(403, "FORBIDDEN", "This amount needs a higher approval level", { reason: `Requires one of: ${doc.requiredApprovers.join(", ")}` });
  }
  doc.approvals.push({ actor, role: [...held].filter((r) => doc.requiredApprovers.includes(r))[0] || "ap_manager", comment: req.body?.comment, at: nowIso() });
  doc.status = "approved";
  doc.revision += 1;
  await doc.save();
  res.json(view(doc));
}));

router.post("/:id/reject", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (doc.status !== "pending_approval") throw fail(409, "CONFLICT", `Cannot reject a ${doc.status} document`);
  if (!scopeAllows(req.scope, "po.approve", doc.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot reject documents", { reason: "Requires po.approve" });
  doc.status = "rejected";
  doc.approvals.push({ actor: actorOf(req), action: "reject", comment: req.body?.reason, at: nowIso() });
  doc.revision += 1;
  await doc.save();
  res.json(view(doc));
}));

// ---------- issue / amend / close ----------

router.post("/:id/issue", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (doc.status !== "approved") throw fail(409, "CONFLICT", `Only approved documents can be issued (status: ${doc.status})`);
  expectRevision(doc, req.body);
  if (!scopeAllows(req.scope, "po.approve", doc.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot issue documents", { reason: "Requires po.approve" });
  const entity = await Entity.findOne({ id: doc.entityId }).lean();
  const { number } = await nextNumber(doc.entityId, doc.groupId, entity.code, doc.type, doc.fy);
  doc.number = number;
  doc.status = "issued";
  doc.issuedAt = nowIso();
  doc.revision += 1;
  doc.contentHash = contentHashOf(doc);
  await doc.save();
  if (doc.type === "PO") doc.caseId = await ensureCaseForPo(doc);
  const verifyUrl = `${process.env.PUBLIC_APP_URL || "http://localhost:3000"}/verify/${doc.contentHash}`;
  res.json({ number: doc.number, contentHash: doc.contentHash, verifyUrl, document: view(doc) });
}));

router.post("/:id/amend", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (!["issued", "acknowledged", "partially_fulfilled"].includes(doc.status)) {
    throw fail(409, "CONFLICT", `Only issued documents can be amended (status: ${doc.status})`);
  }
  if (!scopeAllows(req.scope, "po.create", doc.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot amend documents", { reason: "Requires po.create" });
  const { _id, ...copy } = view(doc);
  const amendment = await Document.create({
    ...copy,
    id: newId("doc"), type: "PO_AMENDMENT", number: null, status: "draft",
    revision: 0, supersedes: doc.id, contentHash: undefined, issuedAt: undefined,
    approvals: [], requiredApprovers: [], createdBy: actorOf(req), observedAt: nowIso(),
  });
  res.status(201).json(view(amendment));
}));

router.post("/:id/short-close", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (!["issued", "acknowledged", "partially_fulfilled"].includes(doc.status)) throw fail(409, "CONFLICT", `Cannot short-close a ${doc.status} document`);
  if (!scopeAllows(req.scope, "po.create", doc.entityId)) throw fail(403, "FORBIDDEN", "Your role cannot short-close documents");
  for (const close of req.body?.lines || []) {
    const line = doc.lines.find((l) => l.lineNo === close.lineNo);
    if (line && close.qty !== undefined) line.qty = String(close.qty);
  }
  doc.status = "short_closed";
  doc.approvals.push({ actor: actorOf(req), action: "short_close", comment: req.body?.reason, at: nowIso() });
  doc.revision += 1;
  await doc.save();
  res.json(view(doc));
}));

router.post("/:id/cancel", handle(async (req, res) => {
  const doc = await loadDoc(req);
  if (["fulfilled", "cancelled"].includes(doc.status)) throw fail(409, "CONFLICT", `Cannot cancel a ${doc.status} document`);
  if (!scopeAllows(req.scope, "po.create", doc.entityId) && !scopeAllows(req.scope, "po.approve", doc.entityId)) {
    throw fail(403, "FORBIDDEN", "Your role cannot cancel documents");
  }
  doc.status = "cancelled";
  doc.approvals.push({ actor: actorOf(req), action: "cancel", comment: req.body?.reason, at: nowIso() });
  doc.revision += 1;
  await doc.save();
  res.json(view(doc));
}));

// ---------- reads ----------

router.get("/", handle(async (req, res) => {
  const { type, status, entityId, supplierId, q, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const skip = Number(Buffer.from(String(req.query.cursor || ""), "base64url").toString() || 0) || 0;
  const filter = { groupId: req.scope.groupId, entityId: { $in: req.scope.entityIds } };
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (entityId) { if (!req.scope.wildcard && !req.scope.entityIds.includes(entityId)) throw fail(404, "NOT_FOUND", "Entity not found"); filter.entityId = entityId; }
  if (supplierId) filter.supplierId = supplierId;
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (q) filter.$or = [
    { number: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    { "seller.name": { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    { externalRef: { $regex: String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
  ];
  const [items, total] = await Promise.all([
    Document.find(filter).sort({ date: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Document.countDocuments(filter),
  ]);
  const nextCursor = skip + limit < total ? Buffer.from(String(skip + limit)).toString("base64url") : null;
  res.json({ items: items.map(view), nextCursor, total });
}));

router.get("/:id", handle(async (req, res) => {
  const doc = await loadDoc(req);
  const links = await DocumentLink.find({ groupId: req.scope.groupId, $or: [{ fromId: doc.id }, { toId: doc.id }] }).lean();
  const lifecycle = doc.type === "PO" || doc.type === "PO_AMENDMENT" ? await lineLifecycle(doc) : null;
  res.json({ ...view(doc), links, lifecycle, caseId: doc.caseId || null });
}));

router.get("/:id/render-model", handle(async (req, res) => {
  const doc = await loadDoc(req);
  const [entity, supplier] = await Promise.all([
    Entity.findOne({ id: doc.entityId }).lean(),
    doc.supplierId ? Supplier.findOne({ id: doc.supplierId, groupId: doc.groupId }).lean() : null,
  ]);
  const verifyUrl = doc.contentHash ? `${process.env.PUBLIC_APP_URL || "http://localhost:3000"}/verify/${doc.contentHash}` : null;
  res.json({
    document: view(doc),
    entity: entity ? { legalName: entity.legalName, tradeName: entity.tradeName, code: entity.code, gstin: entity.gstin, pan: entity.pan, cin: entity.cin, stateCode: entity.stateCode, addresses: entity.addresses, letterhead: entity.letterhead } : null,
    supplier: supplier ? { id: supplier.id, legalName: supplier.legalName, gstins: supplier.gstins, contacts: supplier.contacts } : null,
    taxSummary: doc.taxSummary || [],
    amountInWords: doc.totals?.grand ? amountInWords(doc.totals.grand) : null,
    terms: doc.terms || null,
    verify: verifyUrl ? { url: verifyUrl, hash: doc.contentHash } : null,
  });
}));

export default router;
