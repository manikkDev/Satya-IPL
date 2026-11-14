// Page-level API helpers + exact-money utilities for Documents, Payments,
// Compliance, Settings, Review history and Reports. Kept separate from
// lib/api/v2.ts so those pages can read the server's real shapes (file
// names, upload dates, audit rows, revisions) without reshaping shared code.

import { fetchJson, ApiError } from "@/lib/api/client";
import { SERVER_URL } from "@/utils/commonHelper";
import type { DocView, DocLink, EntityPolicy } from "@/lib/api/v2";

/* ================================================================
   Exact money — integer paise as bigint. Never floats.
   ================================================================ */

export const ZERO = BigInt(0);
const HUNDRED = BigInt(100);
const MONEY_RE = /^-?(\d+(\.\d{0,2})?|\.\d{1,2})$/;

/** "1,234.56" / "1234.5" / "₹ 1,234" → 123456n paise. Returns null when the
 *  text is not a plain amount (more than 2 decimals, letters, empty). */
export function parsePaise(input: string | number | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim().replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  if (!text || !MONEY_RE.test(text) || text === "-" || text === "-.") return null;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace(/^-/, "").split(".");
  const paise = BigInt(whole || "0") * HUNDRED + BigInt((frac + "00").slice(0, 2));
  return negative ? -paise : paise;
}

/** Lenient read for API values that should already be decimals; bad → 0n. */
export function paiseOf(value: string | number | { amount?: string | number } | null | undefined): bigint {
  if (value && typeof value === "object") return parsePaise(value.amount ?? null) ?? ZERO;
  if (typeof value === "number") return parsePaise(value.toFixed(2)) ?? ZERO;
  return parsePaise(value ?? null) ?? ZERO;
}

/** 123456n → "1234.56" (decimal string accepted by <Money> and the API). */
export function paiseToDecimal(paise: bigint): string {
  const negative = paise < ZERO;
  const abs = negative ? -paise : paise;
  const whole = abs / HUNDRED;
  const frac = (abs % HUNDRED).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

export const sumPaise = (values: bigint[]): bigint => values.reduce((s, v) => s + v, ZERO);
export const minPaise = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxPaise = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Integer percentage of part/whole, floored, 0..100 clamp handled by caller. */
export const pctOf = (part: bigint, whole: bigint): number =>
  whole > ZERO ? Number((part * HUNDRED) / whole) : 0;

/* ================================================================
   Dates in IST
   ================================================================ */

/** Today's date in India as YYYY-MM-DD. */
export function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Whole days from a YYYY-MM-DD business date to another (default: today IST). */
export function daysBetween(fromIso: string, toIso: string = todayIst()): number {
  const a = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const b = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

/** ISO instant → YYYY-MM-DD in IST (for CSV exports). */
export function isoDateIst(value: string | null | undefined): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/* ================================================================
   CSV export (client-side) with formula-injection guard
   ================================================================ */

/** Cells that start with = + - @ (or tab/CR) are prefixed with ' so
 *  spreadsheets never evaluate them. Pure numbers (incl. negatives) stay as-is. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  const numeric = /^-?\d+(\.\d+)?$/.test(text);
  if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const blob = new Blob(["﻿" + toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ================================================================
   Safe browser storage
   ================================================================ */

export function readLocal(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode) — the in-memory state still works
  }
}

export const AI_NOTICE_KEY = "satya.aiNoticeAck.v1";

/* ================================================================
   Permissions — /me keys permissions by entity id or "*"
   ================================================================ */

export function can(permissions: Record<string, string[]>, perm: string, entityId?: string | null): boolean {
  if (entityId && permissions[entityId]?.includes(perm)) return true;
  if (permissions["*"]?.includes(perm)) return true;
  if (!entityId) return Object.values(permissions).some((list) => list.includes(perm));
  return false;
}

/* ================================================================
   API helpers
   ================================================================ */

