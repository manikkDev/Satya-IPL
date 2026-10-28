import { SERVER_URL, SERVER_URL_1 } from "@/utils/commonHelper";

export type Ledger = { currency: string; ordered: string; received: string; accepted: string; openDelivery: string; recordedGross: string | null; recordedOutstanding: string | null; settled: string; supportedOutstanding: string | null; canonicalOutstanding: string | null; disputedExposure: string; eligibleNet: string };
export type Evidence = { id: string; recordId: string; reference: string; source: string; field: string; rawValue: string | null; derivedValue?: string; normalizedValue?: string; provenance: string; quality: string; observedAt: string; locator: { kind: string; pointer: string | null; documentId?: string; row?: number; column?: string } };
export type Finding = { id: string; type: string; title: string; detail: string; severity: string; action: string; certainty: string; evidenceIds: string[]; exposure: { amount: string; currency: string } | null };
export type BusinessLine = { id: string; description: string; quantity: string; unitPrice: string; uom: string; sku?: string; acceptedQuantity?: string };
export type SourceRecord = { id: string; type: string; reference: string; source: string; supplier: string; currency: string; amount?: string; occurredAt: string; observedAt: string; provenance: string; lines?: BusinessLine[]; taxes?: Record<string, string>; invoiceId?: string; poId?: string; status: string; dueAt?: string };
export type Graph = { nodes: { id: string; label: string; type: string; amount?: string; currency?: string }[]; edges: { id: string; source: string; target: string; type: string; status: string; amount?: string }[]; source?: string; degraded?: boolean };
export type MatchSuggestion = { recordId: string; lineId: string; probability: number | null; score: number; kind: string; status: string; features: Record<string, number> };
export type Snapshot = { caseId: string; snapshotId: string; observedBefore: string; ledger: Ledger; findings: Finding[]; evidence: Evidence[]; graph: Graph; unallocatedPayments: { paymentId: string; amount: string; currency: string; reference: string; candidateInvoiceIds: string[] }[]; duplicateCandidates: { recordId: string; candidateOriginalId: string }[]; ambiguities: { id: string; neededEvidence: string; balanceScenarios?: { minimum: string; maximum: string; currency: string; assumption: string } }[]; paymentAllocations: { paymentId: string; invoiceId: string; amount: string; currency: string; status: string }[]; matchSuggestions: MatchSuggestion[]; warnings: string[]; simulation?: boolean };
export type AssignableUser = { id: string; name: string; email: string; role: string };
export type FinancialAnomaly = { id: string; type: string; severity: string; title: string; detail: string; evidenceIds: string[]; observedValue: string; baselineValue: string; confidence: string; action: string; status: string };
export type EvidenceCompleteness = { checklist: { item: string; present: boolean; verified: boolean; status: string }[]; missingItems: string[]; completenessRatio: number; verifiedDocumentCount: number; totalDocumentCount: number; isCompleteForApproval: boolean };
export type CaseDocument = { id: string; name: string; source: string; mediaType: string; checksum: string; documentType: string; verificationStatus: string; verifiedBy: string | null; verifiedAt: string | null; rejectionReason: string | null; version: number };
export type CaseReminder = { reminderId: string; caseId: string; poId: string; dueAt: string; reason: string; recipientName: string | null; status: string };

export type BusinessCase = {
  id: string; title: string; supplier: string; sector: string; poId: string; revision: number; status: string;
  ledger?: Ledger; findingCount: number; records: SourceRecord[]; snapshot: Snapshot | null; projection: string;
  decisions: { id: string; action: string; reason: string; actorName: string; createdAt: string; effect: string; previousStatus?: string; newStatus?: string; previousExceptionStatus?: string; newExceptionStatus?: string; assigneeId?: string; assigneeName?: string }[];
  assigneeId?: string; assigneeName?: string; exceptionStatus?: string; resolutionNotes?: string; createdBy?: string;
  anomalies?: FinancialAnomaly[]; evidenceCompleteness?: EvidenceCompleteness;
};
export type ChatAnswer = { answerType?: string; responseMode?: string; providerStatus?: string; queriedAt?: string; focusRecordIds?: string[]; provider?: string; content: string; conversationId: string; sources: { id: string; recordId: string; label: string; caseId: string }[]; caseId?: string; snapshotId?: string; graph?: Graph; facts?: Ledger; mode: string };

