"use client";

// Ask Satya — the assistant workspace. A centred 760px conversation with a
// collapsible history rail, sources in an on-demand right panel, and a large
// composer with agent options docked at the bottom. Answers stream in with a
// soft per-word fade; the agent's steps are shown live and fold away when
// the answer arrives; actions are proposals the user confirms.

import "./copilot.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, PanelLeft, SquarePen, X } from "lucide-react";
import {
  streamCopilotChat, stopCopilotChat, stageText, listConversations, getConversation, deleteConversation, recordActionResult, uploadAttachment,
  DEFAULT_AGENT_OPTIONS,
  type ActionCardData, type AgentOptions, type CopilotAnswer, type CopilotConversation, type StoredMessage,
} from "@/lib/api/copilot";
import { pushAiUsage } from "@/lib/ai-usage";
import { useSession } from "@/components/v2/session";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AnswerView, type Turn } from "./AnswerView";
import { StartScreen } from "./StartScreen";
import { Composer, type Attachment, type ComposerHandle } from "./Composer";
import { HistoryRail } from "./HistoryRail";
import { SourcesPanel } from "./SourcesPanel";
import { greeting } from "./format";

const newId = (p = "t") => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const OPTIONS_KEY = "satya.ask.options.v1";
const RAIL_KEY = "satya.ask.rail.v1";

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  },
};

/** Stored messages → turns (assistant payload carries tables/actions). */
function turnsFrom(messages: StoredMessage[] = []): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ id: newId(), prompt: m.content, options: DEFAULT_AGENT_OPTIONS, streaming: false, steps: [], draft: "", cards: [] });
    else {
      const last = turns[turns.length - 1];
      if (!last || last.answer) continue;
      const { role, at, ...answer } = m;
      void role; void at;
      last.answer = { ...(answer as CopilotAnswer), messageId: m.id };
      last.options = { ...DEFAULT_AGENT_OPTIONS, mode: m.agentOptions?.mode ?? "ask" };
      last.steps = (m.toolCalls ?? []).map((t) => ({ ...t, status: "done" as const }));
    }
  }
  return turns;
}

