// Workflow features ported from the teammate's v1 branch onto the v2 model:
// case assignment, follow-up reminders, derived notifications, a
// transparent supplier risk score, a supplier-communication outbox and a
// CSV case report. Everything is group-scoped and permission-checked; no
// unauthenticated paths, no seeded/fabricated records.

import express from "express";
import { z } from "zod";
import Case from "../../models/Case.js";
import Finding from "../../models/Finding.js";
import Document from "../../models/Document.js";
import DocumentLink from "../../models/DocumentLink.js";
import User from "../../models/User.js";
import Reminder from "../../models/Reminder.js";
import OutboxMessage from "../../models/OutboxMessage.js";
import NotificationState from "../../models/NotificationState.js";
import Supplier from "../../models/Supplier.js";
import { newId } from "../../lib/ids.js";
import { scopeAllows } from "../../auth/rbac.js";
import { scoreSuppliers } from "../../services/riskScore.js";
import { attemptSend, quietHoursRelease, shareLink, smtpConfigured } from "../../services/outbox.js";
import { fail, handle, assertPlainInput } from "./util.js";

const router = express.Router();
const actor = (req) => req.user.v2id || String(req.user._id);
const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const visibleEntities = (req) => (req.scope.wildcard ? null : req.scope.entityIds);

const loadCase = async (req, id = req.params.id) => {
  const kase = await Case.findOne({ id, groupId: req.scope.groupId });
  if (!kase || (!req.scope.wildcard && !req.scope.entityIds.includes(kase.entityId))) throw fail(404, "NOT_FOUND", "Case not found");
  return kase;
};
const requirePerm = (req, perm, entityId) => {
  if (!scopeAllows(req.scope, perm, entityId)) throw fail(403, "FORBIDDEN", `Your role cannot do this`, { reason: `Requires ${perm}` });
};
const parse = (schema, body) => {
  assertPlainInput(body);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  return parsed.data;
};
/** Replace internal doc_* ids in engine messages with document numbers. */
const humanText = (text, names) => String(text || "").replace(/doc_[\w]+/g, (id) => names?.get(id) ?? id);

const groupMembers = async (groupId) =>
  User.find({ "memberships.groupId": groupId, active: { $ne: false } }, { v2id: 1, name: 1, email: 1, memberships: 1 }).lean();

/* ---------------- assignment ---------------- */

router.get("/assignees", handle(async (req, res) => {
  const users = await groupMembers(req.scope.groupId);
  res.json({
    items: users
      .filter((u) => u.v2id)
      .map((u) => ({
        id: u.v2id,
        name: u.name || u.email,
        roles: [...new Set(u.memberships.filter((m) => m.groupId === req.scope.groupId).flatMap((m) => m.roles))],
      })),
  });
}));

const assignSchema = z.object({
  assignee: z.string().min(1).max(64).nullable(),
  priority: z.enum(["low", "normal", "high"]).optional(),
}).strict();

router.post("/cases/:id/assign", handle(async (req, res) => {
  const body = parse(assignSchema, req.body);
  const kase = await loadCase(req);
  requirePerm(req, "finding.decide", kase.entityId);
  if (body.assignee) {
    const member = await User.exists({ v2id: body.assignee, "memberships.groupId": req.scope.groupId });
    if (!member) throw fail(422, "VALIDATION_FAILED", "That person isn’t a member of this workspace", { fields: [{ field: "assignee" }] });
  }
  // Assignment is workflow metadata, not evidence: it must not bump the case
  // revision (a running check would otherwise fail its stale-write guard).
  await Case.updateOne(
    { id: kase.id, groupId: req.scope.groupId },
    { $set: { assignee: body.assignee ?? null, ...(body.priority ? { priority: body.priority } : {}) } },
  );
  res.json({ id: kase.id, assignee: body.assignee ?? null, priority: body.priority ?? kase.priority });
}));

/* ---------------- reminders ---------------- */

const reminderSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(3).max(500),
  assignee: z.string().max(64).optional(),
}).strict();

