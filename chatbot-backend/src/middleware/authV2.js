// authV2.js — JWT middleware for /api/v2 routes. Same JWT_SECRET as server.
// Role extraction tolerates legacy and v2 token shapes.

import jwt from "jsonwebtoken";

const tokenFrom = (req) => {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : null;
};

const rolesOf = (decoded) => {
  const roles = new Set();
  if (typeof decoded.role === "string") roles.add(decoded.role);
  if (Array.isArray(decoded.roles)) decoded.roles.forEach((r) => roles.add(r));
  for (const m of decoded.memberships || []) {
    (m?.roles || []).forEach((r) => roles.add(r));
  }
  if (decoded.platformRole) roles.add(decoded.platformRole);
  return roles;
};

/** Attaches req.auth {userId, roles:Set, groupId|null} or 401s per contract. */
export const requireJwt = (req, res, next) => {
  const token = tokenFrom(req);
  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to use this feature" } });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.auth = {
      userId: decoded.id || decoded.sub || decoded.userId || null,
      roles: rolesOf(decoded),
      groupId: decoded.groupId || decoded.activeGroup || null,
    };
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
