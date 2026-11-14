import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import Entity from "../../models/Entity.js";
import Group from "../../models/Group.js";
import User from "../../models/User.js";
import Document from "../../models/Document.js";
import FileDoc from "../../models/FileDoc.js";
import Supplier from "../../models/Supplier.js";
import Snapshot from "../../models/Snapshot.js";
import Case from "../../models/Case.js";
import Invite from "../../models/Invite.js";
import { newId } from "../../lib/ids.js";
import { validateGstin, stateFor } from "../../lib/gstin.js";
import { requirePermission, scopeAllows, ROLES } from "../../auth/rbac.js";
import { signSession } from "../../auth/jwt.js";
import { passwordIssues } from "../../auth/passwords.js";
import { authLimiter } from "../../middleware/rateLimit.js";
import { fail, handle, assertPlainInput } from "./util.js";

// First-run setup for a new workspace (company details → import data →
// invite team → first check). Two routers:
//   default export  — authenticated; mount AFTER authenticateV2 + loadScope
//                     at /api/v2/onboarding
//   publicRouter    — invite lookup + acceptance; mount BEFORE the auth
//                     middleware at /api/v2/auth (next to auth.js)

const router = express.Router();
export const publicRouter = express.Router();

const INVITE_TTL_DAYS = 14;
const stateName = (code) => {
  const name = code ? stateFor(code)?.name : null;
  return name ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(And|Of)\b/g, (w) => w.toLowerCase()) : null;
};
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// Roles an admin may hand out from the setup screen. platform_admin is never
// grantable; group_admin only by someone who already manages the group.
const INVITABLE_ROLES = ROLES.filter((r) => r !== "platform_admin");
const LEGACY_ROLE_FOR = (roles) =>
  roles.includes("group_admin") || roles.includes("entity_admin") ? "admin"
    : roles.includes("ap_manager") ? "ap_manager"
      : roles.includes("auditor") ? "auditor"
        : "ops_analyst";

const inScope = (req, entityId) => req.scope.wildcard || req.scope.entityIds.includes(entityId);

const primaryEntity = async (req, entityId) => {
  if (entityId) {
    if (!inScope(req, entityId)) throw fail(404, "NOT_FOUND", "Company not found");
    const entity = await Entity.findOne({ id: entityId, groupId: req.scope.groupId });
    if (!entity) throw fail(404, "NOT_FOUND", "Company not found");
    return entity;
  }
  return Entity.findOne({ groupId: req.scope.groupId, id: { $in: req.scope.entityIds } }).sort({ createdAt: 1 });
};

const entityView = (e) => e && ({
  id: e.id, code: e.code, legalName: e.legalName, tradeName: e.tradeName ?? null,
  gstin: e.gstin ?? null, pan: e.pan ?? null, stateCode: e.stateCode ?? null,
  stateName: stateName(e.stateCode),
  address: e.addresses?.billing ?? null,
});

/* ------------------------------------------------------------------ */
/* GET /onboarding/status — derived, never stored (except "dismissed"). */
/* ------------------------------------------------------------------ */
router.get("/status", handle(async (req, res) => {
  const gid = req.scope.groupId;
  const entityFilter = { groupId: gid, entityId: { $in: req.scope.entityIds } };
  const [entity, group, documents, files, suppliers, members, pendingInvites, cases, checked] = await Promise.all([
    primaryEntity(req, typeof req.query.entityId === "string" ? req.query.entityId : undefined),
    Group.findOne({ id: gid }).select("id name plan settings").lean(),
    Document.countDocuments({ ...entityFilter, status: { $ne: "cancelled" } }),
    FileDoc.countDocuments({ groupId: gid }),
    Supplier.countDocuments({ groupId: gid }),
    User.countDocuments({ active: true, "memberships.groupId": gid }),
    Invite.countDocuments({ groupId: gid, status: "pending", expiresAt: { $gt: new Date() } }),
    Case.countDocuments(entityFilter),
    Snapshot.exists({ groupId: gid, scenario: { $ne: true } }),
  ]);

  const steps = {
    company: { done: Boolean(entity?.gstin && entity?.legalName), entity: entityView(entity) },
    data: { done: documents > 0 || files > 0, documents, files, suppliers },
    team: { done: members > 1 || pendingInvites > 0, members, pendingInvites },
    firstCheck: { done: Boolean(checked), cases },
  };
  const completed = Object.values(steps).filter((s) => s.done).length;
  const dismissedAt = group?.settings?.onboarding?.dismissedAt ?? null;
  res.json({
    groupId: gid,
    groupName: group?.name ?? null,
    plan: group?.plan ?? null,
    steps,
    completed,
    total: 4,
    // "new" = nothing to reconcile yet; the client opens /app/setup for these
    isNew: documents === 0 && files === 0,
    dismissedAt,
    canManage: scopeAllows(req.scope, "entity.manage", entity?.id),
    canInvite: scopeAllows(req.scope, "user.manage", entity?.id),
  });
}));

