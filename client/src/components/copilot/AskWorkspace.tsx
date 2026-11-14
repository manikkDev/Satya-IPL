"use client";

// Ask Satya — the assistant workspace: persisted conversations, a daily
// briefing start screen, token streaming with a live tool trace, grounded
// answers with citation chips, mini-tables, action cards (confirm runs the
// real API with the user's session) and follow-up suggestions.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, PanelLeft, Trash2, MessagesSquare, Sparkles, X, Keyboard } from "lucide-react";
import {
  streamCopilotChat, stageText, listConversations, getConversation, deleteConversation, recordActionResult,
  type ActionCardData, type CopilotAnswer, type CopilotConversation, type StoredMessage,
} from "@/lib/api/copilot";
import { pushAiUsage } from "@/lib/ai-usage";
import { useSession } from "@/components/v2/session";
import { AiCapacityPill } from "@/components/AiCapacityPill";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AnswerView, type Turn } from "./AnswerView";
import { StartScreen } from "./StartScreen";
import { Composer, type ComposerHandle } from "./Composer";
import { relativeTime } from "./format";
import { cn } from "@/lib/utils";

const newId = () => `t_${Math.random().toString(36).slice(2, 10)}`;

/** Stored messages → turns (assistant payload carries tables/actions). */
function turnsFrom(messages: StoredMessage[] = []): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ id: newId(), prompt: m.content, streaming: false, steps: [], draft: "", cards: [] });
    else {
      const last = turns[turns.length - 1];
      if (!last || last.answer) continue;
      const { role, at, ...answer } = m;
      void role; void at;
      last.answer = { ...(answer as CopilotAnswer), messageId: m.id };
      last.steps = (m.toolCalls ?? []).map((t) => ({ ...t, status: "done" as const }));
    }
  }
  return turns;
}

