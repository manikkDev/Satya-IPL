"use client";

// One question + answer: the user's bubble, then the assistant's bubble-less
// answer — working steps, progressively revealed text with a caret, tables,
// action cards, follow-ups and the per-answer toolbar.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen, Check, Copy, CornerDownRight, Database, FileText, ListChecks, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp,
} from "lucide-react";
import type { ActionCardData, AgentOptions, CopilotAnswer } from "@/lib/api/copilot";
import { sendFeedback } from "@/lib/api/copilot";
import { Prose, segmentAnswer, citationNumbers } from "./Prose";
import { WorkingSteps, type LiveStep } from "./Steps";
import { MiniTable } from "./MiniTable";
import { ActionCard } from "./ActionCard";
import { MODE_META } from "./modes";
import { cn } from "@/lib/utils";

export type Turn = {
  id: string;
  prompt: string;
  options: AgentOptions;
  attachments?: { name: string }[];
  streaming: boolean;
  stage?: string;
  steps: LiveStep[];
  draft: string; // streamed text so far
  cards: ActionCardData[];
  answer?: CopilotAnswer;
  error?: string;
  stopped?: boolean;
  startedAt?: number;
  finishedAt?: number;
  /** reveal progressively (answers produced in this session) */
  live?: boolean;
};

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Smoothly reveals `target` word by word (rAF, ~30 fps), catching up faster
 * when a lot of text is waiting. Replaced text (a reset) restarts from the
 * common prefix.
 */