router.get("/cases/:id/reminders", handle(async (req, res) => {
  const kase = await loadCase(req);
  const items = await Reminder.find({ groupId: req.scope.groupId, caseId: kase.id }).sort({ status: -1, dueDate: 1 }).lean();
  res.json({ items });
}));

router.post("/cases/:id/reminders", handle(async (req, res) => {
  const body = parse(reminderSchema, req.body);
  const kase = await loadCase(req);
  requirePerm(req, "finding.decide", kase.entityId);
  if (Number.isNaN(Date.parse(`${body.dueDate}T00:00:00+05:30`))) throw fail(422, "VALIDATION_FAILED", "Due date isn’t a real date");
  const reminder = await Reminder.create({
    id: newId("rem"), groupId: req.scope.groupId, entityId: kase.entityId, caseId: kase.id,
    dueDate: body.dueDate, note: body.note, assignee: body.assignee || kase.assignee || actor(req), createdBy: actor(req),
  });
  res.status(201).json(reminder.toObject());
}));

router.patch("/reminders/:id", handle(async (req, res) => {
  const body = parse(z.object({ status: z.enum(["open", "done"]) }).strict(), req.body);
  const reminder = await Reminder.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!reminder) throw fail(404, "NOT_FOUND", "Reminder not found");
  await loadCase(req, reminder.caseId);
  requirePerm(req, "finding.decide", reminder.entityId);
  reminder.status = body.status;
  reminder.doneAt = body.status === "done" ? new Date().toISOString() : undefined;
  reminder.doneBy = body.status === "done" ? actor(req) : undefined;
  await reminder.save();
  res.json(reminder.toObject());
}));

/* ---------------- notifications (derived, never seeded) ---------------- */

router.get("/notifications", handle(async (req, res) => {
  const me = actor(req);
  const entities = visibleEntities(req);
  const entityFilter = entities ? { entityId: { $in: entities } } : {};
  const since = new Date(Date.now() - 14 * 86_400_000);
  const today = todayIst();

  const [findings, reminders, assigned, dismissed] = await Promise.all([
    Finding.find({ groupId: req.scope.groupId, ...entityFilter, status: "open", severity: { $in: ["critical", "high"] }, createdAt: { $gte: since } },
      { id: 1, caseId: 1, title: 1, severity: 1, code: 1, createdAt: 1, "data.message": 1 }).sort({ createdAt: -1 }).limit(60).lean(),
    Reminder.find({ groupId: req.scope.groupId, ...entityFilter, status: "open", dueDate: { $lte: today }, $or: [{ assignee: me }, { createdBy: me }] }).limit(20).lean(),
    Case.find({ groupId: req.scope.groupId, ...entityFilter, assignee: me, status: { $in: ["open", "in_review", "escalated", "on_hold"] } }, { id: 1, title: 1, updatedAt: 1 }).limit(20).lean(),
    NotificationState.find({ groupId: req.scope.groupId, userId: me }, { key: 1 }).lean(),
  ]);
  const hidden = new Set(dismissed.map((d) => d.key));
  const referenced = [...new Set(findings.flatMap((f) => String(f.data?.message || "").match(/doc_[\w]+/g) || []))];
  const nameDocs = referenced.length ? await Document.find({ groupId: req.scope.groupId, id: { $in: referenced } }, { id: 1, number: 1 }).lean() : [];
  const docNames = new Map(nameDocs.map((d) => [d.id, d.number || d.id]));
  const items = [];
  const seenFinding = new Set();
  for (const f of findings) {
    const key = `finding:${f.caseId}:${f.id}`;
    if (seenFinding.has(key) || hidden.has(key)) continue;
    seenFinding.add(key);
    items.push({ key, kind: "finding", severity: f.severity, title: humanText(f.title || f.data?.message, docNames) || f.code.replaceAll("_", " ").toLowerCase(), href: `/app/investigations/${f.caseId}`, at: f.createdAt });
  }
  for (const r of reminders) {
    const key = `reminder:${r.id}`;
    if (hidden.has(key)) continue;
    items.push({ key, kind: "reminder", severity: r.dueDate < today ? "high" : "medium", title: r.note, detail: r.dueDate < today ? `Overdue since ${r.dueDate}` : "Due today", href: `/app/investigations/${r.caseId}`, at: r.dueDate });
  }
  for (const c of assigned) {
    const key = `assigned:${c.id}`;
    if (hidden.has(key)) continue;
    items.push({ key, kind: "assignment", severity: "info", title: `Assigned to you: ${c.title}`, href: `/app/investigations/${c.id}`, at: c.updatedAt });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  res.json({ items: items.slice(0, 30), unread: items.length });
}));

router.post("/notifications/dismiss", handle(async (req, res) => {
  const body = parse(z.object({ keys: z.array(z.string().min(1).max(160)).min(1).max(100) }).strict(), req.body);
  const now = new Date().toISOString();
  await NotificationState.bulkWrite(body.keys.map((key) => ({
    updateOne: {
      filter: { groupId: req.scope.groupId, userId: actor(req), key },
      update: { $setOnInsert: { dismissedAt: now } },
      upsert: true,
    },
  })));
  res.json({ dismissed: body.keys.length });
}));

/* ---------------- supplier risk score ---------------- */

router.get("/risk/suppliers", handle(async (req, res) => {
  const items = await scoreSuppliers({ groupId: req.scope.groupId, entityIds: visibleEntities(req) });
  res.json({ items, method: "rule-based", note: "A prioritisation aid built from open issues and master-data checks — not a prediction." });
}));

router.get("/risk/suppliers/:id", handle(async (req, res) => {
  const [item] = await scoreSuppliers({ groupId: req.scope.groupId, entityIds: visibleEntities(req), supplierId: req.params.id });
  if (!item) throw fail(404, "NOT_FOUND", "Supplier not found");
  res.json(item);
}));

/* ---------------- outbox ---------------- */

const outboxSchema = z.object({
  channel: z.enum(["email", "whatsapp", "sms"]),
  to: z.string().trim().min(3).max(200),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5).max(5000),
  caseId: z.string().max(64).optional(),
  supplierId: z.string().max(64).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
}).strict();

