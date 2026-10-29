import mongoose from "mongoose";

// audit chain (02 §4 + 04 P3-B9): every v2 mutation appends one row;
// hash = sha256(prevHash | canonical event) so tampering breaks the chain.
const auditSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    actor: String,
    actorRole: String,
    action: { type: String, required: true },    // METHOD path e.g. "POST /api/v2/documents/draft"
    target: mongoose.Schema.Types.Mixed,          // {collection, id} or params
    statusCode: Number,
    ip: String,
    at: { type: String, required: true },          // hashed ISO event time (createdAt is only an index convenience)
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: true, minimize: false }
);

auditSchema.index({ groupId: 1, id: 1 }, { unique: true });
auditSchema.index({ groupId: 1, createdAt: -1 });

export default mongoose.model("Audit", auditSchema);
