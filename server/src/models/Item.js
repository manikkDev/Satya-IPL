import mongoose from "mongoose";

// 02 §4 items: the buyer's catalogue; aliases are supplier descriptions
// learned from confirmed matches (feeds blocking candidates later).
const itemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    groupId: { type: String, required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, required: true, trim: true },
    specs: { type: mongoose.Schema.Types.Mixed, default: {} },
    hsn: { type: String, trim: true },
    uom: { type: String, default: "EA" },
    defaultGstRate: { type: String },
    aliases: { type: [String], default: [] },
    preferredSupplierIds: { type: [String], default: [] },
  },
  { timestamps: true, minimize: false }
);

itemSchema.index({ groupId: 1, code: 1 }, { unique: true });
itemSchema.index({ description: "text", aliases: "text", code: "text" });

export default mongoose.model("Item", itemSchema);
