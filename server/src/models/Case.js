import mongoose from "mongoose";

// cases (investigations) per 02 §4 — created automatically when a PO is
// issued or first referenced; reconciliation/snapshots arrive in P2-B6.
const caseSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    kind: { type: String, enum: ["po", "supplier_period", "payment", "custom"], required: true },
    subjectIds: { type: [String], default: [] },
    title: { type: String, required: true },
    status: { type: String, enum: ["open", "in_review", "resolved", "escalated", "on_hold"], default: "open" },
    latestSnapshotId: String,
    revision: { type: Number, default: 0 },
    assignee: String,
    priority: { type: String, enum: ["low", "normal", "high"], default: "normal" },
  },
  { timestamps: true, minimize: false }
);

caseSchema.index({ groupId: 1, id: 1 }, { unique: true });
caseSchema.index({ groupId: 1, status: 1 });
caseSchema.index({ subjectIds: 1 });

export default mongoose.model("Case", caseSchema);
