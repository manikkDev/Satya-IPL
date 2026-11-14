// Import hub API helpers (/api/v2/import/*). JSON calls go through fetchJson;
// uploads and template downloads need multipart / binary, so they use fetch
// directly with the same auth header and error shape (ApiError).

import { fetchJson, ApiError } from "@/lib/api/client";
import { SERVER_URL } from "@/utils/commonHelper";

export type ImportSource =
  | "tally_xml"
  | "bank_statement"
  | "gstr2b_json"
  | `template:${"suppliers" | "items" | "purchase_orders" | "grns" | "purchase_invoices" | "debit_credit_notes" | "payments"}`;

export type SourceInfo = { source: ImportSource; label: string; accepts: string[]; help: string; template?: string };
export type TemplateColumn = { key: string; label: string; required: boolean; example: string; help: string | null };
export type TemplateInfo = { kind: string; label: string; columns: TemplateColumn[] };

export type ImportIssue = { ref?: string; line?: number; field?: string; severity: "error" | "warning"; message: string };
export type ActionCounts = { create?: number; update?: number; unchanged?: number; duplicate?: number; error?: number };
export type ImportSummary = ActionCounts & {
  warnings?: number;
  byType?: Record<string, ActionCounts>;
  pendingRefs?: number;
  newSuppliers?: number;
  // bank statements
  debits?: number; credits?: number; withUtr?: number; counterpartyResolved?: number;
  // gstr-2b
  period?: string | null;
};
export type ImportRow = {
  ref: string; kind: string; label: string; action: "create" | "update" | "unchanged" | "duplicate" | "error";
  number?: string | null; date?: string | null; party?: string | null; amount?: string | null;
  direction?: "debit" | "credit"; utr?: string | null; mode?: string; matchedBy?: string | null;
  existingId?: string | null; id?: string | null; changes?: string[]; notes?: string[]; issues?: number;
};
export type Gstr2bStats = {
  entries: number; invoices: number; periods: string[]; matched: number; amountDiffers: number;
  onlyInBooks: number; pending2b: number; onlyIn2b: number; numberVariant: number;
  tolerance: { tax: string; value: string };
};
export type AllocationOutcome = {
  status: "queued" | "done" | "none"; autoAllocated?: number; suggested?: number; review?: number; engineUnavailable?: number;
  details?: { paymentId: string; status: string; invoice?: string; amount?: string; rule?: string; reason?: string; suggestions?: number }[];
};
export type ImportChecks = {
  at?: string; documents?: number; bound?: number; casesCreated?: number; linksCreated?: number;
  suggestions?: number; reconcileQueued?: number; mlAvailable?: boolean | null; gstr2b?: Gstr2bStats;
};
export type ImportLive = { openFindings: number; waitingForReview: number; linkSuggestions: number; checksRunning: boolean };

export type ImportRun = {
  id: string; entityId: string; source: ImportSource | "bank_csv_legacy" | "gstr2b_legacy"; format?: string;
  fileName?: string; status: "previewed" | "committing" | "committed" | "failed"; canCommit: boolean;
  detected?: Record<string, unknown> & {
    bank?: string; confidence?: number; headerRow?: number; columns?: Record<string, string>; account?: string | null;
    template?: string; mapping?: Record<string, string>; ignoredColumns?: string[]; period?: string | null;
    tally?: { vouchers: number; documents: number; suppliers: number; items: number; byType: Record<string, number>; skipped: Record<string, number> };
    previouslyCommitted?: string;
  };
  summary?: ImportSummary; issues?: ImportIssue[]; issueCount?: number; sample?: ImportRow[];
  result?: ImportSummary & { created?: number; payments?: { out: number; in: number }; allocation?: AllocationOutcome; gstr2b?: Gstr2bStats; suppliersCreated?: number; itemsCreated?: number };
  checks?: ImportChecks; caseIds?: string[]; createdCount?: number; error?: string;
  via?: "ui" | "api_key" | "legacy"; createdBy: string; createdAt: string; committedAt?: string | null;
  live?: ImportLive | null; idempotent?: boolean;
};
export type ImportRunDetail = ImportRun & {
  documents: { id: string; type: string; number: string | null; date: string; party: string | null; caseId: string | null; amount: unknown; allocated: boolean; review: string | null; reviewReason: string | null; gstr2b: string | null }[];
  findings: { id: string; caseId: string; code: string; title?: string; severity: string; message: string | null; documentIds: string[] }[];
};

