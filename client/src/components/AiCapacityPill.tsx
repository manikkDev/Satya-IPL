"use client";

// AI status, said plainly (UI_SPEC §5). The top bar shows an "Ask Satya"
// button with a tiny status dot — green when AI answers are on, amber when
// capacity is limited or Satya is answering in evidence-only mode. Details
// live only in the tooltip, in words; never quota bars or raw numbers.
//
// Exports:
//   useAiStatus()     — { state, headline, detail } for any surface
//   AskSatyaButton    — top-bar entry point to the assistant (/app/ask)
//   AiCapacityPill    — compact dot + words, kept for the assistant page

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useFeatureFlag } from "@/lib/flags";
import {
  fetchAiUsage,
  subscribeAiUsage,
  remainingRequestsToday,
  capacityFraction,
  formatResetIst,
  type AiUsage,
} from "@/lib/ai-usage";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const POLL_MS = 60_000;
const LOW_SHARE = 0.15;

export type AiState = "on" | "limited" | "evidence" | "unknown";

export type AiStatus = {
  state: AiState;
  /** Two-to-four words for inline use: "AI answers on". */
  label: string;
  /** One plain sentence for the tooltip. */
  headline: string;
  /** Optional second line (when it resets). */
  detail?: string;
};

export function describeAiUsage(usage: AiUsage | null): AiStatus {
  if (!usage) {
    return { state: "unknown", label: "Ask Satya", headline: "Ask about your payables in plain words — every answer cites your documents." };
  }
  const remaining = remainingRequestsToday(usage);
  const share = capacityFraction(usage);
  const reset = formatResetIst(usage.resetsAt);
  if (usage.mode === "evidence_only" || remaining === 0) {
    return {
      state: "evidence",
      label: "Evidence-only mode",
      headline: "Running in evidence-only mode — answers come straight from your records.",
      detail: `Full AI answers return at ${reset}.`,
    };
  }
  if (share !== null && share < LOW_SHARE) {
    return { state: "limited", label: "AI answers limited", headline: "AI answers are limited for the rest of today.", detail: `Capacity resets at ${reset}.` };
  }
  return { state: "on", label: "AI answers on", headline: "AI answers available.", detail: `Daily capacity resets at ${reset}.` };
}

/** Live AI status (polls gently, and listens to fresher numbers pushed by the
 *  assistant stream). `unknown` when the meter flag is off or unreachable. */
export function useAiStatus(): AiStatus {
  const enabled = useFeatureFlag("AI_USAGE_METER");
  const [usage, setUsage] = useState<AiUsage | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const data = await fetchAiUsage();
      if (live && data) setUsage(data);
    };
    load();
    const timer = setInterval(load, POLL_MS);
    const unsubscribe = subscribeAiUsage(setUsage);
    return () => {
      live = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [enabled]);

  return describeAiUsage(enabled ? usage : null);
}

function StatusDot({ state, className }: { state: AiState; className?: string }) {
  if (state === "unknown") return null;
  return <span className={cn("satya-status-dot inline-block", className)} data-state={state === "on" ? "on" : "limited"} aria-hidden="true" />;
}

function TipBody({ status }: { status: AiStatus }) {
  return (
    <div className="satya-ai-pill-tip">
      <p className="satya-ai-pill-tip-title">{status.headline}</p>
      {status.detail ? <p className="satya-ai-pill-tip-note">{status.detail}</p> : null}
    </div>
  );
}

/** Top-bar entry to the assistant: "Ask Satya" + a tiny status dot.
 *  Icon-only below 640px (still labelled for screen readers). */
export function AskSatyaButton({ className }: { className?: string }) {
  const status = useAiStatus();
  const srState = status.state === "unknown" ? "" : ` (${status.label})`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/app/ask"
          aria-label={`Ask Satya${srState}`}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-[15px] font-medium text-[var(--ink)] shadow-[var(--shadow-1)] transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 sm:px-3.5",
            className,
          )}
        >
          <span className="relative grid place-items-center">
            <MessageCircle size={18} className="text-[var(--accent-strong)] dark:text-[var(--accent)]" aria-hidden="true" />
            <StatusDot state={status.state} className="absolute -right-0.5 -top-0.5" />
          </span>
          <span className="hidden sm:inline">Ask Satya</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <TipBody status={status} />
      </TooltipContent>
    </Tooltip>
  );
}

/** Compact status: dot + a few words, details in the tooltip. Renders
 *  nothing when the meter is off or unreachable. */
export function AiCapacityPill() {
  const status = useAiStatus();
  if (status.state === "unknown") return null;
  return (
    <Tooltip>
      <TooltipTrigger className="satya-ai-pill" aria-label={`${status.headline} ${status.detail ?? ""}`.trim()}>
        <StatusDot state={status.state} />
        <span className="satya-ai-pill-text">{status.label}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        <TipBody status={status} />
      </TooltipContent>
    </Tooltip>
  );
}
