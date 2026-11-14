// Read access to the assistant's payables computation (GET
// /api/v2/assistant/payables, server/src/routes/v2/assistant.js
// computePayables) — the single source of "disputed / payable / on hold"
// used by Home and Compliance, so the two pages never disagree about which
// bills are safe to pay.

import { fetchJson } from "@/lib/api/client";
import { mocksEnabled } from "@/lib/flags";

type MoneyVal = { amount: string; currency: string };

export type PayableFinding = { id: string; code: string; severity: string; caseId: string | null; amount: string | null };

export type PayableRow = {
  documentId: string;
  invoice: string;
  date: string;
  entityId: string;
  supplier: string;
  supplierId: string | null;
  caseId: string | null;
  total: MoneyVal;
  settled: MoneyVal;
  outstanding: MoneyVal;
  disputed: MoneyVal;
  payable: MoneyVal;
  dueDate: string;
  overdueDays: number;
  daysToDue: number;
  msme: null | {
    category: string;
    dueDate: string;
    daysLeft: number;
    legalDays: number;
    interestEstimate: MoneyVal | null;
  };
  findings: PayableFinding[];
  priority: number;
};

export type PayablesResponse = {
  asOf: string;
  items: PayableRow[];
  total: number;
  totals: {
    count: number;
    outstanding: MoneyVal;
    disputed: MoneyVal;
    payable: MoneyVal;
    overdue: MoneyVal;
    overdueCount: number;
    dueThisWeek: MoneyVal;
    dueThisWeekCount: number;
    msmeOverdue: MoneyVal;
    msmeOverdueCount: number;
    msmeInterestEstimate: MoneyVal;
  };
  bySupplier: { supplierId: string | null; supplier: string; invoices: number; outstanding: MoneyVal; disputed: MoneyVal; overdue: MoneyVal; msme: boolean }[];
};

const m = (amount: string): MoneyVal => ({ amount, currency: "INR" });

const MOCK: PayablesResponse = {
  asOf: "2026-11-15",
  items: [],
  total: 0,
  totals: {
    count: 0, outstanding: m("0.00"), disputed: m("0.00"), payable: m("0.00"), overdue: m("0.00"), overdueCount: 0,
    dueThisWeek: m("0.00"), dueThisWeekCount: 0, msmeOverdue: m("0.00"), msmeOverdueCount: 0, msmeInterestEstimate: m("0.00"),
  },
  bySupplier: [],
};

export function fetchPayables(params: { entityId?: string; status?: string; dueWithinDays?: number; sort?: string; limit?: number } = {}): Promise<PayablesResponse> {
  if (mocksEnabled()) return Promise.resolve(structuredClone(MOCK));
  const q = new URLSearchParams();
  if (params.entityId) q.set("entityId", params.entityId);
  q.set("status", params.status ?? "open");
  if (params.dueWithinDays !== undefined) q.set("dueWithinDays", String(params.dueWithinDays));
  q.set("sort", params.sort ?? "due");
  q.set("limit", String(params.limit ?? 200));
  return fetchJson<PayablesResponse>(`/api/v2/assistant/payables?${q.toString()}`);
}

/** The earlier of the terms due date and the MSME legal deadline. */
export function effectiveDue(row: PayableRow): string {
  const terms = row.dueDate;
  const legal = row.msme?.dueDate;
  if (legal && (!terms || legal < terms)) return legal;
  return terms;
}
