// Copilot SSE client (contract: docs/plan/02 §7). Uses fetch + ReadableStream
// because EventSource cannot send Authorization headers. In mock mode it
// replays a scripted grounded answer so the full UI works without the gateway.

import { SERVER_URL_1 } from "../../utils/commonHelper.js";
import { mocksEnabled } from "../flags";
import { mockCopilotAnswer } from "../mocks/data";
import { pushAiUsage } from "../ai-usage";

export type CopilotEvent =
  | { type: "status"; stage: "understanding" | "retrieving" | "checking" | "writing"; detail?: string }
  | { type: "tool"; name: string; args?: unknown; ms?: number; ok?: boolean }
  | { type: "token"; text: string }
  | {
      type: "answer";
      content: string;
      answerType?: string;
      certainty?: "CONFIRMED" | "PROBABLE" | "POSSIBLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";
      mode?: "llm" | "evidence_only";
      citations?: { n: number; evidenceId: string; label: string; documentId: string; href?: string }[];
      facts?: Record<string, string>;
      cards?: { label: string; value: string; detail?: string }[];
      /** Clarification choices — render as clickable chips that send the pick. */
      options?: { label: string; action?: string; hint?: string }[];
      /** Pipeline emits `followUps`; older shape was `suggestedFollowUps` — render either. */
      suggestedFollowUps?: string[];
      followUps?: string[];
    }
  | { type: "usage"; usage: Parameters<typeof pushAiUsage>[0] }
  | { type: "error"; code?: string; message: string }
  | { type: "done"; messageId?: string };

export type CopilotContext = {
  page?: string;
  caseId?: string;
  documentId?: string;
  supplierId?: string;
  entityId?: string;
};

const STAGE_TEXT: Record<string, string> = {
  understanding: "Understanding your question",
  retrieving: "Finding records",
  checking: "Checking documents and payments",
  writing: "Writing the answer",
};

export function stageText(stage: string): string {
  return STAGE_TEXT[stage] ?? stage;
}

function authHeader(): Record<string, string> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function* mockStream(message: string): AsyncGenerator<CopilotEvent> {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  yield { type: "status", stage: "understanding", detail: "Reading the question" };
  await pause(350);
  yield { type: "status", stage: "retrieving", detail: "Finding PO-1001" };
  await pause(400);
  yield { type: "tool", name: "get_case_snapshot", args: { case: "PO-1001" }, ms: 180, ok: true };
  yield { type: "status", stage: "checking", detail: "Reading 4 documents · checking payments" };
  await pause(450);
  yield { type: "tool", name: "check_payments", args: { case: "PO-1001" }, ms: 220, ok: true };
  yield { type: "status", stage: "writing", detail: "Writing answer with citations" };
  await pause(300);
  void message;
  yield { type: "answer", ...mockCopilotAnswer, mode: "llm" };
  yield {
    type: "usage",
    usage: {
      mode: "llm",
      models: [{ model: "gemini-2.5-flash", task: "chat", remainingToday: 1240, limitToday: 1500, estimate: true }],
      keys: { total: 68, active: 61, cooling: 4, exhausted: 3, invalid: 0 },
      resetsAt: "2026-10-30T07:00:00.000Z",
    },
  };
  yield { type: "done", messageId: "msg_mock_1" };
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<CopilotEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
      const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;
      const type = eventLine.slice(6).trim() as CopilotEvent["type"];
      try {
        const data = JSON.parse(dataLine.slice(5));
        yield { type, ...data } as CopilotEvent;
      } catch {
        // skip malformed event
      }
    }
  }
}

export type CopilotConversation = {
  id: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: { role: string; content: string; createdAt?: string }[];
};

async function copilotJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL_1}/api/v2/copilot${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeader(), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Copilot request failed (${response.status})`);
  return response.status === 204 ? (undefined as T) : response.json();
}

export function listConversations(): Promise<{ items: CopilotConversation[] }> {
  return copilotJson("/conversations");
}

export function getConversation(id: string): Promise<CopilotConversation> {
  return copilotJson(`/conversations/${encodeURIComponent(id)}`);
}

export function deleteConversation(id: string): Promise<void> {
  return copilotJson(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function sendFeedback(messageId: string, rating: "up" | "down", reason?: string): Promise<void> {
  return copilotJson("/feedback", { method: "POST", body: JSON.stringify({ messageId, rating, reason }) });
}

export async function* streamCopilotChat(
  message: string,
  context: CopilotContext = {},
  conversationId?: string,
): AsyncGenerator<CopilotEvent> {
  if (mocksEnabled()) {
    yield* mockStream(message);
    return;
  }
  const response = await fetch(`${SERVER_URL_1}/api/v2/copilot/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeader() },
    body: JSON.stringify({ conversationId, message, context }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    yield { type: "error", code: data?.error?.code, message: data?.error?.message || `Copilot unavailable (${response.status})` };
    return;
  }
  if (!response.body) {
    yield { type: "error", message: "Copilot stream unavailable" };
    return;
  }
  yield* parseSse(response.body);
}