const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""}` });
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${SERVER_URL}/api/v1${path}`, { headers: headers(), ...(body !== undefined ? { method: "POST", body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Business request failed");
  return data;
}
// ── Dashboard / Risk / Alert / Audit types ────────────────────────────
export type DashboardSummary = {
  currency: string;
  mixedCurrencyWarning: string | null;
  totals: { recordedOutstanding: string; supportedOutstanding: string; canonicalOutstanding: string; disputedExposure: string; settled: string };
  statusCounts: { needs_review: number; reconciled: number; escalated: number; on_hold: number; awaiting_evidence: number; importing: number; total: number };
  findings: { blocking: number; informational: number };
  duplicateCandidates: number;
  unallocatedPayments: number;
  supplierBalances: { supplier: string; recorded: string; supported: string; disputed: string; settled: string; caseCount: number; currency: string }[];
  attentionItems: { caseId: string; poId: string; supplier: string; status: string; reasons: string[]; recordedOutstanding: string; currency: string }[];
};
export type AttentionItem = {
  caseId: string; poId: string; supplier: string; status: string; priority: number; rules: string[];
  ledger: { currency: string; recordedOutstanding: string; supportedOutstanding: string; disputedExposure: string } | null;
  blockingFindings: number; duplicateCandidates: number; unallocatedPayments: number; decisionCount: number; importedBy: string | null; createdAt: string;
};
export type Alert = { alertId?: string; type: string; severity: string; caseId: string; poId: string; supplier: string; message: string; status?: string; createdAt: string };
export type DetailedAuditEntry = { _id: string; action: string; target: string; createdAt: string; role: string; caseContext: { poId: string; supplier: string; currentStatus: string; decisionCount: number } | null };

export const businessApi = {
  cases: () => request<BusinessCase[]>("/cases"),
  case: (id: string) => request<BusinessCase>(`/cases/${encodeURIComponent(id)}`),
  snapshot: (id: string) => request<Snapshot>(`/snapshots/${encodeURIComponent(id)}`),
  graph: (id: string) => request<Graph>(`/graph/cases/${encodeURIComponent(id)}`),
  records: () => request<(SourceRecord & { caseId: string })[]>("/records"),
  evaluation: () => request<Record<string, unknown>>("/evaluation"),
  audit: () => request<{ _id: string; action: string; target: string; createdAt: string; role: string }[]>("/audit"),
  reconcile: (id: string) => request<{ id: string; status: string }>(`/cases/${encodeURIComponent(id)}/reconcile`, {}),
  job: (id: string) => request<{ status: string; error?: string; snapshotId?: string }>(`/jobs/${encodeURIComponent(id)}`),
  decision: (id: string, body: unknown) => request<{ job: { id: string }; decision: unknown }>(`/cases/${encodeURIComponent(id)}/decisions`, body),
  replay: (id: string, cutoff: string) => request<Snapshot>(`/cases/${encodeURIComponent(id)}/replay`, { observedBefore: cutoff }),
  scenario: (id: string, record: unknown) => request<Snapshot>(`/cases/${encodeURIComponent(id)}/scenario`, { record }),
  previewImport: (body: unknown) => request<{ id: string; canCommit: boolean; acceptedRecords: number; totalRows: number; issueCount: number; issues: { file: string; row: number; message: string }[]; records: SourceRecord[] }>("/imports/preview", body),
  document: (id: string) => request<{ id: string; name: string; content: string; checksum: string }>(`/documents/${encodeURIComponent(id)}`),
  import: (body: unknown) => request<{ caseId: string; job?: { id: string } }>("/imports", body),
  // ── New endpoints (Features 1, 6, 8, 10, 11, 12) ────────────────────
  dashboardSummary: () => request<DashboardSummary>("/dashboard/summary"),
  dashboardAttention: () => request<{ items: AttentionItem[]; scoringRules: string }>("/dashboard/attention"),
  alerts: () => request<{ alerts: Alert[]; count?: number; notice?: string }>("/alerts"),
  acknowledgeAlert: (alertId: string) => request<{ alert: Alert }>(`/alerts/${encodeURIComponent(alertId)}/acknowledge`, {}),
  dismissAlert: (alertId: string, reason?: string) => request<{ alert: Alert }>(`/alerts/${encodeURIComponent(alertId)}/dismiss`, { reason }),
  assignableUsers: () => request<AssignableUser[]>("/users/assignable"),
  assign: (id: string, body: { assigneeId: string; reason: string; assigneeName?: string }) => request<{ assignment: unknown }>(`/cases/${encodeURIComponent(id)}/assign`, body),
  updateExceptionStatus: (id: string, body: { status: string; notes?: string; reason?: string }) => request<{ status: string; case: BusinessCase }>(`/cases/${encodeURIComponent(id)}/exception-status`, body),
  caseDocuments: (id: string) => request<CaseDocument[]>(`/cases/${encodeURIComponent(id)}/documents`),
  verifyDocument: (docId: string, body: { status: "verified" | "rejected"; reason?: string; documentType?: string }) => request<{ document: CaseDocument }>(`/documents/${encodeURIComponent(docId)}/verify`, body),
  caseReminders: (id: string) => request<CaseReminder[]>(`/cases/${encodeURIComponent(id)}/reminders`),
  createReminder: (id: string, body: { dueAt: string; reason: string; recipientId?: string }) => request<CaseReminder>(`/cases/${encodeURIComponent(id)}/reminders`, body),
  auditDetailed: () => request<DetailedAuditEntry[]>("/audit/detailed"),
  downloadReportUrl: (id: string, format: "json" | "csv" = "json") => `${SERVER_URL}/api/v1/cases/${encodeURIComponent(id)}/report?format=${format}`,
  chat: async (prompt: string, caseId?: string, conversationId?: string, onStatus?: (stage: string) => void): Promise<ChatAnswer> => {
    const response = await fetch(`${SERVER_URL_1}/api/chat/stream`, { method: "POST", headers: headers(), body: JSON.stringify({ prompt, caseId, conversationId }) });
    if (!response.ok) { const body = await response.json(); throw new Error(body.message || "Copilot unavailable"); }
    if (!response.body) throw new Error("Chat stream unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const line = block.split("\n").find((part) => part.startsWith("data: "));
        if (!line) continue;
        const data = JSON.parse(line.slice(6));
        if (block.startsWith('event: status')) onStatus?.(data.stage);
        if (block.startsWith('event: error')) throw new Error(data.message || 'This question could not be completed');
        if (block.startsWith('event: answer')) return data;
      }
    }
    throw new Error("Stream ended before an evidence answer arrived");
  },
};
export async function waitForJob(id: string) {
  for (let attempt = 0; attempt < 65; attempt++) {
    const job = await businessApi.job(id);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || "Reconciliation failed");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Reconciliation is still running; refresh the case shortly");
}
export function money(value: string | null | undefined, currency = "INR") {
  if (value === null || value === undefined) return "Needs evidence";
  const [integer, fraction = "00"] = value.split(".");
  const negative = integer.startsWith("-");
  const absolute = integer.replace(/^-/, "");
  const tail = absolute.slice(-3);
  const head = absolute.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = head ? `${head},${tail}` : tail;
  return `${negative ? "−" : ""}${currency === "INR" ? "₹" : `${currency} `}${grouped}.${fraction.padEnd(2, "0")}`;
}
