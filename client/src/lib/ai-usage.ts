// Client for the AI gateway usage meter (contract: docs/plan/02 §7).
// GET /api/v2/ai/usage returns remaining free-tier capacity per model so the
// UI can show a calm "AI capacity" pill. All numbers are estimates produced by
// the gateway — the client never computes quotas itself.

import { SERVER_URL_1 } from "../utils/commonHelper.js";

export type AiUsageModel = {
  model: string;
  task: string;
  remainingToday: number | null;
  limitToday: number | null;
  estimate: boolean;
};

export type AiUsage = {
  mode: "llm" | "evidence_only";
  models: AiUsageModel[];
  keys: { total: number; active: number; cooling: number; exhausted: number; invalid: number };
  /** ISO timestamp of the next quota reset (midnight America/Los_Angeles). */
  resetsAt: string;
  /** Present only for admin users. */
  currentKeyAlias?: string;
};

const authHeader = () => ({
  Authorization: `Bearer ${typeof window !== "undefined" ? localStorage.getItem("token") || "" : ""}`,
});

export async function fetchAiUsage(): Promise<AiUsage | null> {
  try {
    const response = await fetch(`${SERVER_URL_1}/api/v2/ai/usage`, {
      headers: authHeader(),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return (await response.json()) as AiUsage;
  } catch {
    return null;
  }
}

// Subscribers let SSE `usage` events push fresher numbers into the pill
// between polls without the copilot stream owning pill state.
const listeners = new Set<(usage: AiUsage) => void>();
export function pushAiUsage(usage: AiUsage) {
  listeners.forEach((listener) => listener(usage));
}
export function subscribeAiUsage(listener: (usage: AiUsage) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Total estimated requests left today across metered models (null = unmetered). */
export function remainingRequestsToday(usage: AiUsage): number | null {
  let total = 0;
  let any = false;
  for (const model of usage.models) {
    if (typeof model.remainingToday === "number") {
      total += model.remainingToday;
      any = true;
    }
  }
  return any ? total : null;
}

/** Share of the daily capacity still available, 0–1 (null when unknown). */
export function capacityFraction(usage: AiUsage): number | null {
  let remaining = 0;
  let limit = 0;
  for (const model of usage.models) {
    if (typeof model.remainingToday === "number" && typeof model.limitToday === "number") {
      remaining += model.remainingToday;
      limit += model.limitToday;
    }
  }
  return limit > 0 ? Math.max(0, Math.min(1, remaining / limit)) : null;
}

/** "12:30 PM IST" — reset instant rendered in India time (computed, not hard-coded). */
export function formatResetIst(resetsAt: string): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "soon";
  return `${date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })} IST`;
}
