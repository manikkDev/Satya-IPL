import { signToken, verifyToken } from "../utils/jwt.js";

// v2 sessions use ONE hybrid JWT carrying both the legacy v1 claims (id,
// companyId, role, domain) and the v2 claims (sub, gid, mem, tv) with
// audience ["satya-business-v1","satya-v2"]. Existing v1 routes keep working
// unchanged; v2 routes verify the v2 audience + group claims (04 P1-B2).
export const V2_AUDIENCE = "satya-v2";

export const signSession = (user, { groupId, memberships = [] }) =>
  signToken(
    {
      sub: user.v2id || String(user._id),
      id: String(user._id),
      companyId: user.companyId,
      role: user.role,
      domain: "satya-business-v1",
      gid: groupId,
      mem: memberships.map((m) => ({ e: m.entityId, r: m.roles })),
      ...(user.platformRole ? { prole: user.platformRole } : {}),
      tv: user.tokenVersion ?? 0,
    },
    { expiresIn: "12h", audience: ["satya-business-v1", V2_AUDIENCE] }
  );

export const verifySession = (token) => verifyToken(token, V2_AUDIENCE);