function useSmoothText(target: string, animate: boolean): string {
  const [shown, setShown] = useState(animate ? "" : target);
  const shownRef = useRef(shown);
  useEffect(() => {
    if (!animate || reducedMotion()) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const cur = shownRef.current;
    if (!target.startsWith(cur)) {
      let i = 0;
      while (i < cur.length && i < target.length && cur[i] === target[i]) i++;
      shownRef.current = target.slice(0, i);
      setShown(shownRef.current);
    }
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      const now = shownRef.current;
      if (now.length >= target.length) return;
      if (t - last >= 30) {
        last = t;
        const backlog = target.length - now.length;
        let next = now.length + Math.max(3, Math.ceil(backlog / 14));
        while (next < target.length && !/\s/.test(target[next])) next++;
        shownRef.current = target.slice(0, next);
        setShown(shownRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, animate]);
  return animate ? shown : target;
}

function ToolButton({ label, onClick, children, pressed, className, disabled }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className={cn("grid h-8 w-8 place-items-center rounded-[8px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-40", className)}
    >
      {children}
    </button>
  );
}

/** Say each fact once: drop a table whose rows repeat an earlier table's. */
function uniqueTables<T extends { rows: Record<string, unknown>[]; columns: { key: string }[] }>(tables: T[]): T[] {
  const seen = new Set<string>();
  return tables.filter((t) => {
    const key = t.rows.map((r) => String(r[t.columns[0]?.key ?? ""] ?? "")).sort().join("|");
    if (key && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const DOWN_REASONS =["A figure looks wrong", "Not what I asked", "Missing something", "Too long"];

export function AnswerView({
  turn,
  latest,
  busy,
  onAsk,
  onRegenerate,
  onActionResult,
  onOpenSources,
}: {
  turn: Turn;
  latest: boolean;
  busy: boolean;
  onAsk: (prompt: string) => void;
  onRegenerate: (turn: Turn) => void;
  onActionResult: (card: ActionCardData, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) => void;
  onOpenSources: (turn: Turn) => void;
}) {
  const answer = turn.answer;
  const citations = answer?.citations ?? [];
  const sources = answer?.sources?.length ? answer.sources : citations;
  const cards = answer?.actions?.length ? answer.actions : turn.cards;
  const followUps = answer?.followUps ?? answer?.suggestedFollowUps ?? [];
  const target = answer?.content ?? turn.draft;
  const shown = useSmoothText(target, Boolean(turn.live));
  const revealing = shown.length < target.length;
  const writing = turn.streaming || revealing;
  const working = turn.streaming && !turn.draft && !answer;
  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [reasonSent, setReasonSent] = useState(false);
  const mode = answer?.agentOptions?.mode ?? turn.options.mode;
  const modeMeta = MODE_META[mode];

  const copy = async () => {
    const { segments } = segmentAnswer(target, false);
    const plain = segments.map((s) => (s.kind === "draft" ? `${s.title}\n${s.body}` : s.kind === "working" ? `How we calculated\n${s.text}` : s.text)).join("\n\n");
    try {
      await navigator.clipboard.writeText(plain.replace(/\s?\[S\d+\]/g, "").replace(/\n{3,}/g, "\n\n").trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const rate = (next: "up" | "down") => {
    const value = rating === next ? null : next;
    setRating(value);
    setAskReason(value === "down");
    setReasonSent(false);
    if (value && answer?.messageId) sendFeedback(answer.messageId, value).catch(() => undefined);
  };
  const sendReason = (reason: string) => {
    if (answer?.messageId) sendFeedback(answer.messageId, "down", reason).catch(() => undefined);
    setReasonSent(true);
    setTimeout(() => setAskReason(false), 1400);
  };

  const g = answer?.grounding;
  const agent = answer?.responseMode === "agent";
  const evidenceRefs = segmentAnswer(target, false).evidence;
  const numbered = citationNumbers(target, citations);
  const sourceCount = sources.length;
  const totalMs = answer ? answer.latencyMs ?? (turn.finishedAt && turn.startedAt ? turn.finishedAt - turn.startedAt : undefined) : undefined;

  return (
    <article className="space-y-5" aria-busy={turn.streaming}>
      {/* the question */}
      <div className="flex flex-col items-end gap-1.5">
        <div className="sx-fade max-w-[88%] rounded-[20px] rounded-br-[6px] bg-[var(--surface-2)] px-4 py-2.5 text-[15.5px] leading-relaxed text-[var(--ink)] sm:max-w-[80%]">
          <span className="sr-only">You asked: </span>
          <span className="whitespace-pre-wrap">{turn.prompt}</span>
        </div>
        {(turn.attachments?.length || mode !== "ask") ? (
          <div className="flex flex-wrap justify-end gap-1.5 text-[12px] text-[var(--muted)]">
            {mode !== "ask" && modeMeta ? <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5"><modeMeta.icon size={11} aria-hidden="true" /> {modeMeta.label}</span> : null}
            {turn.attachments?.map((a) => <span key={a.name} className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-[var(--line)] px-2 py-0.5"><FileText size={11} aria-hidden="true" /><span className="truncate">{a.name}</span></span>)}
          </div>
        ) : null}
      </div>

      {/* the answer */}
      <div className="space-y-4">
        <WorkingSteps
          steps={turn.steps}
          stage={turn.stage}
          working={working}
          streaming={writing}
          startedAt={turn.startedAt}
          totalMs={totalMs}
          open={stepsOpen}
          onToggle={() => setStepsOpen((v) => !v)}
        />

        {turn.error && !answer && !turn.draft ? (
          <div role="alert" className="sx-fade flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--sev-critical)]/35 bg-[var(--sev-critical-soft)] px-4 py-3 text-[14.5px] text-[var(--ink-2)]">
            <span className="flex-1">{turn.error}</span>
            <button type="button" onClick={() => onRegenerate(turn)} disabled={busy} className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[13.5px] font-medium text-[var(--accent-strong)] hover:bg-[var(--surface)] disabled:opacity-50">
              <RotateCcw size={14} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : null}

        {shown ? <Prose text={shown} citations={citations} streaming={writing} fade={Boolean(turn.live) && writing} /> : null}

        {turn.streaming && turn.draft && turn.stage && !/^Writing/i.test(turn.stage) ? (
          <p className="sx-fade flex items-center gap-2 text-[13px]" aria-hidden="true">
            <span className="sx-dot" />
            <span className="sx-shimmer">{turn.stage}</span>
          </p>
        ) : null}

        {turn.stopped ? (
          <p className="sx-fade flex items-center gap-2 text-[13.5px] text-[var(--muted)]">
            Stopped{turn.draft ? " — the answer above is incomplete" : ""}.
            <button type="button" onClick={() => onRegenerate(turn)} disabled={busy} className="font-medium text-[var(--accent-strong)] hover:underline disabled:opacity-50">Ask again</button>
          </p>
        ) : null}

        {!writing && answer?.options?.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {answer.options.map((o, i) => (
              <button
                key={i}
                type="button"
                disabled={busy}
                onClick={() => onAsk(o.action || o.label)}
                style={{ animationDelay: `${i * 60}ms` }}
                className="sx-rise group flex items-start gap-3 rounded-[14px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-left transition-all hover:border-[var(--accent)]/60 hover:shadow-[var(--shadow-2)] disabled:opacity-50"
              >
                <CornerDownRight size={15} className="mt-0.5 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)]" aria-hidden="true" />
                <span>
                  <span className="block text-[14.5px] font-medium text-[var(--ink)]">{o.label}</span>
                  {o.hint ? <span className="block text-[12.5px] text-[var(--muted)]">{o.hint}</span> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {!writing && uniqueTables(answer?.tables ?? []).slice(0, 2).map((t, i) => <MiniTable key={`${t.id}-${i}`} table={t} sources={sources} />)}

        {cards.map((card) => <ActionCard key={card.id} card={card} sources={sources} onResult={onActionResult} />)}

        {answer && !writing && (
          <div className="sx-fade space-y-3">
            {evidenceRefs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
                <span>Sources</span>
                {evidenceRefs.filter((r, i, a) => a.indexOf(r) === i && numbered.get(r)).sort((x, y) => (numbered.get(x) ?? 0) - (numbered.get(y) ?? 0)).map((r) => {
                  const c = citations.find((x) => x.ref === r) ?? sources.find((x) => x.ref === r);
                  return (
                    <button key={r} type="button" onClick={() => onOpenSources(turn)} title={c?.label} className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-[6px] bg-[var(--surface-2)] px-1 text-[11px] font-semibold text-[var(--ink-2)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]">
                      {numbered.get(r)}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="-ml-1.5 flex flex-wrap items-center gap-x-1 gap-y-1">
              <ToolButton label={copied ? "Copied" : "Copy answer"} onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}</ToolButton>
              <ToolButton label="Regenerate" onClick={() => onRegenerate(turn)} disabled={busy}><RefreshCw size={15} /></ToolButton>
              <ToolButton label="Good answer" pressed={rating === "up"} onClick={() => rate("up")} className={rating === "up" ? "text-[var(--confirmed)]" : undefined}><ThumbsUp size={15} /></ToolButton>
              <ToolButton label="Bad answer" pressed={rating === "down"} onClick={() => rate("down")} className={rating === "down" ? "text-[var(--sev-high)]" : undefined}><ThumbsDown size={15} /></ToolButton>
              {turn.steps.length > 0 && (
                <button type="button" onClick={() => setStepsOpen((v) => !v)} aria-expanded={stepsOpen} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
                  <ListChecks size={14} aria-hidden="true" /> {stepsOpen ? "Hide steps" : "Show steps"}
                </button>
              )}
              {sourceCount > 0 && (
                <button type="button" onClick={() => onOpenSources(turn)} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
                  <BookOpen size={14} aria-hidden="true" /> {sourceCount} source{sourceCount === 1 ? "" : "s"}
                </button>
              )}
              <span className="ml-auto flex items-center gap-3 pl-2 text-[12.5px] text-[var(--muted)]">
                {g && g.claims > 0 ? (
                  <span className={cn("inline-flex items-center gap-1", g.rate === 1 ? "text-[var(--confirmed)]" : "text-[var(--possible)]")} title="Every figure is checked against the records the tools returned">
                    {g.rate === 1 ? <ShieldCheck size={14} aria-hidden="true" /> : <ShieldAlert size={14} aria-hidden="true" />}
                    {g.rate === 1 ? `All ${g.claims} figures verified` : `${g.grounded} of ${g.claims} figures verified`}
                  </span>
                ) : null}
                <span className="hidden items-center gap-1 sm:inline-flex" title={agent ? `Planned and written by ${answer.llm?.model ?? "the AI model"}; figures from your records` : "Answered directly from your records (no AI writing)"}>
                  {agent ? <Sparkles size={13} aria-hidden="true" /> : <Database size={13} aria-hidden="true" />}
                  {agent ? "AI answer" : "From your records"}
                </span>
              </span>
            </div>

            {askReason && (
              <div className="sx-fade flex flex-wrap items-center gap-1.5">
                {reasonSent ? (
                  <span className="text-[13px] text-[var(--muted)]">Thanks — that helps.</span>
                ) : (
                  <>
                    <span className="text-[13px] text-[var(--muted)]">What went wrong?</span>
                    {DOWN_REASONS.map((r) => (
                      <button key={r} type="button" onClick={() => sendReason(r)} className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[12.5px] text-[var(--ink-2)] hover:border-[var(--accent)]/60 hover:text-[var(--ink)]">{r}</button>
                    ))}
                  </>
                )}
              </div>
            )}

            {latest && followUps.length > 0 && (
              <div className="flex flex-col gap-1.5 pt-1 sm:flex-row sm:flex-wrap">
                {followUps.slice(0, 3).map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    disabled={busy}
                    onClick={() => onAsk(f)}
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                    className="sx-rise inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 py-2 text-left text-[13.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--accent-strong)] disabled:opacity-50"
                  >
                    <CornerDownRight size={13} className="shrink-0 opacity-60" aria-hidden="true" /> {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
