import crypto from "node:crypto";
import AuditLog from "../models/AuditLog.js";

export const recordAudit = async ({ req, action, target = null, meta = {}, actor = null }) => {
  const user = actor || req?.user || null;
  const companyId = user?.companyId || req?.companyId;
  const eventId = meta.decisionId || crypto.randomUUID();
  return AuditLog.findOneAndUpdate({ companyId, eventId }, { $setOnInsert: {
    actor: user?._id || user?.id || null,
    role: user?.role || "system",
    companyId,
    eventId,
    institutionId: user?.institutionId ?? null,
    action,
    target,
    meta,
    ip: req?.ip || null,
  } }, { upsert: true, returnDocument: "after" });
};
