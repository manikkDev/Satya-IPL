// Client for /api/v2/workflow — assignment, reminders, notifications,
// supplier risk scores, the supplier outbox and the CSV case report.

import { fetchJson } from "@/lib/api/client";
import { SERVER_URL } from "@/utils/commonHelper";

export type Assignee = { id: string; name: string; roles: string[] };
export type Reminder = {
  id: string; caseId: string; dueDate: string; note: string; assignee?: string;
  createdBy: string; status: "open" | "done"; doneAt?: string; createdAt?: string;
};
export type Notification = {
  key: string; kind: "finding" | "reminder" | "assignment"; severity: string;
  title: string; detail?: string; href: string; at?: string;
};
export type RiskFactor = { points: number; label: string; detail?: string };
export type SupplierRisk = {
  supplierId: string; supplierName: string; score: number; band: "low" | "medium" | "high";
  openIssues: number; openOrders: number; msme: boolean; factors: RiskFactor[]; method: string;
};
export type OutboxChannel = "email" | "whatsapp" | "sms";
export type OutboxMessage = {
  id: string; channel: OutboxChannel; to: string; subject?: string; body: string;
  status: "queued" | "scheduled" | "sending" | "sent" | "failed" | "link_ready" | "not_configured" | "cancelled";
  link?: string; scheduledFor?: string; lastError?: string; sentAt?: string; createdAt?: string;
  caseId?: string; supplierId?: string;
};

const enc = encodeURIComponent;

export const workflow = {
  assignees: () => fetchJson<{ items: Assignee[] }>(`/api/v2/workflow/assignees`),
  assign: (caseId: string, body: { assignee: string | null; priority?: "low" | "normal" | "high" }) =>
    fetchJson<{ id: string; assignee: string | null; priority: string }>(`/api/v2/workflow/cases/${enc(caseId)}/assign`, { method: "POST", body }),

  reminders: (caseId: string) => fetchJson<{ items: Reminder[] }>(`/api/v2/workflow/cases/${enc(caseId)}/reminders`),
  addReminder: (caseId: string, body: { dueDate: string; note: string; assignee?: string }) =>
    fetchJson<Reminder>(`/api/v2/workflow/cases/${enc(caseId)}/reminders`, { method: "POST", body }),
  setReminder: (id: string, status: "open" | "done") =>
    fetchJson<Reminder>(`/api/v2/workflow/reminders/${enc(id)}`, { method: "PATCH", body: { status } }),

  notifications: () => fetchJson<{ items: Notification[]; unread: number }>(`/api/v2/workflow/notifications`, { timeoutMs: 10_000 }),
  dismiss: (keys: string[]) => fetchJson<{ dismissed: number }>(`/api/v2/workflow/notifications/dismiss`, { method: "POST", body: { keys } }),

  supplierRisks: () => fetchJson<{ items: SupplierRisk[]; note: string }>(`/api/v2/workflow/risk/suppliers`),
  supplierRisk: (id: string) => fetchJson<SupplierRisk>(`/api/v2/workflow/risk/suppliers/${enc(id)}`),

  outboxConfig: () => fetchJson<{ email: boolean; whatsapp: boolean; sms: boolean; quietHours: string }>(`/api/v2/workflow/outbox/config`),
  outbox: (params: { caseId?: string; supplierId?: string }) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
    return fetchJson<{ items: OutboxMessage[] }>(`/api/v2/workflow/outbox${q ? `?${q}` : ""}`);
  },
  send: (body: { channel: OutboxChannel; to: string; subject?: string; body: string; caseId?: string; supplierId?: string; idempotencyKey: string }) =>
    fetchJson<OutboxMessage>(`/api/v2/workflow/outbox`, { method: "POST", body, idempotencyKey: body.idempotencyKey }),
  retry: (id: string) => fetchJson<OutboxMessage>(`/api/v2/workflow/outbox/${enc(id)}/send`, { method: "POST", body: {} }),
  cancel: (id: string) => fetchJson<OutboxMessage>(`/api/v2/workflow/outbox/${enc(id)}/cancel`, { method: "POST", body: {} }),

  /** Downloads the CSV report with the Authorization header (no token in the URL). */
  downloadCaseCsv: async (caseId: string) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const response = await fetch(`${SERVER_URL}/api/v2/workflow/cases/${enc(caseId)}/report.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(response.status === 403 ? "Your role can’t export reports." : "The report couldn’t be generated.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${caseId}-report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
