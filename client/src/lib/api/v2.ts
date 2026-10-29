// Typed v2 API surface. Every call checks NEXT_PUBLIC_USE_MOCKS first so UI
// work never waits on the backend (docs/plan/06 §8, 00 §7.7).

import { fetchJson } from "@/lib/api/client";
import { SERVER_URL } from "@/utils/commonHelper";
import { mocksEnabled } from "@/lib/flags";
import type { Today, GraphPayload, Page, Finding } from "@/lib/api/types";
import { mockToday, flagshipGraph, mockEntities } from "@/lib/mocks/flagship";
import {
  mockOrders, mockOrderDetail, mockInvestigations, mockCaseDetail,
  mockDrafts, mockDraftDetail, mockPayments, mockPaymentWorkbench,
  mockSuppliers, mockCompliance, mockCopilotAnswer,
  type OrderDetail, type OrderListRow, type Draft, type DraftDetail,
} from "@/lib/mocks/data";

/** Uniform supplier row for the UI — covers both mock and real API shapes. */
export type SupplierRow = {
  id: string; name: string; legalName?: string; gstin: string;
  msme?: string; udyam?: { number: string; category: string; verifiedAt?: string };
  paymentTermsDays?: number;
  openValue?: { amount: string; currency: string };
  overdue?: { amount: string; currency: string };
  issueCount: number;
};
type SuppliersPage = Page<SupplierRow>;
type PaymentsPage = typeof mockPayments;
type Compliance = typeof mockCompliance;
type InvestigationsPage = typeof mockInvestigations;

/** Shape returned by GET /api/v2/suppliers (B). */
type SupplierApi = {
  id: string; legalName: string; tradeNames?: string[];
  gstins?: { gstin: string; stateCode?: string; status?: string }[];
  pan?: string; udyam?: { number: string; category: "micro" | "small" | "medium"; verifiedAt?: string };
  msme?: boolean; paymentTermsDays?: number;
};

/** Shape returned by GET /api/v2/me (B). */
export type MeResponse = {
  user: { id: string; name: string; email: string; platformRole?: string };
  memberships: { groupId: string; entityId: string; roles: string[] }[];
  activeGroup: { id: string; name: string; plan?: string };
  entities: typeof mockEntities;
  permissions: Record<string, string[]>;
};

/** Shape returned by GET /api/v2/hsn/search (B). */
export type HsnResult = {
  code: string; description: string; chapter?: string;
  rate: string | null; cessRate?: string | null;
  effectiveFrom: string | null; notificationRef: string | null;
  conditional?: boolean;
};

/** B's document `view` — the raw BusinessDocument fields. */
export type DocView = {
  id: string; type: string; status: string; number?: string | null;
  externalRef?: string | null; date: string; entityId: string; supplierId?: string;
  seller?: { name?: string; gstin?: string }; buyer?: { name?: string; gstin?: string };
  lines?: { lineNo: number; description: string; hsn?: string; qty?: string; uom?: string; rate?: string; taxableValue?: string; gstRate?: string; lineTotal?: string; cgst?: string; sgst?: string; igst?: string }[];
  totals?: { taxable?: string; cgst?: string; sgst?: string; igst?: string; grand?: string };
  terms?: Record<string, unknown>; contentHash?: string | null;
};

export type DocLink = { fromId: string; toId: string; kind: string; certainty: string; basis?: string };

export type LifecycleLine = {
  lineNo: number; ordered: string; received: string; accepted: string;
  rejected?: string; returned?: string; invoicedQty?: string; invoicedValue?: string; paidValue?: string;
};

export type RenderModel = {
  document: DocView;
  entity: { legalName?: string; tradeName?: string; code?: string; gstin?: string; pan?: string; cin?: string; stateCode?: string; addresses?: unknown; letterhead?: unknown } | null;
  supplier: { id: string; legalName: string; gstins?: { gstin: string; stateCode?: string }[]; contacts?: unknown[] } | null;
  taxSummary: unknown[]; amountInWords: string | null; terms: Record<string, unknown> | null;
  verify: { url: string; hash: string } | null;
};

export type FileDoc = { id: string; filename?: string; mime?: string; sha256?: string; entityId?: string; status?: string };

export type IngestDraft = {
  id: string; fileId: string; status: "queued" | "parsing" | "extracting" | "needs_review" | "confirmed" | "failed";
  detectedType?: string; fields?: Record<string, { value?: string; confidence?: "high" | "check" | "low"; source?: string; quote?: string } | string>;
  lines?: { lineNo: number; description: string; qty?: string; uom?: string; rate?: string; amount?: string }[];
  issues?: { code?: string; message: string }[]; suggestions?: { supplierId?: string; supplierName?: string; poId?: string; poNumber?: string };
  confirmedDocumentId?: string; edits?: { actor: string; at: string; changed: string[] }[];
};

