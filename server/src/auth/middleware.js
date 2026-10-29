import User from "../models/User.js";
import Entity from "../models/Entity.js";
import { verifySession } from "./jwt.js";
import { permissionsFor } from "./rbac.js";
import { ensureMemberships } from "../services/identity.js";

const unauthorized = (res, req, message = "Authentication required") =>
  res.status(401).json({ error: { code: "UNAUTHENTICATED", message, requestId: req.id } });

// Verifies the hybrid session token (v2 audience), loads the user, and lazily
// migrates legacy companyId users so every request has a group scope.
export const authenticateV2 = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return unauthorized(res, req);
  try {
    const decoded = verifySession(token);
    const user = await User.findById(decoded.id);
    if (!user?.active) return unauthorized(res, req);
    if (decoded.tv !== undefined && decoded.tv !== (user.tokenVersion ?? 0)) {
      return unauthorized(res, req, "Session expired — please sign in again");
    }
    if (user.erasedAt) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Account erased under a data-rights request", requestId: req.id } });
    }
    await ensureMemberships(user); // idempotent legacy companyId -> group/entity
    if (decoded.gid && !user.memberships.some((m) => m.groupId === decoded.gid)) {
      return unauthorized(res, req, "Session group membership is no longer valid");
    }
    req.user = user;
    req.auth = decoded;
    next();
  } catch {
    return unauthorized(res, req, "Valid Satya session required");
  }
};

// Resolves req.scope = {groupId, entityIds, wildcard, rolesByEntity,
// permissions, isPlatformAdmin} — every v2 route runs after this.
export const loadScope = async (req, res, next) => {
  try {
    const gid = req.auth.gid || req.user.activeGroupId || req.user.memberships[0]?.groupId;
    const memberships = (req.user.memberships || []).filter((m) => m.groupId === gid);
    if (!gid || memberships.length === 0) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "No group membership", requestId: req.id } });
    }
    const rolesByEntity = {};
    for (const m of memberships) {
      rolesByEntity[m.entityId] = [...new Set([...(rolesByEntity[m.entityId] || []), ...m.roles])];
    }
    const wildcard = Boolean(rolesByEntity["*"]);
    const entityIds = wildcard
      ? await Entity.find({ groupId: gid }).distinct("id")
      : Object.keys(rolesByEntity);
    const allRoles = [...new Set(Object.values(rolesByEntity).flat())];
    req.scope = {
      groupId: gid,
      entityIds,
      wildcard,
      rolesByEntity,
      permissions: permissionsFor(allRoles),
      isPlatformAdmin: req.user.platformRole === "platform_admin",
    };
    next();
  } catch (error) {
    next(error);
  }
};

// Query helper: always injects group + entity scoping (02 §2 scoping rule).
export const scopedFilter = (req, extra = {}) => ({
  groupId: req.scope.groupId,
  entityId: { $in: req.scope.entityIds },
  ...extra,
});
