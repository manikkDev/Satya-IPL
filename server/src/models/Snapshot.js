import mongoose from "mongoose";

// snapshots (02 §4): immutable engine reconstructions; id is the engine's
// content hash so identical inputs never duplicate a row.
const snapshotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    caseId: { type: String, required: true, index: true },
    knowledgeTime: String,
    engineVersion: String,
    modelVersion: String,
    result: { type: mongoose.Schema.Types.Mixed, required: true },
    inputs: mongoose.Schema.Types.Mixed,
    scenario: { type: Boolean, default: false },   // what-if previews are kept but never "latest"
  },
  { timestamps: true, minimize: false }
);

snapshotSchema.index({ groupId: 1, id: 1 }, { unique: true });
snapshotSchema.index({ caseId: 1, createdAt: -1 });

export default mongoose.model("Snapshot", snapshotSchema);
