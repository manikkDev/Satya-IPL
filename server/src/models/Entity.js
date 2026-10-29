import mongoose from "mongoose";

// One GST-registered legal entity inside a group (02 §4): own GSTIN, PAN,
// numbering series, letterhead and AATO band. parentEntityId builds the
// parent → child company structure (intra-group flows, 01 §3.1).
const lutSchema = new mongoose.Schema(
  { arn: String, fy: String, validFrom: String, validTo: String },
  { _id: false }
);

const entitySchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    groupId: { type: String, required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 8 }, // used in doc numbering, e.g. VPPL
    legalName: { type: String, required: true, trim: true },
    tradeName: { type: String, trim: true },
    gstin: { type: String, trim: true, uppercase: true },
    pan: { type: String, trim: true, uppercase: true },
    cin: { type: String, trim: true },
    stateCode: { type: String, trim: true }, // GST state code "27"
    addresses: {
      billing: { type: mongoose.Schema.Types.Mixed },
      shipping: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    aatoBand: { type: String, enum: ["<5cr", "5-10cr", ">=10cr"] },
    einvoiceApplicable: { type: Boolean },
    lut: { type: [lutSchema], default: [] },
    bankAccounts: { type: [mongoose.Schema.Types.Mixed], default: [] },
    letterhead: {
      logoFileId: String,
      stampFileId: String,
      signatureFileId: String,
      footerText: String,
      colors: { type: mongoose.Schema.Types.Mixed },
    },
    parentEntityId: { type: String }, // null => group parent
  },
  { timestamps: true, minimize: false }
);

entitySchema.index({ groupId: 1, code: 1 }, { unique: true });
entitySchema.index({ gstin: 1 }, { sparse: true });

export default mongoose.model("Entity", entitySchema);
