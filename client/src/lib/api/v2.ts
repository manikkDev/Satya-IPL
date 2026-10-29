// Typed v2 API surface. Every call checks NEXT_PUBLIC_USE_MOCKS first so UI
// work never waits on the backend (docs/plan/06 §8, 00 §7.7).

import { fetchJson } from "@/lib/api/client";
import { mocksEnabled } from "@/lib/flags";
import type { Today, Case, Snapshot, GraphPayload, Page, Finding } from "@/lib/api/types";
import { mockToday, mockCase, mockSnapshot, flagshipGraph, mockEntities } from "@/lib/mocks/flagship";

const mock = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));

export const v2 = {
  today: (entityId?: string): Promise<Today> =>
    mocksEnabled()
      ? mock(mockToday)
      : fetchJson<Today>(`/api/v2/dashboard/today${entityId ? `?entityId=${encodeURIComponent(entityId)}` : ""}`),

  cases: (params: Record<string, string> = {}): Promise<Page<Case>> =>
    mocksEnabled()
      ? mock({ items: [mockCase], nextCursor: null, total: 1 })
      : fetchJson<Page<Case>>(`/api/v2/cases?${new URLSearchParams(params)}`),

  case: (id: string): Promise<{ case: Case; snapshot: Snapshot }> =>
    mocksEnabled()
      ? mock({ case: mockCase, snapshot: mockSnapshot })
      : fetchJson<{ case: Case; snapshot: Snapshot }>(`/api/v2/cases/${encodeURIComponent(id)}`),

  findings: (params: Record<string, string> = {}): Promise<Page<Finding>> =>
    mocksEnabled()
      ? mock({ items: mockToday.topFindings, nextCursor: null, total: mockToday.topFindings.length })
      : fetchJson<Page<Finding>>(`/api/v2/findings?${new URLSearchParams(params)}`),

  graph: (caseId: string, asOf?: string): Promise<GraphPayload> =>
    mocksEnabled()
      ? mock(flagshipGraph)
      : fetchJson<GraphPayload>(
          `/api/v2/graph/case/${encodeURIComponent(caseId)}${asOf ? `?asOf=${encodeURIComponent(asOf)}` : ""}`,
        ),

  entities: (): Promise<{ entities: typeof mockEntities }> =>
    mocksEnabled() ? mock({ entities: mockEntities }) : fetchJson(`/api/v2/entities`),
};
