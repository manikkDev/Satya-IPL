"use client";

// Ask Satya (/app/ask) — docs/plan/06 §5.10. Live progress comes from real SSE
// status/tool events, never a fake typing animation. Inline citation chips
// resolve to evidence; cards render only when the backend sends them.

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Send, Plus, FileSearch, Copy, Check, ThumbsUp, ThumbsDown, X, ArrowUpRight, MessageSquare, Trash2 } from "lucide-react";
import { streamCopilotChat, stageText, listConversations, getConversation, deleteConversation, sendFeedback, type CopilotEvent } from "@/lib/api/copilot";
import { mocksEnabled } from "@/lib/flags";
import { pushAiUsage } from "@/lib/ai-usage";
import { AiCapacityPill } from "@/components/AiCapacityPill";
import { CertaintyBadge, FadeIn, Card } from "@/components/ui/v2";
import { useSession } from "@/components/v2/session";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Answer = Extract<CopilotEvent, { type: "answer" }>;
type Turn = {
  id: number;
  prompt: string;
  answer?: Answer;
  error?: string;
  serverMessageId?: string;
};
type Convo = { id: string; title: string; turns: Turn[]; serverId?: string };

function CitationChip({ citation, onOpen }: { citation: NonNullable<Answer["citations"]>[number]; onOpen: (c: typeof citation) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(citation)}
      className="mx-0.5 inline-flex h-5 w-6 items-center justify-center rounded bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-strong)] hover:bg-[var(--accent)] hover:text-white"
      aria-label={`Source ${citation.n}: ${citation.label}`}
      title={citation.label}
    >
      {citation.n}
    </button>
  );
}