/* PATCH /onboarding/dismiss {dismissed} — hide/show the setup checklist. */
router.patch("/dismiss", requirePermission("entity.manage"), handle(async (req, res) => {
  const dismissed = req.body?.dismissed !== false;
  const group = await Group.findOne({ id: req.scope.groupId });
  if (!group) throw fail(404, "NOT_FOUND", "Workspace not found");
  group.settings = { ...(group.settings || {}), onboarding: { ...(group.settings?.onboarding || {}), dismissedAt: dismissed ? new Date().toISOString() : null } };
  group.markModified("settings");
  await group.save();
  res.json({ dismissedAt: group.settings.onboarding.dismissedAt });
}));

/* ------------------------------------------------------------------ */
/* PATCH /onboarding/company — legal name, GSTIN (→ state, PAN), address */
/* ------------------------------------------------------------------ */
const companySchema = z.object({
  entityId: z.string().max(64).optional(),
  legalName: z.string().trim().min(2).max(160),
  tradeName: z.string().trim().max(160).optional().or(z.literal("")),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, "GSTIN has 15 letters and digits"),
  address: z.object({
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).optional().or(z.literal("")),
    city: z.string().trim().min(2).max(80),
    pin: z.string().trim().regex(/^[1-9][0-9]{5}$/, "PIN code has 6 digits"),
  }).strict().optional(),
}).strict();

router.patch(
  "/company",
  requirePermission("entity.manage", { entityFrom: (req) => req.body?.entityId }),
  handle(async (req, res) => {
    assertPlainInput(req.body);
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) {
      throw fail(422, "VALIDATION_FAILED", parsed.error.issues[0]?.message || "Check the company details", {
        fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    const { entityId, legalName, tradeName, gstin, address } = parsed.data;
    const check = validateGstin(gstin);
    if (!check.wellFormed) throw fail(422, "VALIDATION_FAILED", "This GSTIN is not in the right format, or its state code is unknown", { fields: [{ field: "gstin", message: "format" }] });
    if (!check.checksumValid) throw fail(422, "VALIDATION_FAILED", "This GSTIN's last character doesn't match — please check for a typo", { fields: [{ field: "gstin", message: "checksum" }] });

    const entity = await primaryEntity(req, entityId);
    if (!entity) throw fail(404, "NOT_FOUND", "No company found in this workspace");
    const clash = await Entity.exists({ groupId: req.scope.groupId, gstin, id: { $ne: entity.id } });
    if (clash) throw fail(409, "CONFLICT", "Another company in this workspace already uses this GSTIN");

    const state = stateName(check.stateCode);
    entity.legalName = legalName;
    if (tradeName !== undefined) entity.tradeName = tradeName || undefined;
    entity.gstin = gstin;
    entity.pan = check.panEmbedded;
    entity.stateCode = check.stateCode;
    if (address) {
      entity.addresses = {
        ...(entity.addresses?.toObject?.() ?? entity.addresses ?? {}),
        billing: { line1: address.line1, line2: address.line2 || undefined, city: address.city, pin: address.pin, state: state ?? undefined, stateCode: check.stateCode },
      };
      entity.markModified("addresses");
    }
    await entity.save();
    res.json({ entity: entityView(entity), gstin: { ...check, stateName: state } });
  })
);

/* ------------------------------------------------------------------ */
/* Team: members + invites (user.manage)                               */
/* ------------------------------------------------------------------ */
const inviteView = (i) => ({
  id: i.id, email: i.email, roles: i.roles, entityId: i.entityId, status: i.status,
  invitedByName: i.invitedByName ?? null, expiresAt: i.expiresAt, createdAt: i.createdAt,
});

router.get("/invites", requirePermission("user.manage"), handle(async (req, res) => {
  const gid = req.scope.groupId;
  const [users, invites] = await Promise.all([
    User.find({ active: true, "memberships.groupId": gid }).select("v2id name email memberships").lean(),
    Invite.find({ groupId: gid, status: "pending", expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).lean(),
  ]);
  res.json({
    members: users.map((u) => ({
      id: u.v2id || String(u._id), name: u.name, email: u.email,
      roles: [...new Set((u.memberships || []).filter((m) => m.groupId === gid).flatMap((m) => m.roles))],
    })),
    invites: invites.map(inviteView),
  });
}));

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(INVITABLE_ROLES),
  entityId: z.string().max(64).optional(),
}).strict();

router.post("/invites", requirePermission("user.manage", { entityFrom: (req) => req.body?.entityId }), handle(async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", parsed.error.issues[0]?.message || "Check the invitation details", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const { email, role, entityId = "*" } = parsed.data;
  const gid = req.scope.groupId;
  if (role === "group_admin" && !scopeAllows(req.scope, "group.manage")) throw fail(403, "FORBIDDEN", "Only a group admin can invite another group admin");
  if (entityId !== "*" && !inScope(req, entityId)) throw fail(404, "NOT_FOUND", "Company not found");

  const existing = await User.findOne({ email, active: true }).select("memberships").lean();
  if (existing?.memberships?.some((m) => m.groupId === gid)) throw fail(409, "CONFLICT", "This person is already in your workspace");

  // Re-inviting the same email replaces the earlier link.
  await Invite.updateMany({ groupId: gid, email, status: "pending" }, { $set: { status: "revoked" } });
  const token = crypto.randomBytes(24).toString("base64url");
  const invite = await Invite.create({
    id: newId("inv"), groupId: gid, entityId, email, roles: [role],
    tokenHash: hashToken(token), invitedBy: req.user.v2id || String(req.user._id), invitedByName: req.user.name,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86400000),
  });
  // The raw token is returned exactly once so the admin can share the link.
  res.status(201).json({ invite: inviteView(invite), token, joinPath: `/signup?invite=${token}` });
}));