export type Gstr2bRow = {
  documentId: string; kind: "invoice" | "gstr2b_entry"; number: string; date: string; supplier: string | null; gstin: string | null;
  amount: unknown; tax: string; status: string; basis: string | null; diff: { tax: string; value: string; taxable: string } | null;
  entryId: string | null; caseId: string | null;
};
export type Gstr2bStatus = { periods: string[]; period: string | null; counts: Record<string, number>; itcAtRisk: string; items: Gstr2bRow[]; note: string };

export type ApiKeyView = { id: string; name: string; prefix: string; entityId: string; scopes: string[]; createdBy: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };

const authHeader = (): Record<string, string> =>
  typeof window !== "undefined" && localStorage.getItem("token") ? { Authorization: `Bearer ${localStorage.getItem("token")}` } : {};

export const importsApi = {
  sources: () => fetchJson<{ items: SourceInfo[]; maxUploadMb: number }>("/api/v2/import/sources"),
  templates: () => fetchJson<{ items: TemplateInfo[] }>("/api/v2/import/templates"),

  /** Upload a file for validation; nothing is written until commit. */
  async preview(input: { file: File; source: ImportSource; entityId: string; options?: Record<string, unknown> }): Promise<ImportRun> {
    const fd = new FormData();
    fd.append("file", input.file, input.file.name);
    fd.append("source", input.source);
    fd.append("entityId", input.entityId);
    if (input.options) fd.append("options", JSON.stringify(input.options));
    const response = await fetch(`${SERVER_URL}/api/v2/import/preview`, { method: "POST", headers: { Accept: "application/json", ...authHeader() }, body: fd, signal: AbortSignal.timeout(120_000) });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, body);
    return body as ImportRun;
  },
  commit: (runId: string, options?: { autoAllocate?: boolean }) =>
    fetchJson<ImportRun>(`/api/v2/import/runs/${encodeURIComponent(runId)}/commit`, { method: "POST", body: { options: options ?? {} }, timeoutMs: 120_000 }),
  runs: (params: { limit?: number; before?: string; source?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return fetchJson<{ items: ImportRun[]; nextBefore: string | null }>(`/api/v2/import/runs${q.toString() ? `?${q}` : ""}`);
  },
  run: (runId: string) => fetchJson<ImportRunDetail>(`/api/v2/import/runs/${encodeURIComponent(runId)}`),

  gstr2bStatus: (params: { entityId?: string; period?: string; status?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
    return fetchJson<Gstr2bStatus>(`/api/v2/import/gstr2b/status${q.toString() ? `?${q}` : ""}`);
  },
  gstr2bRematch: (entityId: string) => fetchJson<{ stats: Gstr2bStats; changed: number }>("/api/v2/import/gstr2b/rematch", { method: "POST", body: { entityId } }),

  apiKeys: () => fetchJson<{ items: ApiKeyView[] }>("/api/v2/import/api-keys"),
  createApiKey: (name: string, entityId: string) => fetchJson<ApiKeyView & { key: string; note: string }>("/api/v2/import/api-keys", { method: "POST", body: { name, entityId } }),
  revokeApiKey: (id: string) => fetchJson<ApiKeyView>(`/api/v2/import/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Download a template (CSV or XLSX) and hand it to the browser. */
  async downloadTemplate(kind: string, format: "csv" | "xlsx"): Promise<void> {
    const response = await fetch(`${SERVER_URL}/api/v2/import/templates/${encodeURIComponent(kind)}?format=${format}`, { headers: authHeader() });
    if (!response.ok) throw new ApiError(response.status, await response.json().catch(() => null));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `satya-${kind.replace(/_/g, "-")}-template.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