const qs = (params: Record<string, string | undefined>) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string>;
  const query = new URLSearchParams(clean).toString();
  return query ? `?${query}` : "";
};

const authHeaders = (): Record<string, string> => {
  const token = readLocal("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/* ---------- audit ---------- */

export type AuditRow = {
  id: string;
  groupId?: string;
  entityId?: string | null;
  actor?: string | null;
  actorRole?: string | null;
  action: string;
  target?: { id?: string; collection?: string; [k: string]: unknown } | null;
  statusCode?: number | null;
  at?: string;
  createdAt?: string;
  hash?: string;
  prevHash?: string;
};

export type AuditPage = { items: AuditRow[]; nextCursor: string | null };
export type AuditVerify = { valid: boolean; brokenAt?: string; checked?: number };

export const auditApi = {
  list: (params: { entityId?: string; action?: string; actor?: string; objectType?: string; from?: string; to?: string; cursor?: string; limit?: string }): Promise<AuditPage> =>
    fetchJson<AuditPage>(`/api/v2/audit${qs(params)}`),
  verify: (): Promise<AuditVerify> => fetchJson<AuditVerify>(`/api/v2/audit/verify`, { timeoutMs: 30_000 }),
};

/* ---------- me + entities ---------- */

export type EntityRecord = {
  id: string; code?: string; legalName: string; tradeName?: string; gstin?: string; gstins?: { gstin: string; stateCode?: string }[];
  pan?: string; cin?: string; stateCode?: string; parentEntityId?: string | null;
  addresses?: {
    billing?: { line1?: string; city?: string; state?: string; stateCode?: string; pin?: string };
    shipping?: { label?: string; line1?: string; city?: string; state?: string; stateCode?: string; pin?: string; contact?: string }[];
  };
  lut?: { arn: string; fy: string; validFrom: string; validTo: string }[];
  letterhead?: { footerText?: string } | null;
};

export type MeFull = {
  user: { id: string; name: string; email: string; platformRole?: string };
  memberships: { groupId: string; entityId: string; roles: string[] }[];
  activeGroup: { id: string; name: string; plan?: string };
  entities: { id: string; code?: string; legalName: string; tradeName?: string }[];
  permissions: Record<string, string[]>;
};

export const accountApi = {
  me: (): Promise<MeFull> => fetchJson<MeFull>(`/api/v2/me`),
  entities: (): Promise<EntityRecord[]> =>
    fetchJson<{ items?: EntityRecord[]; entities?: EntityRecord[] }>(`/api/v2/entities`).then((d) => d.items ?? d.entities ?? []),
};

/* ---------- policy ---------- */

export type PolicyRecord = EntityPolicy & {
  revision?: number;
  doa?: { docType: string; maxAmount: string; roles: string[] }[];
  numbering?: { docType: string; pattern: string; nextSeq?: number; fy?: string }[];
  updatedAt?: string;
};

export const policyApi = {
  get: (entityId: string): Promise<PolicyRecord> => fetchJson<PolicyRecord>(`/api/v2/policies/${encodeURIComponent(entityId)}`),
  put: (entityId: string, body: Partial<EntityPolicy> & { expectedRevision?: number }): Promise<PolicyRecord> =>
    fetchJson<PolicyRecord>(`/api/v2/policies/${encodeURIComponent(entityId)}`, { method: "PUT", body }),
};

/* ---------- files + ingest ---------- */

export type FileMeta = { id: string; filename?: string; mime?: string; size?: number; pages?: number; createdAt?: string };

export type IngestDraftRow = {
  id: string; fileId: string; entityId?: string;
  status: "queued" | "parsing" | "extracting" | "needs_review" | "confirmed" | "failed";
  detectedType?: string; method?: string; createdAt?: string; updatedAt?: string;
  issues?: { code?: string; severity?: string; message: string }[];
  confirmedDocumentId?: string;
};

export type DraftListRow = IngestDraftRow & { filename: string | null; uploadedAt: string | null; size?: number };

const fileMetaCache = new Map<string, Promise<FileMeta | null>>();

export function fileMeta(id: string): Promise<FileMeta | null> {
  if (!fileMetaCache.has(id)) {
    const p = fetchJson<FileMeta>(`/api/v2/files/${encodeURIComponent(id)}?meta=1`).catch(() => {
      fileMetaCache.delete(id);
      return null;
    });
    fileMetaCache.set(id, p);
  }
  return fileMetaCache.get(id)!;
}

export type UploadResult = { fileId: string; duplicateOf?: string | null; mime?: string; size?: number };
export type ExtractResult = { draftId: string | null; status: string; message?: string };

export const ingestApi = {
  /** GET /ingest/drafts joined with real file names + upload times. */
  drafts: async (entityId?: string): Promise<DraftListRow[]> => {
    const page = await fetchJson<{ items: IngestDraftRow[] }>(`/api/v2/ingest/drafts`);
    const items = entityId ? page.items.filter((d) => !d.entityId || d.entityId === entityId) : page.items;
    const metas = await Promise.all(items.map((d) => (d.fileId ? fileMeta(d.fileId) : Promise.resolve(null))));
    return items.map((d, i) => ({
      ...d,
      filename: metas[i]?.filename ?? null,
      uploadedAt: metas[i]?.createdAt ?? d.createdAt ?? null,
      size: metas[i]?.size,
    }));
  },

  /** POST /files — server returns {fileId,…}; older builds returned {id}. */
  upload: async (file: File, entityId?: string): Promise<UploadResult> => {
    const form = new FormData();
    form.append("file", file);
    if (entityId) form.append("entityId", entityId);
    const response = await fetch(`${SERVER_URL}/api/v2/files`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, data);
    const fileId = data?.fileId ?? data?.id;
    if (!fileId) throw new Error("Upload finished but the server did not return a file id");
    return { fileId, duplicateOf: data?.duplicateOf ?? null, mime: data?.mime, size: data?.size };
  },

  /** POST /ingest/files/:id/extract — a 502 still carries the failed draft id. */
  extract: async (fileId: string): Promise<ExtractResult> => {
    const response = await fetch(`${SERVER_URL}/api/v2/ingest/files/${encodeURIComponent(fileId)}/extract`, {
      method: "POST",
      headers: { Accept: "application/json", ...authHeaders() },
      signal: AbortSignal.timeout(120_000),
    });
    const data = await response.json().catch(() => null);
    if (data?.draftId) return { draftId: data.draftId, status: data.status ?? (response.ok ? "needs_review" : "failed") };
    if (!response.ok) throw new ApiError(response.status, data);
    return { draftId: null, status: "failed", message: "No draft was created" };
  },
};

/* ---------- documents ---------- */

export type DocDetail = DocView & {
  links: DocLink[]; caseId: string | null; createdAt?: string;
  payment?: { amount?: string; utr?: string; mode?: string; allocations?: { documentId: string; amount: string }[] };
  supplierId?: string;
};

export const docsApi = {
  get: (id: string): Promise<DocDetail> => fetchJson<DocDetail>(`/api/v2/documents/${encodeURIComponent(id)}`),

  /** Walk the cursor until done (bounded). `truncated` says if the cap hit. */
  all: async (params: { type: string; entityId?: string; from?: string; to?: string }, maxPages = 20): Promise<{ items: DocDetail[]; total: number; truncated: boolean }> => {
    const items: DocDetail[] = [];
    let cursor: string | null = null;
    let total = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const res: { items: DocDetail[]; nextCursor: string | null; total?: number } = await fetchJson(
        `/api/v2/documents${qs({ ...params, limit: "100", cursor: cursor ?? undefined })}`,
      );
      items.push(...res.items);
      total = res.total ?? items.length;
      cursor = res.nextCursor;
      if (!cursor) return { items, total, truncated: false };
    }
    return { items, total, truncated: true };
  },
};

const UPSTREAM_KINDS = new Set(["BILLS", "RECEIVES", "INSPECTS", "FULFILS", "ADJUSTS", "RETURNS"]);

/** PO id referenced directly by a document (line refs or an outgoing link). */
const directPoCandidates = (doc: Pick<DocDetail, "id" | "links" | "lines">): string[] => {
  const fromLines = (doc.lines ?? [])
    .map((l) => (l as { refs?: { poId?: string } }).refs?.poId)
    .filter((x): x is string => Boolean(x));
  const fromLinks = (doc.links ?? []).filter((l) => l.fromId === doc.id && UPSTREAM_KINDS.has(l.kind)).map((l) => l.toId);
  return [...new Set([...fromLines, ...fromLinks])];
};

/** Where a document should open, by type: PO → order page; payments →
 *  payments; GRN/QC/invoice/credit/debit note → the PO it references (one
 *  hop through a GRN for QC), else the read-only document view. */
export async function resolveDocumentHref(id: string): Promise<string> {
  const doc = await docsApi.get(id);
  const type = doc.type ?? "";
  if (type === "PO" || type === "PO_AMENDMENT") return `/app/orders/${doc.id}`;
  if (type.startsWith("PAYMENT") || type.startsWith("ADVANCE") || type === "BANK_LINE") return `/app/payments`;
  const queue = directPoCandidates(doc);
  const seen = new Set<string>([doc.id]);
  for (let hops = 0; queue.length && hops < 4; hops += 1) {
    const candidateId = queue.shift()!;
    if (seen.has(candidateId)) continue;
    seen.add(candidateId);
    const candidate = await docsApi.get(candidateId).catch(() => null);
    if (!candidate) continue;
    if (candidate.type === "PO" || candidate.type === "PO_AMENDMENT") return `/app/orders/${candidate.id}`;
    queue.push(...directPoCandidates(candidate));
  }
  return `/app/documents/${doc.id}`;
}

/* ---------- payments ---------- */

export type WorkbenchInvoice = { id: string; number?: string; date?: string; openAmount: string; seller?: string; dueDate?: string | null };
export type WorkbenchCredit = { id: string; amount: string; date?: string; number?: string };
export type Workbench = {
  payment: { id: string; amount?: string; utr?: string; date?: string; remaining?: string; revision?: number; counterparty?: string };
  openInvoices: WorkbenchInvoice[];
  credits: WorkbenchCredit[];
  suggestion: {
    solutions?: { allocations: { documentId: string; amount: { amount: string } }[]; residual?: { amount: string } }[];
    unique?: boolean; certainty?: string;
  } | null;
};

export const paymentsApi = {
  /** Workbench + the payment's current revision (for expectedRevision). */
  workbench: async (id: string): Promise<Workbench> => {
    const [wb, doc] = await Promise.all([
      fetchJson<Workbench>(`/api/v2/payments/${encodeURIComponent(id)}/allocate`),
      docsApi.get(id).catch(() => null),
    ]);
    return {
      ...wb,
      openInvoices: wb.openInvoices ?? [],
      credits: wb.credits ?? [],
      payment: {
        ...wb.payment,
        revision: typeof wb.payment?.revision === "number" ? wb.payment.revision : doc?.revision,
        date: wb.payment?.date ?? doc?.date,
        counterparty: doc?.seller?.name ?? doc?.buyer?.name,
      },
    };
  },
  allocate: (id: string, body: { allocations: { documentId: string; amount: string }[]; reason: string; expectedRevision?: number }) =>
    fetchJson<{ paymentId: string; allocatedTotal: string; status: string; revision?: number }>(
      `/api/v2/payments/${encodeURIComponent(id)}/allocate`,
      { method: "POST", body },
    ),
};
