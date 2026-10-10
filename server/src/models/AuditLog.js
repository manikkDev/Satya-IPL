import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    role: { type: String, enum: ["ops_analyst", "ap_manager", "auditor", "admin", "system"], default: "system" },
    companyId: { type: String, required: true, index: true },
    eventId: { type: String },
    institutionId: { type: Number, min: 0, max: 4, default: null },
    action: { type: String, required: true, trim: true, index: true },
    target: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ companyId: 1, eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $exists: true } } });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

export default mongoose.model("AuditLog", auditLogSchema);
