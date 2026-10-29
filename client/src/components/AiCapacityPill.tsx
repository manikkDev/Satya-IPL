"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
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

const POLL_MS = 60_000;
const LOW_SHARE = 0.15;

function PillBody({ usage, isAdmin }: { usage: AiUsage; isAdmin: boolean }) {
  const remaining = remainingRequestsToday(usage);
  const share = capacityFraction(usage);
  const reset = formatResetIst(usage.resetsAt);
  const exhausted = usage.mode === "evidence_only" || remaining === 0;
  const low = !exhausted && share !== null && share < LOW_SHARE;

  const label = exhausted
    ? `AI capacity used up · evidence-only answers · resets ${reset}`
    : remaining === null
      ? `AI capacity available · resets ${reset}`
      : `AI capacity ≈ ${remaining.toLocaleString("en-IN")} requests left today · resets ${reset}`;

  return (
    <Tooltip>
      <TooltipTrigger className="satya-ai-pill" data-tone={exhausted ? "empty" : low ? "low" : "ok"} aria-label={label}>
        <span className="satya-ai-pill-text">{label}</span>
        {share !== null && !exhausted && (
          <span className="satya-ai-pill-track" aria-hidden="true">
            <span className="satya-ai-pill-fill" style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="satya-ai-pill-tip">
        <p className="satya-ai-pill-tip-title">AI capacity (estimate)</p>
        {usage.models.map((model) => (
          <p key={`${model.model}-${model.task}`}>
            {model.model} · {model.task}:{" "}
            {model.remainingToday === null
              ? "unmetered"
              : `${model.remainingToday.toLocaleString("en-IN")}${model.limitToday === null ? "" : ` of ${model.limitToday.toLocaleString("en-IN")}`} left`}
          </p>
        ))}
        {isAdmin && (
          <p>
            Active key: {usage.currentKeyAlias ?? "—"} · {usage.keys.active} of {usage.keys.total} available
          </p>
        )}
        <p className="satya-ai-pill-tip-note">
          Estimates from free-tier limits; Satya switches keys automatically and falls back to evidence-only answers if
          needed.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Small muted indicator of remaining AI capacity. Renders nothing when the
 *  feature flag is off or the gateway usage endpoint is unavailable. */
export function AiCapacityPill() {
  const enabled = useFeatureFlag("AI_USAGE_METER");
  const { user } = useAuth();
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = async () => {
      const data = await fetchAiUsage();
      if (!live) return;
      setUnavailable(data === null);
      if (data) setUsage(data);
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

  if (!enabled || unavailable || !usage) return null;
  return <PillBody usage={usage} isAdmin={user?.role === "admin"} />;
}