export function AskWorkspace() {
  const params = useSearchParams();
  const about = params.get("about");
  const caseId = params.get("case") ?? undefined;
  const { activeEntity, entities, user } = useSession();
  const queryClient = useQueryClient();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [options, setOptionsState] = useState<AgentOptions>(DEFAULT_AGENT_OPTIONS);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [context, setContext] = useState<{ label: string; caseId?: string } | null>(about ? { label: about, caseId } : null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sourcesFor, setSourcesFor] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [pinned, setPinned] = useState(true);
  const [greetingText, setGreetingText] = useState("Ask Satya");
  const abortRef = useRef<{ controller: AbortController; requestId: string; turnId: string } | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const thread = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);
  const pinnedRef = useRef(true);

  // per-viewer conveniences (mode + toggles, rail state)
  useEffect(() => {
    const saved = store.get<Partial<AgentOptions>>(OPTIONS_KEY, {});
    setOptionsState({ ...DEFAULT_AGENT_OPTIONS, mode: saved.mode ?? "ask", showWorking: Boolean(saved.showWorking), includeScreening: Boolean(saved.includeScreening), confirmedOnly: Boolean(saved.confirmedOnly), scope: {} });
    setRailCollapsed(store.get<{ collapsed: boolean }>(RAIL_KEY, { collapsed: false }).collapsed);
    setGreetingText(greeting(user?.name));
  }, [user?.name]);
  const setOptions = useCallback((next: AgentOptions) => {
    setOptionsState(next);
    store.set(OPTIONS_KEY, { mode: next.mode, showWorking: next.showWorking, includeScreening: next.includeScreening, confirmedOnly: next.confirmedOnly });
  }, []);
  const toggleRail = useCallback((collapsed: boolean) => {
    setRailCollapsed(collapsed);
    store.set(RAIL_KEY, { collapsed });
  }, []);

  const conversations = useQuery({ queryKey: ["copilot-conversations"], queryFn: listConversations, staleTime: 30_000 });
  const items = useMemo(() => conversations.data?.items ?? [], [conversations.data]);
  const lastQuestion = turns.at(-1)?.prompt;
  const activeTitle = items.find((c) => c.id === conversationId)?.title;

  const patchTurn = useCallback((id: string, patch: (t: Turn) => Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));
  }, []);

  /* ---------------------------------------------------------- sending */

  const send = useCallback(async (raw: string, { replace, withOptions }: { replace?: Turn; withOptions?: AgentOptions } = {}) => {
    const ready = attachments.filter((a) => a.phase === "ready" && a.draftId);
    const prompt = raw.trim() || (ready.length && !replace ? "Is this document OK to pay?" : "");
    if (!prompt || busy) return;
    const snapshot: AgentOptions = replace
      ? replace.options
      : { ...(withOptions ?? options), attachmentDocumentIds: ready.map((a) => a.draftId as string) };
    const id = replace?.id ?? newId();
    const fresh: Turn = {
      id, prompt, options: snapshot, attachments: replace ? replace.attachments : ready.map((a) => ({ name: a.summary?.number ? `${a.name}` : a.name })),
      streaming: true, stage: "Reading your question", steps: [], draft: "", cards: [], startedAt: Date.now(), live: true,
    };
    if (!replace) setInput("");
    setBusy(true);
    setSourcesFor(null);
    setTurns((prev) => (replace ? prev.map((t) => (t.id === id ? fresh : t)) : [...prev, fresh]));
    setAnnounce("Satya is working on your question.");
    pinnedRef.current = true;
    setPinned(true);
    const controller = new AbortController();
    const requestId = newId("req");
    abortRef.current = { controller, requestId, turnId: id };
    let gotAnswer = false;
    try {
      const ctx = { page: "/app/ask", caseId: context?.caseId, entityId: activeEntity?.id };
      for await (const ev of streamCopilotChat(prompt, ctx, conversationId ?? undefined, controller.signal, snapshot, requestId)) {
        switch (ev.type) {
          case "status": {
            const detail = ev.detail || stageText(ev.stage);
            patchTurn(id, () => ({ stage: detail }));
            setAnnounce(detail);
            break;
          }
          case "tool":
            patchTurn(id, (t) => {
              const known = t.steps.some((s) => s.id === ev.id);
              const steps = known
                ? t.steps.map((s) => (s.id === ev.id ? { ...s, ...ev } : s))
                : [...t.steps, { id: ev.id, name: ev.name, label: ev.label, status: ev.status, ok: ev.ok, ms: ev.ms, summary: ev.summary, startedAt: Date.now() }];
              return { steps, stage: ev.status === "start" && ev.label ? `${ev.label}…` : t.stage };
            });
            break;
          case "delta":
            patchTurn(id, (t) => ({ draft: t.draft + ev.text, stage: "Writing the answer" }));
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
            patchTurn(id, () => ({ answer, streaming: false, finishedAt: Date.now() }));
            if (answer.conversationId) setConversationId(answer.conversationId);
            setAnnounce("Answer ready.");
            break;
          }
          case "usage": {
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
          default:
            break;
        }
      }
    } catch (error) {
      if (controller.signal.aborted) patchTurn(id, () => ({ stopped: true }));
      else if (!gotAnswer) patchTurn(id, () => ({ error: error instanceof Error && !/abort/i.test(error.message) ? "The answer couldn't be loaded — check your connection and try again." : "The answer couldn't be loaded." }));
    } finally {
      patchTurn(id, (t) => ({ streaming: false, stage: undefined, finishedAt: t.finishedAt ?? Date.now(), stopped: t.stopped || (controller.signal.aborted && !gotAnswer) }));
      setBusy(false);
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["copilot-conversations"] });
    }
  }, [attachments, busy, options, context, activeEntity?.id, conversationId, patchTurn, queryClient]);

  const stop = useCallback(() => {
    const run = abortRef.current;
    if (!run) return;
    void stopCopilotChat(run.requestId);
    run.controller.abort();
    setAnnounce("Stopped.");
  }, []);

  const regenerate = useCallback((turn: Turn) => {
    void send(turn.prompt, { replace: turn });
  }, [send]);

  const newChat = useCallback(() => {
    stop();
    setTurns([]);
    setConversationId(null);
    setContext(null);
    setAttachments([]);
    setSourcesFor(null);
    setRailOpen(false);
    window.scrollTo({ top: 0 });
    setTimeout(() => composer.current?.focus(), 0);
  }, [stop]);

  const openConversation = useCallback(async (conv: CopilotConversation) => {
    stop();
    setRailOpen(false);
    setSourcesFor(null);
    setConversationId(conv.id);
    setTurns([]);
    try {
      const full = await getConversation(conv.id);
      setTurns(turnsFrom(full.messages));
      requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    } catch {
      setTurns([{ id: newId(), prompt: conv.title || "Conversation", options: DEFAULT_AGENT_OPTIONS, streaming: false, steps: [], draft: "", cards: [], error: "This conversation couldn't be loaded." }]);
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

  /* ------------------------------------------------------ attachments */

  const attach = useCallback((files: File[]) => {
    for (const file of files) {
      const id = newId("att");
      const okType = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(file.type);
      const tooBig = file.size > 10 * 1024 * 1024;
      const entry: Attachment = { id, name: file.name, size: file.size, phase: okType && !tooBig ? "uploading" : "failed", error: !okType ? "Only PDF, PNG, JPEG or WebP" : tooBig ? "Larger than 10 MB" : undefined };
      setAttachments((prev) => [...prev, entry].slice(-3));
      if (!okType || tooBig) continue;
      uploadAttachment(file, activeEntity?.id, (phase) => setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, phase } : a))))
        .then((r) => setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, phase: r.draftId && r.status !== "failed" ? "ready" : "failed", draftId: r.draftId, summary: r.summary, error: r.message } : a))))
        .catch((e: unknown) => setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, phase: "failed", error: e instanceof Error ? e.message : "Upload failed" } : a))));
    }
    setTimeout(() => composer.current?.focus(), 0);
  }, [activeEntity?.id]);

  /* ----------------------------------------------------- deep links */

  useEffect(() => {
    if (!about || autoSent.current) return;
    autoSent.current = true;
    const looksLikeQuestion = /\s/.test(about.trim()) && about.trim().split(/\s+/).length >= 3;
    void send(looksLikeQuestion ? about : `What's the status of ${about}, and is anything wrong with it?`);
  }, [about, send]);

  /* ---------------------------------------------- pinned auto-scroll */

  useEffect(() => {
    const onScroll = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
      pinnedRef.current = atBottom;
      setPinned(atBottom);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const hasTurns = turns.length > 0;
  useEffect(() => {
    const el = thread.current;
    // follow growing answers only in a conversation (never on the start screen)
    if (!hasTurns || !el || typeof ResizeObserver === "undefined") return;
    let last = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight;
      if (h > last && pinnedRef.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
      last = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasTurns]);
  const jumpToLatest = () => {
    pinnedRef.current = true;
    setPinned(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  };

  /* -------------------------------------------------------- keyboard */

  useEffect(() => {
    // ⌘K / Ctrl+K = new chat on this page (captured before the global palette)
    const onCapture = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        newChat();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable=true]") !== null;
      if (e.key === "Escape" && abortRef.current) {
        e.preventDefault();
        stop();
      } else if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        composer.current?.focus();
      }
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [newChat, stop]);

  const sourcesTurn = turns.find((t) => t.id === sourcesFor) ?? null;
  const placeholder = context ? `Ask about ${context.label}…` : undefined;
  const entityOptions = (entities ?? []).map((e) => ({ id: e.id, name: (e as { name?: string }).name ?? e.id }));

  const rail = (onCollapse?: () => void) => (
    <HistoryRail items={items} loading={conversations.isLoading} activeId={conversationId} onNew={newChat} onOpen={openConversation} onDelete={removeConversation} onCollapse={onCollapse} />
  );

  return (
    <div className="flex gap-8">
      {/* history — desktop rail */}
      {!railCollapsed && (
        <aside className="sx-fade sticky top-[5.5rem] hidden h-[calc(100dvh-7.5rem)] w-[248px] shrink-0 lg:block">{rail(() => toggleRail(true))}</aside>
      )}
      {/* history — phone/tablet drawer */}
      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[320px] bg-[var(--paper)] p-4 pt-12">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          {rail()}
        </SheetContent>
      </Sheet>

      <div className="min-w-0 flex-1">
        <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-[760px] flex-col">
          {/* slim header */}
          <header className="flex h-10 items-center gap-1.5">
            <button type="button" onClick={() => setRailOpen(true)} aria-label="Show conversations" className="grid h-9 w-9 place-items-center rounded-[10px] text-[var(--ink-2)] hover:bg-[var(--surface-2)] lg:hidden">
              <PanelLeft size={18} aria-hidden="true" />
            </button>
            {railCollapsed && (
              <button type="button" onClick={() => toggleRail(false)} aria-label="Show conversations" title="Show conversations" className="hidden h-9 w-9 place-items-center rounded-[10px] text-[var(--ink-2)] hover:bg-[var(--surface-2)] lg:grid">
                <PanelLeft size={18} aria-hidden="true" />
              </button>
            )}
            <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--ink-2)]">
              {turns.length ? activeTitle || turns[0]?.prompt : <span className="sr-only">Ask Satya</span>}
            </h1>
            {turns.length > 0 && (
              <button type="button" onClick={newChat} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13.5px] font-medium text-[var(--ink-2)] hover:bg-[var(--surface-2)]" title="New chat (⌘K)">
                <SquarePen size={15} aria-hidden="true" /> <span className="hidden sm:inline">New chat</span>
              </button>
            )}
          </header>

          {context && (
            <p className="sx-fade mt-2 inline-flex max-w-full items-center gap-2 self-start rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1 text-[13px] font-medium text-[var(--accent-strong)]">
              <span className="truncate">About: {context.label}</span>
              <button type="button" onClick={() => setContext(null)} aria-label="Remove context" className="hover:opacity-70"><X size={13} aria-hidden="true" /></button>
            </p>
          )}

          <div ref={thread} className="flex-1 pb-8 pt-4">
            {turns.length === 0 ? (
              <StartScreen entityId={activeEntity?.id} onAsk={(q) => send(q)} disabled={busy} name={user?.name} greetingText={greetingText} recent={items} onOpenConversation={openConversation} />
            ) : (
              <div className="space-y-12">
                {turns.map((turn, i) => (
                  <AnswerView
                    key={turn.id}
                    turn={turn}
                    latest={i === turns.length - 1}
                    busy={busy}
                    onAsk={(q) => send(q)}
                    onRegenerate={regenerate}
                    onActionResult={onActionResult}
                    onOpenSources={(t) => setSourcesFor((cur) => (cur === t.id ? null : t.id))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* composer */}
          <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-2 bg-gradient-to-t from-[var(--paper)] from-70% to-transparent px-2 pb-2 pt-6 md:bottom-0 md:pb-4">
            {!pinned && turns.length > 0 && (
              <button type="button" onClick={jumpToLatest} className="sx-rise absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink-2)] shadow-[var(--shadow-2)] hover:text-[var(--ink)]">
                <ArrowDown size={14} aria-hidden="true" /> {busy ? "Follow the answer" : "Jump to latest"}
              </button>
            )}
            <Composer
              ref={composer}
              value={input}
              onChange={setInput}
              onSend={(text) => send(text ?? input)}
              onStop={stop}
              busy={busy}
              lastQuestion={lastQuestion}
              placeholder={placeholder}
              options={options}
              onOptionsChange={setOptions}
              attachments={attachments}
              onAttach={attach}
              onRemoveAttachment={(id) => setAttachments((prev) => prev.filter((a) => a.id !== id))}
              entities={entityOptions}
            />
            <p className="mt-2 px-3 text-center text-[12px] text-[var(--muted)]">
              Satya can be wrong about context but never invents figures. Nothing is sent or paid without your OK.
              <span className="hidden lg:inline"> · <kbd className="font-code">/</kbd> commands · <kbd className="font-code">⇧↵</kbd> new line</span>
            </p>
          </div>
        </div>
      </div>

      <SourcesPanel answer={sourcesTurn?.answer ?? null} onClose={() => setSourcesFor(null)} />

      {/* screen-reader status for streaming */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announce}</p>
    </div>
  );
}
