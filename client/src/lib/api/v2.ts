// Typed v2 API surface. Every call checks NEXT_PUBLIC_USE_MOCKS first so UI
// work never waits on the backend (docs/plan/06 §8, 00 §7.7).

import { fetchJson } from "@/lib/api/client";
import { mocksEnabled } from "@/lib/flags";
import type { Today, Case, Snapshot, GraphPayload, Page, Finding } from "@/lib/api/types";
import { mockToday, mockCase, mockSnapshot, flagshipGraph, mockEntities } from "@/lib/mocks/flagship";
import {
  mockOrders, mockOrderDetail, mockInvestigations, mockCaseDetail,
  mockDrafts, mockDraftDetail, mockPayments, mockPaymentWorkbench,
  mockSuppliers, mockCompliance, mockCopilotAnswer,
  type OrderDetail, type Draft, type DraftDetail,
} from "@/lib/mocks/data";

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

  orders: (params: Record<string, string> = {}) =>
    mocksEnabled()
      ? mock({ items: mockOrders, nextCursor: null, total: mockOrders.length })
      : fetchJson(`/api/v2/documents${qs({ type: "PO", ...params })}`),

  order: (id: string): Promise<OrderDetail> =>
    mocksEnabled() ? mock(mockOrderDetail) : fetchJson(`/api/v2/documents/${encodeURIComponent(id)}`),

  cases: (params: Record<string, string> = {}) =>
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

  payments: (params: Record<string, string> = {}) =>
    mocksEnabled() ? mock(mockPayments) : fetchJson(`/api/v2/documents${qs({ type: "PAYMENT_OUT", ...params })}`),

  paymentWorkbench: (id: string): Promise<typeof mockPaymentWorkbench> =>
    mocksEnabled()
      ? mock(mockPaymentWorkbench)
      : fetchJson(`/api/v2/allocate/payment/${encodeURIComponent(id)}`),

  suppliers: (params: Record<string, string> = {}) =>
    mocksEnabled() ? mock(mockSuppliers) : fetchJson(`/api/v2/suppliers${qs(params)}`),

  compliance: (): Promise<typeof mockCompliance> =>
    mocksEnabled()
      ? mock(mockCompliance)
      : Promise.all([fetchJson(`/api/v2/compliance/msme`), fetchJson(`/api/v2/compliance/gstr2b`)]).then(
          ([msme, gstr2b]) => ({ msme, gstr2b }) as typeof mockCompliance,
        ),

  entities: () =>
    mocksEnabled() ? mock({ entities: mockEntities }) : fetchJson(`/api/v2/entities`),
};

export { mockCopilotAnswer };