const outboxView = (m) => {
  const o = m.toObject ? m.toObject() : m;
  delete o._id; delete o.__v;
  return o;
};

router.get("/outbox/config", handle(async (_req, res) => {
  res.json({ email: smtpConfigured(), whatsapp: true, sms: true, quietHours: "22:00–08:00 IST (email only)" });
}));

router.get("/outbox", handle(async (req, res) => {
  const filter = { groupId: req.scope.groupId };
  if (req.query.caseId) filter.caseId = String(req.query.caseId);
  if (req.query.supplierId) filter.supplierId = String(req.query.supplierId);
  const items = await OutboxMessage.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items: items.map(outboxView) });
}));

router.post("/outbox", handle(async (req, res) => {
  const body = parse(outboxSchema, req.body);
  let entityId;
  if (body.caseId) entityId = (await loadCase(req, body.caseId)).entityId;
  requirePerm(req, "finding.decide", entityId);
  if (body.supplierId && !(await Supplier.exists({ id: body.supplierId, groupId: req.scope.groupId }))) {
    throw fail(404, "NOT_FOUND", "Supplier not found");
  }
  if (body.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.to)) {
    throw fail(422, "VALIDATION_FAILED", "Enter a valid email address", { fields: [{ field: "to" }] });
  }
  if (body.channel !== "email" && body.to.replace(/[^\d]/g, "").length < 10) {
    throw fail(422, "VALIDATION_FAILED", "Enter a valid mobile number", { fields: [{ field: "to" }] });
  }
  const idempotencyKey = body.idempotencyKey || req.get("Idempotency-Key") || newId("idem");
  const existing = await OutboxMessage.findOne({ groupId: req.scope.groupId, idempotencyKey });
  if (existing) return res.json(outboxView(existing));

  const message = new OutboxMessage({
    id: newId("msg"), groupId: req.scope.groupId, entityId, caseId: body.caseId, supplierId: body.supplierId,
    channel: body.channel, to: body.to, subject: body.subject, body: body.body, idempotencyKey, createdBy: actor(req),
  });
  if (body.channel !== "email") {
    message.status = "link_ready";
    message.link = shareLink(body.channel, body.to, body.body);
    await message.save();
    return res.status(201).json(outboxView(message));
  }
  const release = quietHoursRelease();
  if (release && smtpConfigured()) {
    message.status = "scheduled";
    message.scheduledFor = release.toISOString();
    await message.save();
    return res.status(201).json(outboxView(message));
  }
  await message.save();
  await attemptSend(message);
  res.status(201).json(outboxView(message));
}));

