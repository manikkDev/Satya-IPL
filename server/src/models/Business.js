import mongoose from "mongoose";

const { Schema } = mongoose;
const scoped = { companyId: { type: String, required: true, index: true }, id: { type: String, required: true } };
const make = (name, fields, options = {}) => {
  const schema = new Schema({ ...scoped, ...fields }, { timestamps: true, minimize: false, ...options });
  schema.index({ companyId: 1, id: 1 }, { unique: true });
  return mongoose.model(name, schema);
};

export const BusinessRecord = make("BusinessRecord", { caseId: { type: String, required: true, index: true }, kind: String, sourceChecksum: String, amount: Schema.Types.Decimal128, data: { type: Schema.Types.Mixed, required: true } });
export const BusinessCase = make("BusinessCase", { title: String, sector: String, supplier: String, poId: String, sourceChecksum: String, inputRecords: { type: [Schema.Types.Mixed], default: [] }, recordIds: [String], decisions: { type: [Schema.Types.Mixed], default: [] }, revision: { type: Number, default: 1 }, latestSnapshotId: String, demoClock: String, status: { type: String, default: "needs_review" }, reviews: { type: Schema.Types.Mixed, default: () => ({ confirmedDuplicates: {}, paymentAllocations: {} }) }, assigneeId: { type: String, default: null }, assigneeName: { type: String, default: null }, exceptionStatus: { type: String, default: "open" }, resolutionNotes: { type: String, default: null }, createdBy: { type: String, default: null } });
export const BusinessSnapshot = make("BusinessSnapshot", { caseId: String, result: { type: Schema.Types.Mixed, required: true }, inputs: { type: Schema.Types.Mixed, required: true }, projection: { type: String, default: "pending" } });
export const BusinessDecision = make("BusinessDecision", { caseId: String, snapshotId: String, action: String, actorId: String, reason: String, recordId: String, findingId: String, review: Schema.Types.Mixed });
export const BusinessJob = make("BusinessJob", { caseId: String, status: { type: String, enum: ["queued", "running", "completed", "failed"], default: "queued" }, leaseUntil: Date, workerToken: String, attempts: { type: Number, default: 0 }, baseRevision: Number, input: Schema.Types.Mixed, error: String, snapshotId: String });
export const SourceDocument = make('SourceDocument', { name: String, source: String, mediaType: String, checksum: String, content: { type: String, required: true }, caseId: { type: String, default: null }, documentType: { type: String, default: "other" }, verificationStatus: { type: String, default: "pending_verification" }, verifiedBy: { type: String, default: null }, verifiedAt: { type: Date, default: null }, rejectionReason: { type: String, default: null }, version: { type: Number, default: 1 }, supersededBy: { type: String, default: null }, previousVersionId: { type: String, default: null } });
export const ImportPreview = make('ImportPreview', { actorId: String, bundle: Schema.Types.Mixed, documents: Schema.Types.Mixed, result: Schema.Types.Mixed });
export const BusinessImport = make("BusinessImport", { caseId: String, checksum: String, recordCount: Number, provenance: { type: String, default: "USER_PROVIDED" }, actorId: String });
export const BusinessAlert = make("BusinessAlert", { alertId: { type: String, required: true, index: true }, caseId: { type: String, required: true, index: true }, poId: String, supplier: String, type: { type: String, required: true }, severity: { type: String, default: "medium" }, message: { type: String, required: true }, dedupKey: { type: String, required: true }, status: { type: String, default: "unread" }, acknowledgedBy: { type: String, default: null }, acknowledgedAt: { type: Date, default: null }, dismissedBy: { type: String, default: null }, dismissedAt: { type: Date, default: null }, dismissalReason: { type: String, default: null }, resolvedAt: { type: Date, default: null }, metadata: Schema.Types.Mixed });
export const BusinessReminder = make("BusinessReminder", { reminderId: { type: String, required: true, index: true }, caseId: { type: String, required: true, index: true }, poId: String, dueAt: { type: Date, required: true }, reason: { type: String, required: true }, recipientId: { type: String, default: null }, recipientName: { type: String, default: null }, createdBy: { type: String, required: true }, status: { type: String, default: "active" } });

// ── Extended Intelligence Models ─────────────────────────────────────────────

// Contract & MOU Intelligence (Algorithm B & C)
export const ContractAgreement = make("ContractAgreement", {
  agreementNumber: { type: String, required: true, index: true },
  title: { type: String, required: true },
  category: { type: String, default: "MOU" }, // MOU, ADDENDUM, FRAMEWORK_MSA, QUALITY_SLA
  counterparty: { type: String, required: true },
  effectiveDate: { type: Date, required: true },
  expiryDate: { type: Date, required: true },
  status: { type: String, default: "active" }, // active, superseded, under_review, expired
  supersedesAgreementId: { type: String, default: null },
  supersededByAgreementId: { type: String, default: null },
  governingLaw: { type: String, default: "Indian Law (BPCI Public Procurement Framework)" },
  sourceDocumentId: { type: String, default: null },
  signatures: { type: [Schema.Types.Mixed], default: [] },
  clauses: { type: [Schema.Types.Mixed], default: [] },
  metadata: Schema.Types.Mixed
});

export const ContractObligation = make("ContractObligation", {
  obligationId: { type: String, required: true, index: true },
  agreementId: { type: String, required: true, index: true },
  caseId: { type: String, default: null },
  title: { type: String, required: true },
  type: { type: String, required: true }, // EXPIRY_RENEWAL, PERFORMANCE_MILESTONE, THREE_WAY_MATCH, BANK_GUARANTEE, AUDIT_REPORT
  dueDate: { type: Date, required: true },
  effectiveExpiry: { type: Date, default: null },
  status: { type: String, default: "pending" }, // pending, satisfied, disputed_superseded, overdue, waived
  authorityStatus: { type: String, default: "authoritative" }, // authoritative, disputed, provisional
  disputeReason: { type: String, default: null },
  sourceClauseRef: { type: String, default: null },
  assignedRole: { type: String, default: "ap_manager" },
  evidenceIds: { type: [String], default: [] }
});

// Outbox & Multi-Channel Communications (Algorithm H)
export const OutboxMessage = make("OutboxMessage", {
  messageId: { type: String, required: true, index: true },
  channel: { type: String, enum: ["whatsapp", "email", "sms", "webhook"], required: true },
  recipient: { type: String, required: true },
  subject: { type: String, default: null },
  body: { type: String, required: true },
  severity: { type: String, default: "medium" }, // low, medium, high, critical_escalation
  caseId: { type: String, default: null },
  status: { type: String, enum: ["queued", "quiet_hours_delayed", "sent", "failed", "cancelled"], default: "queued" },
  idempotencyKey: { type: String, required: true, index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  nextAttemptAt: { type: Date, default: () => new Date() },
  lastAttemptAt: { type: Date, default: null },
  deliveredAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  deliveryReceipt: Schema.Types.Mixed,
  metadata: Schema.Types.Mixed
});