export function AskWorkspace() {
  const params = useSearchParams();
  const about = params.get("about");
  const caseId = params.get("case") ?? undefined;
  const { activeEntity } = useSession();
  const queryClient = useQueryClient();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<{ label: string; caseId?: string } | null>(about ? { label: about, caseId } : null);
  const [railOpen, setRailOpen] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  const conversations = useQuery({ queryKey: ["copilot-conversations"], queryFn: listConversations, staleTime: 30_000 });
  const lastQuestion = turns.at(-1)?.prompt;

  const patchTurn = useCallback((id: string, patch: (t: Turn) => Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));
  }, []);

  const send = useCallback(async (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || busy) return;
    const id = newId();
    setInput("");
    setBusy(true);
    setTurns((prev) => [...prev, { id, prompt, streaming: true, stage: "Reading your question", steps: [], draft: "", cards: [] }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let gotAnswer = false;
    try {
      const ctx = { page: "/app/ask", caseId: context?.caseId, entityId: activeEntity?.id };
      for await (const ev of streamCopilotChat(prompt, ctx, conversationId ?? undefined, controller.signal)) {
        switch (ev.type) {
          case "status":
            patchTurn(id, () => ({ stage: ev.detail || stageText(ev.stage) }));
            break;
          case "tool":
            patchTurn(id, (t) => {
              const steps = t.steps.some((s) => s.id === ev.id) ? t.steps.map((s) => (s.id === ev.id ? { ...s, ...ev } : s)) : [...t.steps, { id: ev.id, name: ev.name, label: ev.label, status: ev.status, ok: ev.ok, ms: ev.ms, summary: ev.summary }];
              return { steps };
            });
            break;
          case "delta":
            patchTurn(id, (t) => ({ draft: t.draft + ev.text }));
            break;
          case "reset":
            patchTurn(id, () => ({ draft: "" }));
            break;
          case "action":
            patchTurn(id, (t) => ({ cards: t.cards.some((c) => c.id === ev.card.id) ? t.cards : [...t.cards, ev.card] }));
            break;
          case "answer": {
            gotAnswer = true;
            const { type, ...answer } = ev;
            void type;
            patchTurn(id, () => ({ answer, streaming: false }));
            if (answer.conversationId) setConversationId(answer.conversationId);
            break;
          }
          case "usage": {
            // the stream sends an abbreviated meter (no per-model rows); only a
            // full usage object may reach the capacity pill
            const { type, ...usage } = ev;
            void type;
            const full = (usage.usage ?? usage) as Partial<Parameters<typeof pushAiUsage>[0]>;
            if (Array.isArray(full?.models)) pushAiUsage(full as Parameters<typeof pushAiUsage>[0]);
            break;
          }
          case "error":
            if (ev.code !== "NOT_FOUND") patchTurn(id, () => ({ error: ev.message }));
            break;
          case "done":
            if (ev.conversationId) setConversationId(ev.conversationId);
            break;
        }
      }
    } catch (error) {
      if (!gotAnswer) patchTurn(id, () => ({ error: controller.signal.aborted ? "Stopped. Ask again whenever you're ready." : error instanceof Error ? error.message : "The answer could not be loaded." }));
    } finally {
      patchTurn(id, () => ({ streaming: false, stage: undefined }));
      setBusy(false);
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] });
    }
  }, [busy, context, activeEntity?.id, conversationId, patchTurn, queryClient]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    stop();
    setTurns([]);
    setConversationId(null);
    setContext(null);
    setRailOpen(false);
    setTimeout(() => composer.current?.focus(), 0);
  }, [stop]);

  const openConversation = useCallback(async (conv: CopilotConversation) => {
    stop();
    setRailOpen(false);
    setConversationId(conv.id);
    setTurns([]);
    try {
      const full = await getConversation(conv.id);
      setTurns(turnsFrom(full.messages));
    } catch {
      setTurns([{ id: newId(), prompt: conv.title || "Conversation", streaming: false, steps: [], draft: "", cards: [], error: "This conversation couldn't be loaded." }]);
    }
  }, [stop]);

  const removeConversation = useCallback(async (id: string) => {
    await deleteConversation(id).catch(() => undefined);
    if (id === conversationId) newChat();
    queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] });
  }, [conversationId, newChat, queryClient]);

  const onActionResult = useCallback((card: ActionCardData, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) => {
    setTurns((prev) => prev.map((t) => ({
      ...t,
      cards: t.cards.map((c) => (c.id === card.id ? { ...c, status: result.status, result } : c)),
      answer: t.answer ? { ...t.answer, actions: (t.answer.actions ?? []).map((c) => (c.id === card.id ? { ...c, status: result.status, result } : c)) } : t.answer,
    })));
    if (conversationId) void recordActionResult(conversationId, card.id, result);
  }, [conversationId]);

  // "Explain this" deep links (?about=…&case=…) ask straight away
  useEffect(() => {
    if (!about || autoSent.current) return;
    autoSent.current = true;
    const looksLikeQuestion = /\s/.test(about.trim()) && about.trim().split(/\s+/).length >= 3;
    void send(looksLikeQuestion ? about : `What's the status of ${about}, and is anything wrong with it?`);
  }, [about, send]);

  // keep the newest content in view while streaming
  const lastDraft = turns.at(-1)?.draft.length ?? 0;
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bottom.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [turns.length, lastDraft]);

  // shortcuts: "/" focus · Ctrl/⌘+Shift+O new chat · Esc stop · ? help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable=true]") !== null);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        composer.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        newChat();
      } else if (e.key === "Escape" && busy) {
        stop();
      } else if (e.key === "?" && !typing) {
        setShowKeys((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, newChat, stop]);

  const items = useMemo(() => conversations.data?.items ?? [], [conversations.data]);
  const activeTitle = items.find((c) => c.id === conversationId)?.title;

  const rail = (
    <nav aria-label="Conversations" className="flex h-full flex-col">
      <button type="button" onClick={newChat} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--accent)]/45 px-3 py-2.5 text-sm font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]">
        <MessageSquarePlus size={16} aria-hidden="true" /> New question
        <kbd className="ml-auto hidden rounded border border-[var(--line)] px-1 text-[10px] font-normal text-[var(--muted)] xl:inline">⇧⌘O</kbd>
      </button>
      <p className="mt-5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Recent</p>
      <ul className="mt-1.5 flex-1 space-y-0.5 overflow-y-auto">
        {conversations.isLoading && <li className="px-2 py-1 text-xs text-[var(--muted)]">Loading…</li>}
        {!conversations.isLoading && !items.length && <li className="px-2 py-1 text-xs leading-relaxed text-[var(--muted)]">Your questions are saved here so you can pick up later.</li>}
        {items.map((c) => (
          <li key={c.id} className="group flex items-center">
            <button
              type="button"
              onClick={() => openConversation(c)}
              aria-current={c.id === conversationId ? "true" : undefined}
              className={cn("min-w-0 flex-1 rounded-[var(--radius-sm)] px-2.5 py-2 text-left", c.id === conversationId ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}
            >
              <span className="block truncate text-[13.5px] font-medium">{c.title || "Conversation"}</span>
              <span className="block text-[11px] text-[var(--muted)]">{relativeTime(c.updatedAt)}{c.messageCount ? ` · ${Math.ceil(c.messageCount / 2)} question${c.messageCount > 2 ? "s" : ""}` : ""}</span>
            </button>
            <button type="button" aria-label={`Delete “${c.title || "conversation"}”`} onClick={() => removeConversation(c.id)} className="ml-0.5 shrink-0 rounded p-1.5 text-[var(--muted)] opacity-0 transition-opacity hover:text-[var(--sev-critical)] focus-visible:opacity-100 group-hover:opacity-100">
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] gap-6">
      <aside className="sticky top-20 hidden h-[calc(100dvh-7rem)] w-60 shrink-0 lg:block">{rail}</aside>

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-xs bg-[var(--paper)] p-4">
          <SheetTitle className="mb-3 text-sm">Conversations</SheetTitle>
          {rail}
        </SheetContent>
      </Sheet>

      <div className="mx-auto flex min-w-0 max-w-[820px] flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 pb-4">
          <button type="button" onClick={() => setRailOpen(true)} className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] text-[var(--ink-2)] lg:hidden" aria-label="Show conversations">
            <PanelLeft size={16} aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-[var(--ink)]">
              <Sparkles size={18} className="text-[var(--accent)]" aria-hidden="true" /> Ask Satya
            </h1>
            <p className="truncate text-[13px] text-[var(--muted)]">{activeTitle ?? "Answers from your own records — every figure checked, every action needs your OK."}</p>
          </div>
          <button type="button" onClick={() => setShowKeys((v) => !v)} className="hidden h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-xs text-[var(--muted)] hover:bg-[var(--surface-2)] sm:inline-flex" aria-expanded={showKeys}>
            <Keyboard size={13} aria-hidden="true" /> Shortcuts
          </button>
          <AiCapacityPill />
          {turns.length > 0 && (
            <button type="button" onClick={newChat} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-2.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)] lg:hidden">
              <MessageSquarePlus size={14} aria-hidden="true" /> New
            </button>
          )}
        </header>

        {showKeys && (
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3 text-[13px] text-[var(--ink-2)] sm:grid-cols-3">
            {[["/", "Focus the question box"], ["Enter", "Send"], ["Shift + Enter", "New line"], ["Esc", "Stop the answer"], ["↑", "Edit last question"], ["Ctrl/⌘ + Shift + O", "New conversation"]].map(([k, v]) => (
              <p key={k}><kbd className="rounded border border-[var(--line-strong)] bg-[var(--surface-2)] px-1.5 font-code text-[11px]">{k}</kbd> {v}</p>
            ))}
          </div>
        )}

        {context && (
          <p className="mb-3 inline-flex max-w-full items-center gap-2 self-start rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-strong)]">
            <span className="truncate">About: {context.label}</span>
            <button type="button" onClick={() => setContext(null)} aria-label="Remove context" className="hover:opacity-70"><X size={12} aria-hidden="true" /></button>
          </p>
        )}

        <div className="flex-1 space-y-8 pb-6">
          {turns.length === 0 ? (
            <StartScreen entityId={activeEntity?.id} onAsk={send} disabled={busy} />
          ) : (
            turns.map((turn, i) => (
              <div key={turn.id} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-lg)] rounded-br-[6px] bg-[var(--surface-2)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--ink)]">
                    <span className="sr-only">You asked: </span>{turn.prompt}
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="mt-0.5 hidden h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)] sm:grid" aria-hidden="true">
                    <MessagesSquare size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <AnswerView turn={turn} onAsk={send} onActionResult={onActionResult} latest={i === turns.length - 1} />
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={bottom} />
        </div>

        <div className="sticky bottom-0 -mx-1 bg-gradient-to-t from-[var(--paper)] via-[var(--paper)] to-transparent px-1 pb-3 pt-4">
          <Composer
            ref={composer}
            value={input}
            onChange={setInput}
            onSend={() => send(input)}
            onStop={stop}
            busy={busy}
            lastQuestion={lastQuestion}
            placeholder={context ? `Ask about ${context.label}…` : undefined}
          />
          <p className="mt-1.5 px-2 text-[11px] text-[var(--muted)]">
            Satya can be wrong about context but never invents figures — each one is checked against your records. Nothing is sent or paid without your confirmation.
          </p>
        </div>
      </div>
    </div>
  );
}
