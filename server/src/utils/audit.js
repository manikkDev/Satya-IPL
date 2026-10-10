import AuditLog from "../models/AuditLog.js";

export const recordAudit = async ({ req, action, target = null, meta = {}, actor = null }) => {
  const user = actor || req?.user || null;
  return AuditLog.create({
    actor: user?._id || user?.id || null,
    role: user?.role || "system",
    institutionId: user?.institutionId ?? null,
    action,
    target,
    meta,
    ip: req?.ip || null,
  });
};
