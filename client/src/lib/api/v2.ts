// Typed v2 API surface. Every call checks NEXT_PUBLIC_USE_MOCKS first so UI
// work never waits on the backend (docs/plan/06 §8, 00 §7.7).

import { fetchJson } from "@/lib/api/client";
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
      : fetchJson(`/api/v2/documents${qs({ type: "PO", ...params })}`),

  order: (id: string): Promise<OrderDetail> =>
    mocksEnabled() ? mock(mockOrderDetail) : fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`),

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

  drafts: (): Promise<{ items: Draft[] }> =>
    mocksEnabled() ? mock({ items: mockDrafts }) : fetchJson(`/api/v2/ingest/drafts`),

  draft: (id: string): Promise<DraftDetail> =>
    mocksEnabled() ? mock(mockDraftDetail) : fetchJson(`/api/v2/ingest/drafts/${encodeURIComponent(id)}`),

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
