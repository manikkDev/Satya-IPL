"use client";

// Satya v2 primitives (docs/plan/06 §2–§3). Certainty and severity are always
// icon + word + colour — never colour alone. Money renders formatted decimal
// strings only.

import { CheckCircle2, CircleDot, Circle, CircleHelp, CircleDashed, OctagonAlert, TriangleAlert, CircleAlert, Info, Check, MessageCircleQuestion, CircleArrowUp, PauseCircle, Inbox, RotateCcw, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty, formatDate, formatDateTimeIst, type Money as MoneyValue } from "@/lib/format";
import { CERTAINTY_LABEL, ACTION_LABEL, TERM_TIPS, STATUS_LABEL, type Certainty, type Action } from "@/content/copy/vocabulary";

/* ---------- money & dates ---------- */

export function Money({ value, currency, className }: { value: string | MoneyValue | null | undefined; currency?: string; className?: string }) {
  return <span className={cn("tnum", className)}>{formatMoney(value, currency)}</span>;
}

export function Qty({ value, uom, className }: { value: string | null | undefined; uom?: string; className?: string }) {
  return <span className={cn("tnum", className)}>{formatQty(value)}{uom ? ` ${uom}` : ""}</span>;
}

export function DateText({ value, withTime, className }: { value: string | null | undefined; withTime?: boolean; className?: string }) {
  return <span className={cn("tnum", className)}>{withTime ? formatDateTimeIst(value) : formatDate(value)}</span>;
}

/** Plain word + official term, with a ≤20-word explanation on hover/focus. */
export function Term({ of, children, className }: { of: keyof typeof TERM_TIPS; children?: React.ReactNode; className?: string }) {
  const term = TERM_TIPS[of];
  return (
    <Tooltip>
      <TooltipTrigger className={cn("underline decoration-dotted decoration-1 underline-offset-4 cursor-help text-inherit font-inherit p-0 bg-transparent border-0", className)}>
        {children ?? term.label}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60 text-xs leading-relaxed">{term.tip}</TooltipContent>
    </Tooltip>
  );
}

/* ---------- badges ---------- */

const CERTAINTY_STYLE: Record<Certainty, { icon: LucideIcon; color: string; bg: string }> = {
  CONFIRMED: { icon: CheckCircle2, color: "var(--confirmed)", bg: "var(--confirmed-soft)" },
  PROBABLE: { icon: CircleDot, color: "var(--likely)", bg: "var(--likely-soft)" },
  POSSIBLE: { icon: Circle, color: "var(--possible)", bg: "var(--possible-soft)" },
  AMBIGUOUS: { icon: CircleHelp, color: "var(--unclear)", bg: "var(--unclear-soft)" },
  INSUFFICIENT_EVIDENCE: { icon: CircleDashed, color: "var(--missing)", bg: "var(--missing-soft)" },
};

export function CertaintyBadge({ certainty, short }: { certainty: Certainty; short?: boolean }) {
  const style = CERTAINTY_STYLE[certainty] ?? CERTAINTY_STYLE.INSUFFICIENT_EVIDENCE;
  const Icon = style.icon;
  const label = short ? CERTAINTY_LABEL[certainty].split(" — ")[0] : CERTAINTY_LABEL[certainty];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: style.color, background: style.bg }}
    >
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

const SEVERITY_STYLE: Record<string, { icon: LucideIcon; color: string; bg: string; word: string }> = {
  critical: { icon: OctagonAlert, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)", word: "Critical" },
  high: { icon: TriangleAlert, color: "var(--sev-high)", bg: "var(--sev-high-soft)", word: "High" },
  medium: { icon: CircleAlert, color: "var(--sev-medium)", bg: "var(--sev-medium-soft)", word: "Medium" },
  low: { icon: Info, color: "var(--sev-low)", bg: "var(--sev-low-soft)", word: "Low" },
  info: { icon: Info, color: "var(--sev-info)", bg: "var(--sev-info-soft)", word: "Info" },
};

export function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info;
  const Icon = style.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color: style.color, background: style.bg }}
    >
      <Icon size={13} aria-hidden="true" />
      {style.word}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-[var(--surface-2)] text-[var(--ink-2)]">
      {STATUS_LABEL[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}

/* ---------- actions ---------- */

const ACTION_STYLE: Record<Action, { icon: LucideIcon; classes: string }> = {
  APPROVE: { icon: Check, classes: "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)]" },
  REQUEST_CLARIFICATION: { icon: MessageCircleQuestion, classes: "border border-[var(--accent)] text-[var(--accent-strong)] bg-transparent hover:bg-[var(--accent-soft)]" },
  ESCALATE: { icon: CircleArrowUp, classes: "border border-[var(--sev-high)] text-[var(--sev-high)] bg-transparent hover:bg-[var(--sev-high-soft)]" },
  PLACE_ON_HOLD: { icon: PauseCircle, classes: "border border-[var(--sev-critical)] text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]" },
};

export function ActionButton({
  action,
  amount,
  currency,
  disabled,
  disabledReason,
  onClick,
}: {
  action: Action;
  amount?: string | MoneyValue;
  currency?: string;
  disabled?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}) {
  const style = ACTION_STYLE[action];
  const Icon = style.icon;
  const label = `${ACTION_LABEL[action]}${amount !== undefined ? ` ${formatMoney(amount, currency)}` : ""}`;
  const button = (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        style.classes,
      )}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
      {label}
    </button>
  );
  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}>{button}</span></TooltipTrigger>
        <TooltipContent side="top" className="max-w-60 text-xs">{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }
  return button;
}

/* ---------- cards & states ---------- */

export function StatCard({
  label,
  tip,
  value,
  delta,
  seeWhy,
  onSeeWhy,
}: {
  label: string;
  tip?: string;
  value: React.ReactNode;
  delta?: string;
  seeWhy?: string;
  onSeeWhy?: () => void;
}) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
      <p className="text-sm text-[var(--muted)] flex items-center gap-1">
        {tip ? (
          <Tooltip>
            <TooltipTrigger className="underline decoration-dotted underline-offset-4 cursor-help">{label}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-60 text-xs">{tip}</TooltipContent>
          </Tooltip>
        ) : label}
      </p>
      <p className="mt-2 text-[28px] leading-8 font-semibold tnum text-[var(--ink)]">{value}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        {delta ? <span className="text-xs text-[var(--muted)]">{delta}</span> : <span />}
        {seeWhy ? (
          <button type="button" onClick={onSeeWhy} className="text-xs font-medium text-[var(--accent)] hover:underline">
            {seeWhy}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function EmptyState({ title, body, actionLabel, onAction }: { title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] p-10 text-center">
      <Inbox size={28} className="mx-auto text-[var(--muted)]" aria-hidden="true" />
      <p className="mt-3 text-base font-medium text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-1 text-sm text-[var(--muted)] max-w-md mx-auto">{body}</p> : null}
      {actionLabel ? (
        <button type="button" onClick={onAction} className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-strong)]">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-[var(--radius-md)] border border-[var(--sev-critical)] bg-[var(--sev-critical-soft)] p-5">
      <p className="text-sm font-medium text-[var(--sev-critical)]">We couldn’t load this.</p>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--sev-critical)] px-3 py-1.5 text-sm font-medium text-[var(--sev-critical)]">
          <RotateCcw size={14} aria-hidden="true" /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-8 w-36" />
      <Skeleton className="mt-3 h-3 w-24" />
    </div>
  );
}