router.delete("/invites/:id", requirePermission("user.manage"), handle(async (req, res) => {
  const invite = await Invite.findOneAndUpdate(
    { id: req.params.id, groupId: req.scope.groupId, status: "pending" },
    { $set: { status: "revoked" } },
    { returnDocument: "after" }
  ).lean();
  if (!invite) throw fail(404, "NOT_FOUND", "Invitation not found");
  res.json({ invite: inviteView(invite) });
}));

/* ------------------------------------------------------------------ */
/* Public: look up and accept an invitation                            */
/* ------------------------------------------------------------------ */
publicRouter.use(["/invites", "/accept-invite"], authLimiter);

const liveInvite = async (token) => {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) throw fail(404, "NOT_FOUND", "This invitation link is not valid");
  const invite = await Invite.findOne({ tokenHash: hashToken(token) });
  if (!invite || invite.status !== "pending") throw fail(404, "NOT_FOUND", "This invitation link is not valid or was already used");
  if (invite.expiresAt <= new Date()) throw fail(410, "EXPIRED", "This invitation has expired — ask your admin for a new link");
  return invite;
};

publicRouter.get("/invites/:token", handle(async (req, res) => {
  const invite = await liveInvite(req.params.token);
  const group = await Group.findOne({ id: invite.groupId }).select("name").lean();
  const hasAccount = Boolean(await User.exists({ email: invite.email, active: true }));
  res.json({
    email: invite.email, roles: invite.roles, groupName: group?.name ?? "your company",
    invitedByName: invite.invitedByName ?? null, expiresAt: invite.expiresAt, hasAccount,
  });
}));

const acceptSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(1).max(128),
}).strict();

publicRouter.post("/accept-invite", handle(async (req, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Check your details", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const { token, name, password } = parsed.data;
  const invite = await liveInvite(token);
  const membership = { groupId: invite.groupId, entityId: invite.entityId, roles: invite.roles };

  let user = await User.findOne({ email: invite.email });
  if (user) {
    // Existing account: prove ownership with the current password.
    if (!user.active || !(await user.matchPassword(password))) throw fail(401, "UNAUTHENTICATED", "That password doesn't match your existing Satya account");
    if (!user.memberships.some((m) => m.groupId === invite.groupId)) user.memberships.push(membership);
    user.activeGroupId = invite.groupId;
    await user.save();
  } else {
    if (!name) throw fail(422, "VALIDATION_FAILED", "Your name is required", { fields: ["name"] });
    const issues = passwordIssues(password);
    if (issues.length) throw fail(422, "VALIDATION_FAILED", issues[0], { fields: ["password"] });
    user = await User.create({
      name, email: invite.email, password,
      role: LEGACY_ROLE_FOR(invite.roles),
      companyId: invite.groupId,
      memberships: [membership],
      activeGroupId: invite.groupId,
      active: true,
    });
  }

  // Single-use: a concurrent second accept loses this compare-and-set.
  const claimed = await Invite.updateOne(
    { id: invite.id, status: "pending" },
    { $set: { status: "accepted", acceptedAt: new Date(), acceptedBy: user.v2id || String(user._id) } }
  );
  if (claimed.modifiedCount !== 1) throw fail(409, "CONFLICT", "This invitation was already used");

  const memberships = user.memberships.map((m) => ({ groupId: m.groupId, entityId: m.entityId, roles: m.roles }));
  const groupIds = [...new Set(memberships.map((m) => m.groupId))];
  const groups = await Group.find({ id: { $in: groupIds } }).select("id name plan").lean();
  res.status(201).json({
    token: signSession(user, { groupId: invite.groupId, memberships }),
    user: { id: user.v2id || String(user._id), name: user.name, email: user.email },
    memberships,
    groups: groups.map((g) => ({ id: g.id, name: g.name, plan: g.plan })),
    activeGroup: invite.groupId,
  });
}));

export default router;