router.post("/outbox/:id/send", handle(async (req, res) => {
  const message = await OutboxMessage.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!message) throw fail(404, "NOT_FOUND", "Message not found");
  requirePerm(req, "finding.decide", message.entityId);
  if (message.channel !== "email") throw fail(409, "CONFLICT", "WhatsApp and SMS messages are sent from your own device via the share link");
  if (["sent", "cancelled"].includes(message.status)) throw fail(409, "CONFLICT", `This message is already ${message.status}`);
  await attemptSend(message);
  res.json(outboxView(message));
}));

router.post("/outbox/:id/cancel", handle(async (req, res) => {
  const message = await OutboxMessage.findOne({ id: req.params.id, groupId: req.scope.groupId });
  if (!message) throw fail(404, "NOT_FOUND", "Message not found");
  requirePerm(req, "finding.decide", message.entityId);
  if (["sent", "cancelled"].includes(message.status)) throw fail(409, "CONFLICT", `This message is already ${message.status}`);
  message.status = "cancelled";
  await message.save();
  res.json(outboxView(message));
}));

/* ---------------- CSV case report ---------------- */

// Cells beginning with = + - @ (or tab/CR) are prefixed so spreadsheets never
// evaluate them as formulas.
export const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

router.get("/cases/:id/report.csv", handle(async (req, res) => {
  const kase = await loadCase(req);
  requirePerm(req, "evidence.export", kase.entityId);
  const findings = kase.latestSnapshotId
    ? await Finding.find({ groupId: req.scope.groupId, caseId: kase.id, snapshotId: kase.latestSnapshotId }).lean()
    : [];
  const links = await DocumentLink.find({ groupId: req.scope.groupId, $or: [{ fromId: { $in: kase.subjectIds } }, { toId: { $in: kase.subjectIds } }] }, { fromId: 1, toId: 1 }).lean();
  const docIds = [...new Set([...kase.subjectIds, ...links.flatMap((l) => [l.fromId, l.toId])])];
  const docs = await Document.find({ groupId: req.scope.groupId, id: { $in: docIds } }, { id: 1, type: 1, number: 1, externalRef: 1, date: 1, status: 1, totals: 1, "seller.name": 1 }).lean();
  const grand = (t) => (t && typeof t.grand === "object" ? t.grand?.amount : t?.grand) ?? "";
  const nameById = new Map(docs.map((d) => [d.id, d.number || d.externalRef || d.id]));

  const lines = [
    csvRow(["Satya case report"]),
    csvRow(["Case", kase.id]), csvRow(["Title", kase.title]), csvRow(["Status", kase.status]),
    csvRow(["Generated (IST)", new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })]),
    "",
    csvRow(["Findings"]),
    csvRow(["Code", "Title", "Severity", "Certainty", "Status", "Explanation"]),
    ...findings.map((f) => csvRow([f.code, humanText(f.title || f.data?.message, nameById), f.severity, f.certainty, f.status, humanText(f.data?.explanation ?? f.data?.message ?? "", nameById)])),
    "",
    csvRow(["Documents"]),
    csvRow(["Type", "Number", "Date", "Party", "Status", "Total"]),
    ...docs.map((d) => csvRow([d.type, d.number || d.externalRef || d.id, d.date, d.seller?.name, d.status, grand(d.totals)])),
  ];
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${kase.id}-report.csv"`);
  res.send(`﻿${lines.join("\r\n")}\r\n`);
}));

export default router;
