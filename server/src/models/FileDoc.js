import mongoose from "mongoose";

// files collection (02 §4): metadata only — bytes live in GridFS `uploads`.
const fileSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    entityId: { type: String, index: true },
    filename: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    gridfsId: { type: mongoose.Schema.Types.ObjectId, required: true },
    pages: Number,
    uploadedBy: String,
    retentionUntil: Date,
  },
  { timestamps: true, minimize: false }
);

fileSchema.index({ groupId: 1, id: 1 }, { unique: true });
fileSchema.index({ sha256: 1, groupId: 1 }, { unique: true });

export default mongoose.model("FileDoc", fileSchema);