function AnswerCard({ answer, onOpenCitation, messageId }: { answer: Answer; onOpenCitation: (c: NonNullable<Answer["citations"]>[number]) => void; messageId?: string }) {
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const citations = answer.citations ?? [];
  const rate = (next: "up" | "down") => {
    const value = rating === next ? null : next;
    setRating(value);
    if (value && messageId && !mocksEnabled()) sendFeedback(messageId, value).catch(() => undefined);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
      {answer.cards?.length ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {answer.cards.map((card) => (
            <div key={card.label} className="rounded-[var(--radius-sm)] bg-[var(--paper)] p-3">
              <p className="text-[11px] text-[var(--muted)]">{card.label}</p>
              <p className="tnum mt-1 text-lg font-semibold text-[var(--ink)]">{card.value}</p>
              {card.detail ? <p className="mt-0.5 text-[11px] text-[var(--muted)]">{card.detail}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="satya-v2-answer text-[15px] leading-relaxed text-[var(--ink-2)] [&_strong]:text-[var(--ink)] [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-3">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => <p className="font-semibold">{children}</p>,
            h2: ({ children }) => <p className="font-semibold">{children}</p>,
            h3: ({ children }) => <p className="font-semibold">{children}</p>,
          }}
        >
          {answer.content}
        </ReactMarkdown>
        {citations.length > 0 && (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Sources:{" "}
            {citations.map((citation) => (
              <CitationChip key={citation.n} citation={citation} onOpen={onOpenCitation} />
            ))}
            <span className="ml-1">click a chip to see the record</span>
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        {answer.certainty ? <CertaintyBadge certainty={answer.certainty} /> : null}
        <span className="text-xs text-[var(--muted)]">
          {citations.length ? `Confidence basis: ${citations.length} document${citations.length === 1 ? "" : "s"}` : "No documents cited"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface-2)]">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" aria-label="Helpful answer" aria-pressed={rating === "up"} onClick={() => rate("up")} className={cn("rounded p-1.5", rating === "up" ? "text-[var(--confirmed)]" : "text-[var(--muted)] hover:bg-[var(--surface-2)]")}>
            <ThumbsUp size={13} />
          </button>
          <button type="button" aria-label="Unhelpful answer" aria-pressed={rating === "down"} onClick={() => rate("down")} className={cn("rounded p-1.5", rating === "down" ? "text-[var(--sev-high)]" : "text-[var(--muted)] hover:bg-[var(--surface-2)]")}>
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Copilot() {
  const params = useSearchParams();
  const { activeEntity } = useSession();
  const about = params.get("about");
  const caseId = params.get("case") ?? undefined;

  const [convos, setConvos] = useState<Convo[]>([{ id: "c1", title: "New conversation", turns: [] }]);
  const [activeConvo, setActiveConvo] = useState("c1");
  const [question, setQuestion] = useState(about ? `Tell me about ${about}` : "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [evidenceOnly, setEvidenceOnly] = useState(false);
  const [context, setContext] = useState(about ?? "");
  const [selectedCitation, setSelectedCitation] = useState<NonNullable<Answer["citations"]>[number] | null>(null);
  const sequence = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const convo = convos.find((item) => item.id === activeConvo) ?? convos[0];
  const suggested = context
    ? [`Summarise ${context}`, `What needs my decision on ${context}?`, `Which documents are still missing?`]
    : ["How much do we really owe on PO-1001?", "Why is INV-041 flagged?", "Which payments are unclear?", "What MSME deadlines are close?"];

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [convo.turns.length, progress]);

  // Load real conversation history when not mocking.
  useEffect(() => {
    if (mocksEnabled()) return;
    listConversations()
      .then(({ items }) => {
        if (!items.length) return;
        setConvos((prev) => {
          const server = items.map((item) => ({ id: `srv_${item.id}`, serverId: item.id, title: item.title || "Conversation", turns: [] }));
          const merged = [...prev.filter((p) => !p.serverId), ...server];
          return merged.length ? merged : prev;
        });
      })
      .catch(() => undefined);
  }, []);

  const openConvo = async (item: Convo) => {
    setActiveConvo(item.id);
    if (!item.serverId || item.turns.length || mocksEnabled()) return;
    try {
      const full = await getConversation(item.serverId);
      const turns: Turn[] = [];
      for (const msg of full.messages ?? []) {
        if (msg.role === "user") turns.push({ id: ++sequence.current, prompt: msg.content });
        else {
          const last = turns[turns.length - 1];
          if (last && !last.answer) {
            const parsed = (() => { try { return JSON.parse(msg.content); } catch { return null; } })();
            last.answer = parsed && parsed.content ? { type: "answer", ...parsed } : { type: "answer", content: msg.content };
          }
        }
      }
      setConvos((prev) => prev.map((c) => (c.id === item.id ? { ...c, turns } : c)));
    } catch {
      /* history unavailable — leave the conversation empty */
    }
  };

  const send = async (prompt: string) => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setProgress("Starting…");
    setQuestion("");
    const turnId = ++sequence.current;
    setConvos((prev) =>
      prev.map((item) =>
        item.id === activeConvo
          ? { ...item, title: item.turns.length ? item.title : text.slice(0, 40), turns: [...item.turns, { id: turnId, prompt: text }] }
          : item,
      ),
    );
    const patch = (patchTurn: Partial<Turn>) =>
      setConvos((prev) =>
        prev.map((item) =>
          item.id === activeConvo
            ? { ...item, turns: item.turns.map((turn) => (turn.id === turnId ? { ...turn, ...patchTurn } : turn)) }
            : item,
        ),
      );
    try {
      for await (const event of streamCopilotChat(text, { page: "/app/ask", caseId, entityId: activeEntity?.id }, convo.serverId)) {
        if (event.type === "status") setProgress(stageText(event.stage) + (event.detail ? ` — ${event.detail}` : "…"));
        else if (event.type === "tool") setProgress(`${event.name.replaceAll("_", " ")}…`);
        else if (event.type === "answer") {
          patch({ answer: event });
          if (event.mode === "evidence_only") setEvidenceOnly(true);
        } else if (event.type === "usage") pushAiUsage(event.usage);
        else if (event.type === "done" && event.messageId) {
          // done.messageId is the server conversation id — remember it so the
          // next turn continues the same conversation and feedback can target it.
          const serverId = event.messageId;
          patch({ serverMessageId: serverId });
          setConvos((prev) => prev.map((c) => (c.id === activeConvo ? { ...c, serverId } : c)));
        } else if (event.type === "error") patch({ error: event.message });
      }
    } catch (error) {
      patch({ error: error instanceof Error ? error.message : "The answer could not be loaded." });
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const newConvo = () => {
    const id = `c${++sequence.current}`;
    setConvos((prev) => [{ id, title: "New conversation", turns: [] }, ...prev]);
    setActiveConvo(id);
    input.current?.focus();
  };

  return (
    <FadeIn className="flex gap-5">
      {/* left rail — conversations */}
      <aside className="hidden w-52 shrink-0 lg:block" aria-label="Conversations">
        <button
          type="button"
          onClick={newConvo}
          className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--accent)]/50 px-3 py-2 text-sm font-medium text-[var(--accent-strong)] transition-colors hover:bg-[var(--accent-soft)]"
        >
          <Plus size={15} aria-hidden="true" /> New chat
        </button>
        <ul className="mt-3 space-y-1">
          {convos.map((item) => (
            <li key={item.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => openConvo(item)}
                aria-current={item.id === activeConvo}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm",
                  item.id === activeConvo ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]",
                )}
              >
                {item.title}
              </button>
              {item.serverId && !mocksEnabled() && (
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={async () => {
                    await deleteConversation(item.serverId!).catch(() => undefined);
                    setConvos((prev) => {
                      const rest = prev.filter((c) => c.id !== item.id);
                      if (activeConvo === item.id && rest.length) setActiveConvo(rest[0].id);
                      return rest.length ? rest : [{ id: "c0", title: "New conversation", turns: [] }];
                    });
                  }}
                  className="hidden shrink-0 rounded p-1 text-[var(--muted)] hover:text-[var(--sev-critical)] group-hover:block"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* centre */}
      <div className="min-w-0 max-w-[760px] flex-1">
        {context && (
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent-strong)]">
            About: {context}
            <button type="button" onClick={() => setContext("")} aria-label="Remove context" className="transition-opacity hover:opacity-70"><X size={12} /></button>
          </span>
        )}
        <h1 className="text-xl font-semibold tracking-tight text-[var(--ink)]">Ask Satya</h1>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
          Answers come from your records — every figure links back to a document. Missing information is never guessed.
        </p>

        {evidenceOnly && (
          <p className="mt-3 rounded-[var(--radius-sm)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] px-3 py-2 text-xs text-[var(--possible)]">
            Evidence-only mode: AI capacity is used up, so answers come straight from your documents without language
            model help.
          </p>
        )}

        <div className="mt-5 space-y-4">
          {convo.turns.length === 0 && (
            <div className="flex flex-col items-center rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] px-6 py-12 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--surface-2)]">
                <MessageSquare size={20} className="text-[var(--muted)]" aria-hidden="true" />
              </div>
              <p className="mt-4 text-[15px] font-medium text-[var(--ink)]">What would you like to understand?</p>
              <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--muted)]">Ask about any order, invoice, payment or deadline in your records.</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {suggested.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    disabled={busy}
                    onClick={() => send(prompt)}
                    className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-1.5 text-xs text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {convo.turns.map((turn) => (
            <div key={turn.id} className="space-y-3">
              <p className="ml-auto w-fit max-w-[85%] rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2.5 text-sm text-white">
                <span className="sr-only">You asked: </span>{turn.prompt}
              </p>
              {turn.answer ? (
                <AnswerCard answer={turn.answer} onOpenCitation={setSelectedCitation} messageId={turn.serverMessageId} />
              ) : turn.error ? (
                <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--sev-critical)] bg-[var(--sev-critical-soft)] p-4 text-sm text-[var(--ink-2)]">
                  {turn.error}
                  <button type="button" onClick={() => send(turn.prompt)} className="ml-2 font-medium text-[var(--accent)]">Try again</button>
                </div>
              ) : (
                <div role="status" aria-live="polite" className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
                  <p className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden="true" />
                    {progress || "Starting…"}
                  </p>
                </div>
              )}
            </div>
          ))}
          <div ref={bottom} />
        </div>

        {/* composer */}
        <form
          className="sticky bottom-0 mt-5 bg-[var(--paper)] pb-2 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            send(question);
          }}
        >
          <div className="flex items-end gap-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow-1)] transition-colors focus-within:border-[var(--accent)]/50">
            <Textarea
              ref={input}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send(question);
                }
              }}
              rows={2}
              maxLength={4000}
              disabled={busy}
              aria-label="Your question"
              placeholder={context ? `Ask about ${context}…` : "Ask about an order, invoice or payment…"}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-50"
              aria-label={busy ? "Waiting for answer" : "Send question"}
            >
              <Send size={16} />
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between px-1 text-[11px] text-[var(--muted)]">
            <span>Enter to send · Shift+Enter for a new line · nothing is sent to suppliers</span>
            <AiCapacityPill />
          </div>
        </form>
      </div>

      {/* right panel — sources */}
      <aside className="hidden w-64 shrink-0 xl:block" aria-label="Sources">
        <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ink)]">
            <FileSearch size={15} aria-hidden="true" /> Sources & graph
          </h2>
          {selectedCitation ? (
            <div className="mt-3">
              <p className="text-xs font-medium text-[var(--ink)]">[{selectedCitation.n}] {selectedCitation.label}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Document <span className="font-code">{selectedCitation.documentId}</span></p>
              {selectedCitation.href ? (
                <Link href={selectedCitation.href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
                  Open document <ArrowUpRight size={12} />
                </Link>
              ) : null}
              <button type="button" onClick={() => setSelectedCitation(null)} className="mt-3 text-xs text-[var(--muted)] hover:text-[var(--ink)]">
                Show all sources
              </button>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {(convo.turns.at(-1)?.answer?.citations ?? []).map((citation) => (
                <li key={citation.n}>
                  <button type="button" onClick={() => setSelectedCitation(citation)} className="w-full rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2 text-left text-xs text-[var(--ink-2)] hover:border-[var(--accent)]">
                    [{citation.n}] {citation.label}
                  </button>
                </li>
              ))}
              {!convo.turns.at(-1)?.answer?.citations?.length && (
                <li className="text-xs text-[var(--muted)]">Sources for the selected answer appear here.</li>
              )}
            </ul>
          )}
        </div>
      </aside>
    </FadeIn>
  );
}

export default function AskPage() {
  return (
    <Suspense fallback={<div role="status" className="p-8 text-sm text-[var(--muted)]">Loading Ask Satya…</div>}>
      <Copilot />
    </Suspense>
  );
}
