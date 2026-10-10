import mongoose from "mongoose";

const { Schema } = mongoose;
const scoped = { companyId: { type: String, required: true, index: true }, id: { type: String, required: true } };
const make = (name, fields, options = {}) => {
  const schema = new Schema({ ...scoped, ...fields }, { timestamps: true, ...options });
  schema.index({ companyId: 1, id: 1 }, { unique: true });
  return mongoose.model(name, schema);
};

export const BusinessRecord = make("BusinessRecord", { caseId: { type: String, required: true, index: true }, kind: String, sourceChecksum: String, amount: Schema.Types.Decimal128, data: { type: Schema.Types.Mixed, required: true } });
export const BusinessCase = make("BusinessCase", { title: String, sector: String, supplier: String, poId: String, sourceChecksum: String, inputRecords: { type: [Schema.Types.Mixed], default: [] }, recordIds: [String], decisions: { type: [Schema.Types.Mixed], default: [] }, revision: { type: Number, default: 1 }, latestSnapshotId: String, demoClock: String, status: { type: String, default: "needs_review" }, reviews: { type: Schema.Types.Mixed, default: () => ({ confirmedDuplicates: {}, paymentAllocations: {} }) } });
export const BusinessSnapshot = make("BusinessSnapshot", { caseId: String, result: { type: Schema.Types.Mixed, required: true }, inputs: { type: Schema.Types.Mixed, required: true }, projection: { type: String, default: "pending" } });
export const BusinessDecision = make("BusinessDecision", { caseId: String, snapshotId: String, action: String, actorId: String, reason: String, recordId: String, findingId: String, review: Schema.Types.Mixed });
export const BusinessJob = make("BusinessJob", { caseId: String, status: { type: String, enum: ["queued", "running", "completed", "failed"], default: "queued" }, leaseUntil: Date, workerToken: String, attempts: { type: Number, default: 0 }, baseRevision: Number, input: Schema.Types.Mixed, error: String, snapshotId: String });
export const BusinessImport = make("BusinessImport", { caseId: String, checksum: String, recordCount: Number, provenance: { type: String, default: "USER_PROVIDED" }, actorId: String });
