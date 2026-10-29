import mongoose from "mongoose";

// findings collection (02 §4): denormalised from the latest snapshot so the
// cross-case worklist is queryable without loading snapshots.
const findingSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    caseId: { type: String, required: true, index: true },
    snapshotId: { type: String, required: true, index: true },
    code: { type: String, required: true, index: true },
    title: String,
    severity: { type: String, index: true },
    certainty: String,
    status: { type: String, enum: ["open", "resolved", "accepted_risk"], default: "open", index: true },
    data: mongoose.Schema.Types.Mixed,   // full Finding object from 02 §3
  },
  { timestamps: true, minimize: false }
);

findingSchema.index({ groupId: 1, id: 1, snapshotId: 1 }, { unique: true });
findingSchema.index({ groupId: 1, status: 1, severity: 1 });

export default mongoose.model("Finding", findingSchema);