const mock = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));
const qs = (params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return query ? `?${query}` : "";
};

export const v2 = {
  today: (entityId?: string): Promise<Today> =>
    mocksEnabled()
      ? mock(mockToday)
      : fetchJson<Today>(`/api/v2/dashboard/today${entityId ? `?entityId=${encodeURIComponent(entityId)}` : ""}`),

  orders: (params: Record<string, string> = {}): Promise<Page<OrderListRow>> =>
    mocksEnabled()
      ? mock({ items: mockOrders, nextCursor: null, total: mockOrders.length })
      : fetchJson<Page<DocView>>(`/api/v2/documents${qs({ type: "PO", ...params })}`).then((page) => ({
          items: page.items.map((doc) => ({
            id: doc.id,
            number: doc.number ?? doc.externalRef ?? doc.id,
            supplier: doc.seller?.name ?? "—",
            entity: doc.entityId,
            date: doc.date,
            status: doc.status,
            value: { amount: doc.totals?.grand ?? "0.00", currency: "INR" },
            deliveredPct: "0", invoicedPct: "0", paidPct: "0",
            issueCount: 0,
          })),
          nextCursor: page.nextCursor,
          total: page.total ?? page.items.length,
        })),

  order: (id: string): Promise<OrderDetail> =>
    mocksEnabled()
      ? mock(mockOrderDetail)
      : fetchJson<DocView & { links: DocLink[]; lifecycle: LifecycleLine[] | null; caseId: string | null }>(
          `/api/v2/documents/${encodeURIComponent(id)}`,
        ).then((doc) => ({
          order: doc as unknown as OrderDetail["order"],
          lifecycle: (doc.lifecycle ?? doc.lines?.map((l) => ({
            lineNo: l.lineNo, ordered: l.qty ?? "0", received: "0", accepted: "0", rejected: "0",
            invoicedQty: "0", paidValue: "0",
          })) ?? []).map((line, i) => ({
            lineNo: line.lineNo,
            description: doc.lines?.[i]?.description ?? "",
            ordered: line.ordered, received: line.received, accepted: line.accepted,
            rejected: line.rejected ?? "0", invoiced: line.invoicedQty ?? "0",
            paid: (line as { paidValue?: string }).paidValue ?? "0", open: "0",
          })),
          schedule: [] as OrderDetail["schedule"],
          documents: [] as OrderDetail["documents"],
          graph: {
            nodes: [
              {
                id: doc.id, type: doc.type, label: doc.number ?? doc.externalRef ?? doc.id,
                stage: "order" as const, status: doc.status, date: doc.date,
                amount: doc.totals?.grand ? { amount: doc.totals.grand, currency: "INR" } : undefined,
              },
              ...[...new Set(doc.links.flatMap((l) => [l.fromId, l.toId]))]
                .filter((id2) => id2 !== doc.id)
                .map((id2) => ({
                  id: id2, type: "OTHER" as const, label: id2,
                  stage: "document" as const, status: "unknown",
                })),
            ],
            edges: doc.links.map((link, i) => ({
              id: `e${i}`, source: link.fromId, target: link.toId, kind: link.kind,
              certainty: (link.certainty || "CONFIRMED") as "CONFIRMED", label: link.kind.replaceAll("_", " "),
              explanation: link.basis || link.kind, evidenceIds: [link.fromId, link.toId],
            })),
            timeline: [{ at: doc.date, nodeIds: [doc.id], edgeIds: [] }],
            source: "live" as const,
          },
          history: [] as OrderDetail["history"],
          caseId: doc.caseId ?? "",
        })),

  cases: (params: Record<string, string> = {}): Promise<InvestigationsPage> =>
    mocksEnabled()
      ? mock(mockInvestigations)
      : fetchJson(`/api/v2/cases${qs(params)}`),

  case: (id: string): Promise<typeof mockCaseDetail> =>
    mocksEnabled()
      ? mock(mockCaseDetail)
      : fetchJson(`/api/v2/cases/${encodeURIComponent(id)}`),

  findings: (params: Record<string, string> = {}): Promise<Page<Finding>> =>
    mocksEnabled()
      ? mock({ items: mockToday.topFindings, nextCursor: null, total: mockToday.topFindings.length })
      : fetchJson<Page<Finding>>(`/api/v2/findings${qs(params)}`),

  graph: (caseId: string, asOf?: string): Promise<GraphPayload> =>
    mocksEnabled()
      ? mock(flagshipGraph)
      : fetchJson<GraphPayload>(`/api/v2/graph/case/${encodeURIComponent(caseId)}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`),

  drafts: (params: Record<string, string> = {}): Promise<{ items: Draft[] }> =>
    mocksEnabled()
      ? mock({ items: mockDrafts })
      : fetchJson<{ items: IngestDraft[]; nextCursor: string | null }>(`/api/v2/ingest/drafts${qs(params)}`).then(
          (page) => ({
            items: page.items.map((draft) => ({
              id: draft.id,
              filename: draft.detectedType ? `${draft.detectedType.replaceAll("_", " ").toLowerCase()} · ${draft.id.slice(-6)}` : draft.id,
              detectedType: draft.detectedType,
              status: draft.status,
              uploadedAt: "",
              method: "vision_llm" as const,
              issue: draft.issues?.[0]?.message,
            })),
          }),
        ),

  draft: (id: string): Promise<DraftDetail> =>
    mocksEnabled()
      ? mock(mockDraftDetail)
      : fetchJson<IngestDraft>(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`).then((draft) => ({
          draft: {
            id: draft.id,
            filename: `file ${draft.fileId?.slice(-8) ?? draft.id}`,
            detectedType: draft.detectedType,
            status: draft.status,
            uploadedAt: "",
            method: "vision_llm" as const,
            issue: draft.issues?.[0]?.message,
          },
          fields: [{
            group: "Extracted fields",
            items: Object.entries(draft.fields ?? {}).map(([name, field]) => {
              const f = typeof field === "object" && field !== null ? field : { value: String(field) };
              return {
                name,
                label: name.replaceAll("_", " "),
                value: String(f.value ?? ""),
                confidence: (f.confidence === "high" || f.confidence === "check" || f.confidence === "low" ? f.confidence : "check") as "high" | "check" | "low",
                source: f.source ?? "extraction",
                quote: f.quote ?? "",
              };
            }),
          }],
          lines: (draft.lines ?? []).map((line) => ({
            lineNo: line.lineNo, description: line.description,
            qty: line.qty ?? "", rate: line.rate ?? "", amount: line.amount ?? "",
          })),
          issues: (draft.issues ?? []).map((issue) => ({ severity: "medium", message: issue.message })),
          suggestions: {
            supplier: draft.suggestions?.supplierName,
            po: draft.suggestions?.poNumber,
          },
        })),

  payments: (params: Record<string, string> = {}): Promise<PaymentsPage> =>
    mocksEnabled() ? mock(mockPayments) : fetchJson(`/api/v2/documents${qs({ type: "PAYMENT_OUT", ...params })}`),

  paymentWorkbench: (id: string): Promise<typeof mockPaymentWorkbench> =>
    mocksEnabled()
      ? mock(mockPaymentWorkbench)
      : fetchJson(`/api/v2/allocate/payment/${encodeURIComponent(id)}`),

  suppliers: (params: Record<string, string> = {}): Promise<SuppliersPage> =>
    mocksEnabled()
      ? mock(mockSuppliers)
      : fetchJson<{ items: SupplierApi[]; nextCursor: string | null }>(`/api/v2/suppliers${qs(params)}`).then(
          (page) => ({
            items: page.items.map((s) => ({
              id: s.id,
              name: s.legalName,
              legalName: s.legalName,
              gstin: s.gstins?.[0]?.gstin ?? "",
              msme: s.udyam?.category,
              udyam: s.udyam,
              paymentTermsDays: s.paymentTermsDays,
              openValue: undefined,
              overdue: undefined,
              issueCount: 0,
            })),
            nextCursor: page.nextCursor,
            total: page.items.length,
          }),
        ),

  me: (): Promise<MeResponse> => fetchJson(`/api/v2/me`),

  // B's document lifecycle (02 §3.4). `view` returns the raw BusinessDocument;
  // the UI normalises it to the shapes the mock pages were built against.
  documents: (params: Record<string, string> = {}): Promise<Page<DocView>> =>
    fetchJson(`/api/v2/documents${qs(params)}`),

  document: (id: string): Promise<DocView & { links: DocLink[]; lifecycle: LifecycleLine[] | null; caseId: string | null }> =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`),

  renderModel: (id: string): Promise<RenderModel> =>
    mocksEnabled()
      ? mock({
          document: {
            id, type: "PO", status: "issued", number: "VPPL/PO/26-27/000123", date: "2026-10-28",
            entityId: mockEntities[0].id, supplierId: "sup_mehta",
            seller: { name: "Mehta Engineering Works", gstin: "27AAAPM1120F1Z5" },
            buyer: { name: mockEntities[0].legalName, gstin: mockEntities[0].gstin },
            lines: mockOrderDetail.lifecycle.map((l, i) => ({
              lineNo: l.lineNo, description: l.description, hsn: i === 0 ? "8413" : undefined, qty: l.ordered, uom: "NOS",
              rate: "1180.00", taxableValue: "100000.00", gstRate: "18", cgst: "9000.00", sgst: "9000.00", igst: "0.00", lineTotal: "118000.00",
            })),
            totals: { taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00", grand: "118000.00" },
            terms: { deliveryTerms: "FOR destination", creditDays: "30", warranty: "12", inspection: "On receipt" },
            contentHash: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
          } as DocView,
          entity: {
            legalName: mockEntities[0].legalName, tradeName: mockEntities[0].tradeName, code: mockEntities[0].code,
            gstin: mockEntities[0].gstin, stateCode: mockEntities[0].stateCode,
            addresses: [{ kind: "billing", line1: "Plot 42, MIDC Phase II", city: "Pune", state: "Maharashtra", pin: "411019" }],
          },
          supplier: { id: "sup_mehta", legalName: "Mehta Engineering Works", gstins: [{ gstin: "27AAAPM1120F1Z5", stateCode: "27" }] },
          taxSummary: [{ gstRate: "18", taxable: "100000.00", cgst: "9000.00", sgst: "9000.00", igst: "0.00" }],
          amountInWords: "Rupees One Lakh Eighteen Thousand Only",
          terms: { deliveryTerms: "FOR destination", creditDays: "30", warranty: "12", inspection: "On receipt" },
          verify: { url: "https://satya.app/verify/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", hash: "a1b2c3d4" },
        })
      : fetchJson(`/api/v2/documents/${encodeURIComponent(id)}/render-model`),

  documentAction: (id: string, action: "compute" | "submit" | "approve" | "reject" | "issue" | "amend" | "short-close" | "cancel", body?: unknown) =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  createDraft: (body: unknown): Promise<DocView> =>
    fetchJson(`/api/v2/documents/draft`, { method: "POST", body: JSON.stringify(body) }),

  patchDocument: (id: string, body: unknown): Promise<DocView> =>
    fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  // files + ingestion (B5)
  uploadFile: async (file: File, entityId?: string): Promise<FileDoc> => {
    const form = new FormData();
    form.append("file", file);
    if (entityId) form.append("entityId", entityId);
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const response = await fetch(`${SERVER_URL}/api/v2/files`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || `Upload failed (${response.status})`);
    }
    return response.json();
  },

  extractFile: (fileId: string): Promise<{ draftId: string; status: string; draft: IngestDraft }> =>
    fetchJson(`/api/v2/ingest/files/${encodeURIComponent(fileId)}/extract`, { method: "POST" }),

  ingestDrafts: (params: Record<string, string> = {}): Promise<{ items: IngestDraft[]; nextCursor: string | null }> =>
    fetchJson(`/api/v2/ingest/drafts${qs(params)}`),

  ingestDraft: (id: string): Promise<IngestDraft> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`),

  patchIngestDraft: (id: string, body: unknown): Promise<IngestDraft> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),

  confirmIngestDraft: (id: string): Promise<{ documentId: string; status: string }> =>
    fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}/confirm`, { method: "POST" }),

  // public verify (02 §5.3)
  verify: (hash: string): Promise<{ valid: boolean; type?: string; number?: string; entityName?: string; date?: string; grandTotal?: string; status?: string }> =>
    fetchJson(`/api/v2/verify/${encodeURIComponent(hash)}`),

  hsnSearch: (q: string, date?: string): Promise<{ items: HsnResult[] }> =>
    fetchJson(`/api/v2/hsn/search${qs({ q, ...(date ? { date } : {}) })}`),

  compliance: (): Promise<Compliance> =>
    mocksEnabled()
      ? mock(mockCompliance)
      : Promise.all([fetchJson(`/api/v2/compliance/msme`), fetchJson(`/api/v2/compliance/gstr2b`)]).then(
          ([msme, gstr2b]) => ({ msme, gstr2b }) as Compliance,
        ),

  entities: (): Promise<{ entities: typeof mockEntities }> =>
    mocksEnabled() ? mock({ entities: mockEntities }) : fetchJson(`/api/v2/entities`),
};

export { mockCopilotAnswer };
