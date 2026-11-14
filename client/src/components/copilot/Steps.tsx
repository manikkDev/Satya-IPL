"use client";

// The agent's visible work: a calm "Working…" row with the current step,
// an animated list of tool steps (label, ✓, duration), auto-collapsing to
// "Show N steps" once the answer starts arriving.

import { useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert, ListChecks } from "lucide-react";
import type { ToolStep } from "@/lib/api/copilot";
import { duration } from "./format";
import { cn } from "@/lib/utils";

export type LiveStep = ToolStep & { startedAt?: number };

function useElapsed(since: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  return since ? Math.max(0, now - since) : 0;
}

function StepIcon({ step }: { step: LiveStep }) {
  if (step.status === "start") {
    return <span className="sx-spin grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-[var(--accent)]/25 border-t-[var(--accent)]" aria-hidden="true" />;
  }
  if (step.ok === false) {
    return <span className="sx-pop grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--possible-soft)] text-[var(--possible)]" aria-hidden="true"><CircleAlert size={12} /></span>;
  }
  return <span className="sx-pop grid h-[18px] w-[18px] place-items-center rounded-full bg-[var(--confirmed-soft)] text-[var(--confirmed)]" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>;
}

function StepList({ steps, live }: { steps: LiveStep[]; live: boolean }) {
  return (
    <ol className="relative space-y-2 pl-1">
      <span className="absolute bottom-2 left-[9.5px] top-2 w-px bg-[var(--line)]" aria-hidden="true" />
      {steps.map((s) => (
        <li key={s.id} className="sx-rise relative flex items-start gap-3 text-[14px]">
          <span className="relative z-[1] mt-[1px] bg-[var(--paper)]"><StepIcon step={s} /></span>
          <span className="min-w-0 flex-1 leading-snug">
            <span className={cn("text-[var(--ink-2)]", s.status === "start" && live && "text-[var(--ink)]")}>{s.label || s.name.replaceAll("_", " ")}</span>
            {s.status === "done" && s.summary ? <span className="block truncate text-[12.5px] text-[var(--muted)]">{s.summary}</span> : null}
          </span>
          {s.status === "done" && s.ms != null ? <span className="tnum shrink-0 pt-px text-[12px] text-[var(--muted)]">{duration(s.ms)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * @param working   still working and no answer text yet
 * @param streaming the answer is being written
 */
export function WorkingSteps({ steps, stage, working, streaming, startedAt, totalMs, open: openProp, onToggle }: {
  steps: LiveStep[];
  stage?: string;
  working: boolean;
  streaming: boolean;
  startedAt?: number;
  totalMs?: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (fn: (v: boolean) => boolean) => (onToggle ? onToggle() : setOpenState(fn));
  const elapsed = useElapsed(startedAt, working || streaming);
  const done = steps.filter((s) => s.status === "done");

  if (working) {
    return (
      <div className="space-y-3" role="status" aria-label="Satya is working">
        <div className="flex items-center gap-2.5 text-[14.5px]">
          <span className="flex items-center gap-1" aria-hidden="true"><span className="sx-dot" /><span className="sx-dot" /><span className="sx-dot" /></span>
          <span className="sx-shimmer font-medium">{stage || "Working…"}</span>
          {elapsed > 1500 ? <span className="tnum text-[12px] text-[var(--muted)]">{duration(elapsed)}</span> : null}
        </div>
        {steps.length > 0 && <StepList steps={steps} live />}
      </div>
    );
  }
  if (!steps.length) return null;
  const total = totalMs ?? done.reduce((s, x) => s + (x.ms ?? 0), 0);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group inline-flex items-center gap-1.5 rounded-[8px] px-1.5 py-1 -ml-1.5 text-[13px] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
      >
        <ListChecks size={14} aria-hidden="true" />
        {open ? "Hide" : "Show"} {done.length} step{done.length === 1 ? "" : "s"}
        {total ? <span className="tnum">· {duration(total)}</span> : null}
        <ChevronRight size={13} className={cn("transition-transform duration-200", open && "rotate-90")} aria-hidden="true" />
      </button>
      {open && <div className="sx-fade mb-2 mt-2"><StepList steps={steps} live={false} /></div>}
    </div>
  );
}
