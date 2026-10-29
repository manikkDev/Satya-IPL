import express from "express";
import { z } from "zod";
import crypto from "node:crypto";
import User from "../../models/User.js";
import Group from "../../models/Group.js";
import Entity from "../../models/Entity.js";
import { signSession } from "../../auth/jwt.js";
import { authenticateV2 } from "../../auth/middleware.js";
import { ensureMemberships, createTenant } from "../../services/identity.js";
import { passwordIssues } from "../../auth/passwords.js";
import { authLimiter } from "../../middleware/rateLimit.js";

const router = express.Router();
router.use(["/login", "/signup"], authLimiter);

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, details });
const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: { code: error.code || "INTERNAL", message: status < 500 ? error.message : "Could not complete this request", details: error.details } });
  }
};

const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) });
const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  groupName: z.string().trim().min(2).max(160),
  entityCode: z.string().trim().regex(/^[A-Za-z0-9]{2,8}$/).optional(),
  entityLegalName: z.string().trim().max(160).optional(),
  stateCode: z.string().regex(/^\d{2}$/).optional(),
}).strict();

const publicView = (user) => ({ id: user.v2id || String(user._id), name: user.name, email: user.email, platformRole: user.platformRole || undefined });

const groupsOf = async (user) => {
  const ids = [...new Set((user.memberships || []).map((m) => m.groupId))];
  const groups = await Group.find({ id: { $in: ids } }).select("id name plan").lean();
  return groups.map((g) => ({ id: g.id, name: g.name, plan: g.plan }));
};

const pickActiveGroup = (user) => {
  const ids = new Set((user.memberships || []).map((m) => m.groupId));
  return ids.has(user.activeGroupId) ? user.activeGroupId : [...ids][0];
};

const sessionPayload = async (user) => {
  const activeGroupId = pickActiveGroup(user);
  if (activeGroupId && user.activeGroupId !== activeGroupId) { user.activeGroupId = activeGroupId; await user.save(); }
  const memberships = (user.memberships || []).map((m) => ({ groupId: m.groupId, entityId: m.entityId, roles: m.roles }));
  return {
    token: signSession(user, { groupId: activeGroupId, memberships }),
    user: publicView(user),
    memberships,
    groups: await groupsOf(user),
    activeGroup: activeGroupId,
  };
};

router.post("/login", handle(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw fail(422, "VALIDATION_FAILED", "Email and password are required", { fields: parsed.error.issues.map((i) => i.path.join(".")) });
  const user = await User.findOne({ email: parsed.data.email.trim().toLowerCase(), active: true });
  if (!user || !(await user.matchPassword(parsed.data.password))) throw fail(401, "UNAUTHENTICATED", "Invalid email or password");
  await ensureMemberships(user);
  res.json(await sessionPayload(user));
}));

router.post("/signup", handle(async (req, res) => {
  // privileged self-assignment is never allowed: signup always creates a NEW
  // trial group; joining an existing group requires an admin invitation.
  if (req.body && (req.body.role || req.body.roles || req.body.memberships || req.body.groupId)) {
    throw fail(422, "VALIDATION_FAILED", "Roles and group membership are provisioned by an administrator", {});
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    throw fail(422, "VALIDATION_FAILED", "Check the sign-up details", { fields: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  }
  const { name, email, password, groupName, entityCode, entityLegalName, stateCode } = parsed.data;
  const pwIssues = passwordIssues(password);
  if (pwIssues.length) throw fail(422, "VALIDATION_FAILED", pwIssues[0], { fields: ["password"] });
  const emailLc = email.trim().toLowerCase();
  if (await User.exists({ email: emailLc })) throw fail(409, "CONFLICT", "An account with this email already exists");

  const { group, entity } = await createTenant({ groupName, entityCode, entityLegalName, stateCode });
  try {
    const user = await User.create({
      name, email: emailLc, password,
      role: "admin",                       // legacy role for the v1 claim shape
      companyId: group.id,
      memberships: [{ groupId: group.id, entityId: "*", roles: ["group_admin"] }],
      activeGroupId: group.id,
      active: true,
    });
    res.status(201).json({ ...(await sessionPayload(user)), entity: { id: entity.id, code: entity.code, legalName: entity.legalName } });
  } catch (error) {
    await Entity.deleteOne({ id: entity.id });
    await Group.deleteOne({ id: group.id });
    throw error;
  }
}));

router.post("/switch-group", authenticateV2, handle(async (req, res) => {
  const groupId = typeof req.body?.groupId === "string" ? req.body.groupId : null;
  if (!groupId) throw fail(422, "VALIDATION_FAILED", "groupId is required");
  if (!req.user.memberships.some((m) => m.groupId === groupId)) {
    throw fail(403, "FORBIDDEN", "You are not a member of that group");
  }
  req.user.activeGroupId = groupId;
  await req.user.save();
  res.json(await sessionPayload(req.user));
}));

export default router;
