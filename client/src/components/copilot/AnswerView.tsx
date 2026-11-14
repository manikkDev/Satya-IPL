"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, ThumbsDown, ThumbsUp, ShieldCheck, ShieldAlert, Sparkles, Database, ChevronDown, CircleCheck, CircleX, Loader2, ArrowUpRight, CornerDownRight } from "lucide-react";
import type { ActionCardData, Citation, CopilotAnswer, ToolStep } from "@/lib/api/copilot";
import { sendFeedback, tableToCsv, downloadText } from "@/lib/api/copilot";
import { MiniTable } from "./MiniTable";
import { ActionCard } from "./ActionCard";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------- citations */

function CitationChip({ citation }: { citation: Citation }) {
  return (
    <Link
      href={citation.href}
      title={`${citation.label} — open record`}
      aria-label={`Source ${citation.n}: ${citation.label}`}
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-[5px] bg-[var(--accent-soft)] px-1 align-middle text-[11px] font-semibold leading-none text-[var(--accent-strong)] no-underline transition-colors hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
    >
      {citation.n}
    </Link>
  );
}

/** [S12] → a numbered chip linking to the record (unknown refs are dropped). */
function withCitations(markdown: string, citations: Citation[]): string {
  const grouped = markdown.replace(/\[\s*((?:S\d+\s*[,;]\s*)+S\d+)\s*\]/g, (_m, list: string) => list.split(/[,;]/).map((s) => `[${s.trim()}]`).join(" "));
  return grouped.replace(/\s?\[S(\d+)\]/g, (_m, n) => {
    const hit = citations.find((c) => c.ref === `S${n}`);
    return hit ? ` [${hit.n}](cite:${hit.ref})` : "";
  });
}

