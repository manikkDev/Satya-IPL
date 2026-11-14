// authV2.js — JWT middleware for /api/v2 routes. Same JWT_SECRET as server.
//
// Server sessions (server/src/auth/jwt.js signSession) carry:
//   sub (v2 user id), id (mongo id), role (legacy v1 role), gid (active
//   group), mem: [{e: entityId|"*", r: [roles]}], prole (platform role),
//   aud: ["satya-business-v1", "satya-v2"].
// Older/legacy shapes (groupId, memberships[{roles}], roles[]) are still
// accepted so pre-v2 tokens keep working.

import jwt from "jsonwebtoken";

const tokenFrom = (req) => {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
};

export const rolesOf = (decoded) => {
  const roles = new Set();
  if (typeof decoded.role === "string") roles.add(decoded.role);
  if (Array.isArray(decoded.roles)) decoded.roles.forEach((r) => roles.add(r));
  for (const m of decoded.mem || []) (m?.r || []).forEach((r) => roles.add(r));
  for (const m of decoded.memberships || []) (m?.roles || []).forEach((r) => roles.add(r));
  if (decoded.prole) roles.add(decoded.prole);
  if (decoded.platformRole) roles.add(decoded.platformRole);
  return roles;
};

export const entityIdsOf = (decoded) => [
  ...new Set([...(decoded.mem || []).map((m) => m?.e), ...(decoded.memberships || []).map((m) => m?.entityId)].filter(Boolean)),
];

/** Pure claim mapping (exported for tests). */
export const authFromClaims = (decoded) => ({
  // `id` first: existing conversations are keyed by it
  userId: decoded.id || decoded.sub || decoded.userId || null,
  roles: rolesOf(decoded),
  groupId: decoded.gid || decoded.groupId || decoded.activeGroup || null,
  entityIds: entityIdsOf(decoded),
});

/** Attaches req.auth {userId, roles:Set, groupId|null, entityIds} or 401s per contract. */
export const requireJwt = (req, res, next) => {
  const token = tokenFrom(req);
  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to use this feature" } });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const aud = Array.isArray(decoded.aud) ? decoded.aud : decoded.aud ? [decoded.aud] : [];
    // v2 copilot needs the v2 audience when the token declares one
    if (aud.length && !aud.includes("satya-v2") && !aud.includes("satya-business-v1")) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Session not valid for Satya" } });
    }
    req.auth = authFromClaims(decoded);
    if (!req.auth.userId) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to use this feature" } });
    }
    return next();
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Session expired — sign in again" } });
  }
};

export const isAdmin = (auth) =>
  Boolean(auth?.roles?.has("platform_admin") || auth?.roles?.has("group_admin"));