export function Markdown({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const prepared = useMemo(() => withCitations(text, citations), [text, citations]);
  return (
    <div className="satya-answer text-[15.5px] leading-[1.65] text-[var(--ink-2)] [&_li]:my-1 [&_li]:pl-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2.5 [&_strong]:font-semibold [&_strong]:text-[var(--ink)] [&_ul]:ml-5 [&_ul]:list-disc [&>p:first-child]:mt-0 [&>p:first-child]:text-[17px] [&>p:first-child]:leading-snug [&>p:first-child]:text-[var(--ink)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url}
        components={{
          h1: ({ children }) => <p className="font-semibold text-[var(--ink)]">{children}</p>,
          h2: ({ children }) => <p className="font-semibold text-[var(--ink)]">{children}</p>,
          h3: ({ children }) => <p className="font-semibold text-[var(--ink)]">{children}</p>,
          em: ({ children }) => (String(children).trim() === "Evidence:"
            ? <em className="mr-1 not-italic text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">Evidence</em>
            : <em className="text-[var(--muted)]">{children}</em>),
          a: ({ href, children }) => {
            if (href?.startsWith("cite:")) {
              const c = citations.find((x) => x.ref === href.slice(5));
              return c ? <CitationChip citation={c} /> : null;
            }
            const safe = href && (href.startsWith("/") || /^https?:\/\//.test(href)) ? href : undefined;
            return safe ? <a href={safe} className="text-[var(--accent-strong)] underline underline-offset-2">{children}</a> : <span>{children}</span>;
          },
          table: ({ children }) => <div className="my-3 overflow-x-auto"><table className="w-full text-[13px]">{children}</table></div>,
          code: ({ children }) => <code className="rounded bg-[var(--surface-2)] px-1 font-code text-[13px]">{children}</code>,
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

/* ------------------------------------------------------------- progress */

export function ProgressTrace({ steps, stage, live }: { steps: ToolStep[]; stage?: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const done = steps.filter((s) => s.status === "done");
  if (!live && !steps.length) return null;
  const visible = live || open;
  return (
    <div className="text-[13px] text-[var(--muted)]">
      {!live && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:text-[var(--ink)]">
          <Database size={13} aria-hidden="true" />
          Checked {done.length} source{done.length === 1 ? "" : "s"} in your records
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      )}
      {visible && (
        <ol className={cn("space-y-1", !live && "mt-1.5 border-l border-[var(--line)] pl-3")} aria-live={live ? "polite" : undefined}>
          {steps.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              {s.status === "start" ? <Loader2 size={13} className="animate-spin text-[var(--accent)]" aria-hidden="true" /> : s.ok ? <CircleCheck size={13} className="text-[var(--confirmed)]" aria-hidden="true" /> : <CircleX size={13} className="text-[var(--sev-high)]" aria-hidden="true" />}
              <span className="text-[var(--ink-2)]">{s.label || s.name.replaceAll("_", " ")}</span>
              {s.status === "done" && s.summary ? <span className="truncate text-[var(--muted)]">· {s.summary}</span> : null}
            </li>
          ))}
          {live && stage ? (
            <li className="flex items-center gap-2">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--accent)]" />
              </span>
              <span>{stage}</span>
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- answer */

export type Turn = {
  id: string;
  prompt: string;
  streaming: boolean;
  stage?: string;
  steps: ToolStep[];
  draft: string; // streamed text so far
  cards: ActionCardData[];
  answer?: CopilotAnswer;
  error?: string;
};

export function AnswerView({
  turn,
  onAsk,
  onActionResult,
  latest,
}: {
  turn: Turn;
  onAsk: (prompt: string) => void;
  onActionResult: (card: ActionCardData, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) => void;
  latest: boolean;
}) {
  const answer = turn.answer;
  const citations = answer?.citations ?? [];
  const sources = answer?.sources ?? citations;
  const cards = answer?.actions?.length ? answer.actions : turn.cards;
  const followUps = answer?.followUps ?? answer?.suggestedFollowUps ?? [];
  const text = answer?.content ?? turn.draft;
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [showSources, setShowSources] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.replace(/\s?\[S\d+\]/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  const exportCsv = () => {
    for (const t of answer?.tables ?? []) downloadText(`${t.title.replace(/[^\w-]+/g, "-").toLowerCase()}.csv`, tableToCsv(t));
  };
  const rate = (next: "up" | "down") => {
    const value = rating === next ? null : next;
    setRating(value);
    if (value && answer?.messageId) sendFeedback(answer.messageId, value).catch(() => undefined);
  };

  if (turn.error && !answer) {
    return (
      <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)] px-4 py-3 text-sm text-[var(--ink-2)]">
        {turn.error}
        <button type="button" onClick={() => onAsk(turn.prompt)} className="ml-2 font-medium text-[var(--accent-strong)] underline">Try again</button>
      </div>
    );
  }

  const g = answer?.grounding;
  const agent = answer?.responseMode === "agent";
  return (
    <article className="space-y-3" aria-busy={turn.streaming}>
      <ProgressTrace steps={turn.steps} stage={turn.stage} live={turn.streaming && !turn.draft} />

      {text ? <Markdown text={text} citations={citations} /> : null}
      {turn.streaming && turn.draft && <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded bg-[var(--accent)] align-middle" aria-hidden="true" />}

      {answer?.options?.length ? (
        <div className="flex flex-wrap gap-2">
          {answer.options.map((o, i) => (
            <button key={i} type="button" onClick={() => onAsk(o.action || o.label)} className="rounded-[var(--radius-sm)] border border-[var(--accent)]/45 bg-[var(--accent-soft)]/50 px-3 py-2 text-left text-[13px] font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]">
              {o.label}
              {o.hint ? <span className="block text-[11px] font-normal opacity-75">{o.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {(answer?.tables ?? []).slice(0, 2).map((t) => <MiniTable key={t.id} table={t} sources={sources} />)}

      {cards.map((card) => <ActionCard key={card.id} card={card} sources={sources} onResult={onActionResult} />)}

      {answer && (
        <>
          {latest && followUps.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {followUps.slice(0, 3).map((f) => (
                <button key={f} type="button" onClick={() => onAsk(f)} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[13px] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--accent-strong)]">
                  <CornerDownRight size={12} className="opacity-60" aria-hidden="true" /> {f}
                </button>
              ))}
            </div>
          )}

          <footer className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--line)] pt-2.5 text-xs text-[var(--muted)]">
            {g && g.claims > 0 ? (
              <span className={cn("inline-flex items-center gap-1", g.rate === 1 ? "text-[var(--confirmed)]" : "text-[var(--possible)]")} title="Every figure is checked against the records the tools returned">
                {g.rate === 1 ? <ShieldCheck size={13} aria-hidden="true" /> : <ShieldAlert size={13} aria-hidden="true" />}
                {g.grounded} of {g.claims} figures checked against your records
              </span>
            ) : null}
            {sources.length > 0 && (
              <button type="button" onClick={() => setShowSources((v) => !v)} aria-expanded={showSources} className="inline-flex items-center gap-1 hover:text-[var(--ink)]">
                {sources.length} source{sources.length === 1 ? "" : "s"}
                <ChevronDown size={12} className={cn("transition-transform", showSources && "rotate-180")} aria-hidden="true" />
              </button>
            )}
            <span className="inline-flex items-center gap-1" title={agent ? `Planned and written by ${answer.llm?.model ?? "the AI model"}; figures from your records` : "AI capacity unavailable — answered directly from your records"}>
              {agent ? <Sparkles size={12} aria-hidden="true" /> : <Database size={12} aria-hidden="true" />}
              {agent ? "AI answer" : "Evidence mode"}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <IconButton label={copied ? "Copied" : "Copy answer"} onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
              {(answer.tables ?? []).length > 0 && <IconButton label="Export tables as CSV" onClick={exportCsv}><Download size={14} /></IconButton>}
              <IconButton label="Helpful" pressed={rating === "up"} onClick={() => rate("up")} className={rating === "up" ? "text-[var(--confirmed)]" : undefined}><ThumbsUp size={14} /></IconButton>
              <IconButton label="Not helpful" pressed={rating === "down"} onClick={() => rate("down")} className={rating === "down" ? "text-[var(--sev-high)]" : undefined}><ThumbsDown size={14} /></IconButton>
            </div>
          </footer>
          {showSources && (
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {sources.map((s, i) => (
                <li key={s.ref}>
                  <Link href={s.href} className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2 text-[13px] text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--ink)]">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-[var(--surface-2)] text-[11px] font-semibold">{s.n ?? i + 1}</span>
                    <span className="truncate">{s.label}</span>
                    <ArrowUpRight size={12} className="ml-auto shrink-0 opacity-60" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

function IconButton({ label, onClick, children, pressed, className }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} className={cn("grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]", className)}>
      {children}
    </button>
  );
}
