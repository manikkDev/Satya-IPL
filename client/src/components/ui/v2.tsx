"use client";

// Satya v2 primitives. One type scale and one set of tokens for every page:
// page title 28px · section title 19px · body 16px · UI/table 15px ·
// labels 13–14px (never smaller). Certainty, severity and status are always
// icon + word + colour — never colour alone. Money renders exact decimal
// strings only (lib/format).

import Link from "next/link";
import {
  CheckCircle2, CircleDot, Circle, CircleHelp, CircleDashed, OctagonAlert, TriangleAlert, CircleAlert, Info, Check,
  MessageCircleQuestion, CircleArrowUp, PauseCircle, Inbox, RotateCcw, ArrowRight, type LucideIcon,
} from "lucide-react";
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

/** Plain word + official term, with a short explanation on hover/focus.
 *  Renders a focusable <span> (never a button) so it is valid inside
 *  buttons, tab triggers and table cells. */
export function Term({ of, children, className }: { of: keyof typeof TERM_TIPS; children?: React.ReactNode; className?: string }) {
  const term = TERM_TIPS[of];
  if (!term) return <span className={className}>{children ?? String(of)}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn("cursor-help text-inherit underline decoration-[var(--muted)]/60 decoration-dotted decoration-1 underline-offset-[5px] font-inherit", className)}
        >
          {children ?? term.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">{term.tip}</TooltipContent>
    </Tooltip>
  );
}

/** Small (i) next to a label that explains it in plain words. */
export function InfoTip({ children, label = "What does this mean?", className }: { children: React.ReactNode; label?: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={label}
          className={cn("inline-grid h-[18px] w-[18px] shrink-0 cursor-help place-items-center rounded-full text-[var(--muted)] transition-colors hover:text-[var(--ink)]", className)}
        >
          <Info size={15} aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}

/* ---------- buttons ---------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

export const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_1px_0_rgb(0_0_0/0.10)] hover:bg-[var(--accent-strong)] dark:hover:bg-[var(--accent-strong)]",
  secondary:
    "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line-strong)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-2)]",
  outline:
    "border border-[var(--accent)]/50 text-[var(--accent-strong)] dark:text-[var(--accent)] bg-transparent hover:bg-[var(--accent-soft)]",
  ghost:
    "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  danger:
    "border border-[var(--sev-critical)]/50 text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]",
};

export const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] disabled:pointer-events-none disabled:opacity-50";

export const BTN_SIZES = {
  sm: "h-9 px-3 text-[14px]",
  md: "h-10 px-4 text-[15px]",
  lg: "h-12 px-5 text-base",
} as const;

export function Btn({
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
}) {
  return (
    <button type="button" className={cn(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className)} {...props}>
      {Icon ? <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A Next <Link> that looks like <Btn>. */
export function BtnLink({
  href,
  variant = "primary",
  size = "md",
  icon: Icon,
  className,
  children,
}: {
  href: string;
  variant?: BtnVariant;
  size?: "sm" | "md" | "lg";
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(BTN_BASE, BTN_SIZES[size], BTN_VARIANTS[variant], className)}>
      {Icon ? <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}

/* ---------- forms ---------- */

export const inputClass =
  "block h-11 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 text-[15px] text-[var(--ink)] shadow-[var(--shadow-1)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-glow)] disabled:opacity-60 aria-[invalid=true]:border-[var(--sev-critical)]";

export function FieldLabel({ htmlFor, children, hint, optional }: { htmlFor: string; children: React.ReactNode; hint?: React.ReactNode; optional?: boolean }) {
  return (
    <div className="mb-1.5">
      <label htmlFor={htmlFor} className="text-[14px] font-medium text-[var(--ink)]">
        {children}
        {optional ? <span className="ml-1.5 font-normal text-[var(--muted)]">(optional)</span> : null}
      </label>
      {hint ? <p className="mt-0.5 text-[13px] leading-snug text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

/* ---------- layout & motion ---------- */

/** Consistent page head: optional eyebrow, a 28px title, one plain-English
 *  line saying what the page is for, and the page's actions (one primary). */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <p className="type-eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="type-page-title">{title}</h1>
        {description ? <p className="mt-2 text-base leading-relaxed text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section head inside a page: 19px title + optional one-liner + action. */
export function SectionHeader({ title, description, action, id }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="type-section-title">{title}</h2>
        {description ? <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Subtle rise-in on mount — CSS-driven so it never sticks half-faded. */
export function FadeIn({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cn("rise", className)} style={delay ? { animationDelay: `${Math.round(delay * 1000)}ms` } : undefined}>
      {children}
    </div>
  );
}

/** Staggered entrance for grids/lists of cards. */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rise-stagger", className)}>{children}</div>;
}
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

/** Long-page section wrapper (kept for API compatibility; renders immediately). */
export function Reveal({ children, className }: { children: React.ReactNode; className?: string; delay?: number }) {
  return <div className={cn("rise", className)}>{children}</div>;
}

/* ---------- cards ---------- */

export function Card({
  children,
  className,
  pad = true,
  hover = false,
  glow: _glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  hover?: boolean;
  /** Deprecated: kept for compatibility, renders flat. */
  glow?: boolean;
}) {
  void _glow;
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]",
        hover && "card-hover",
        pad && "p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  hint,
  icon: Icon,
  description,
  action,
}: {
  children: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ink)]">
          {Icon ? <Icon size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" /> : null}
          {children}
        </h2>
        {action ?? (hint ? <span className="shrink-0 text-[13px] text-[var(--muted)]">{hint}</span> : null)}
      </div>
      {description ? <p className="mt-1 text-[14px] leading-relaxed text-[var(--muted)]">{description}</p> : null}
    </div>
  );
}

/* ---------- callouts ---------- */

const CALLOUT_TONE = {
  info: { icon: Info, color: "var(--likely)", bg: "var(--likely-soft)" },
  warn: { icon: TriangleAlert, color: "var(--sev-medium)", bg: "var(--sev-medium-soft)" },
  danger: { icon: OctagonAlert, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)" },
  success: { icon: CheckCircle2, color: "var(--confirmed)", bg: "var(--confirmed-soft)" },
} as const;

/** A short boxed message with icon + title. */
export function Callout({ tone = "info", title, children, action, className }: { tone?: keyof typeof CALLOUT_TONE; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const t = CALLOUT_TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3.5", className)}
      style={{ background: t.bg, borderColor: `color-mix(in srgb, ${t.color} 28%, transparent)` }}
    >
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color: t.color }} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-[var(--ink-2)]">
        {title ? <p className="font-semibold text-[var(--ink)]">{title}</p> : null}
        {children}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ---------- badges ---------- */

const BADGE = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium leading-none";

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
  const full = CERTAINTY_LABEL[certainty] ?? CERTAINTY_LABEL.INSUFFICIENT_EVIDENCE;
  const label = short ? full.split(" — ")[0] : full;
  return (
    <span className={BADGE} style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 30%, transparent)` }}>
      <Icon size={14} aria-hidden="true" />
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
    <span className={BADGE} style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 30%, transparent)` }}>
      <Icon size={14} aria-hidden="true" />
      {style.word}
    </span>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const TONE_STYLE: Record<Tone, { icon: LucideIcon; color: string; bg: string }> = {
  neutral: { icon: Circle, color: "var(--ink-2)", bg: "var(--surface-2)" },
  good: { icon: CheckCircle2, color: "var(--confirmed)", bg: "var(--confirmed-soft)" },
  warn: { icon: CircleAlert, color: "var(--sev-medium)", bg: "var(--sev-medium-soft)" },
  bad: { icon: OctagonAlert, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)" },
  info: { icon: Info, color: "var(--likely)", bg: "var(--likely-soft)" },
};

/** Generic status pill: always icon + word. */
export function ToneBadge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode }) {
  const style = TONE_STYLE[tone];
  const Icon = icon ?? style.icon;
  return (
    <span className={BADGE} style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 26%, transparent)` }}>
      <Icon size={14} aria-hidden="true" />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral", pending_approval: "warn", approved: "good", issued: "info", acknowledged: "info",
  partially_fulfilled: "warn", fulfilled: "good", short_closed: "neutral", cancelled: "neutral",
  posted: "info", reversed: "neutral", confirmed: "good", rejected: "bad",
  open: "warn", in_review: "info", resolved: "good", escalated: "bad", on_hold: "bad",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "neutral";
  const style = TONE_STYLE[tone];
  return (
    <span className={cn(BADGE, "border-[var(--line)] bg-[var(--surface-2)] text-[var(--ink-2)]")}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: style.color }} aria-hidden="true" />
      {STATUS_LABEL[status] ?? status.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

/** Filter chip used for segmented choices. */
export function Chip({ active, children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors",
        active
          ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
          : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- actions ---------- */

const ACTION_STYLE: Record<Action, { icon: LucideIcon; classes: string }> = {
  APPROVE: { icon: Check, classes: "bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-strong)] shadow-[0_1px_0_rgb(0_0_0/0.15)]" },
  REQUEST_CLARIFICATION: { icon: MessageCircleQuestion, classes: "border border-[var(--accent)]/50 text-[var(--accent-strong)] dark:text-[var(--accent)] bg-transparent hover:bg-[var(--accent-soft)]" },
  ESCALATE: { icon: CircleArrowUp, classes: "border border-[var(--sev-high)]/50 text-[var(--sev-high)] bg-transparent hover:bg-[var(--sev-high-soft)]" },
  PLACE_ON_HOLD: { icon: PauseCircle, classes: "border border-[var(--sev-critical)]/50 text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]" },
  REVIEW: { icon: CircleAlert, classes: "border border-[var(--sev-medium)]/50 text-[var(--sev-medium)] bg-transparent hover:bg-[var(--sev-medium-soft)]" },
  REJECT: { icon: OctagonAlert, classes: "border border-[var(--sev-critical)]/50 text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]" },
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
  const style = ACTION_STYLE[action] ?? { icon: Info, classes: "border border-[var(--line)] text-[var(--ink-2)] bg-transparent hover:bg-[var(--surface-2)]" };
  const Icon = style.icon;
  const label = `${ACTION_LABEL[action] ?? String(action ?? "Decide").replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}${amount !== undefined ? ` ${formatMoney(amount, currency)}` : ""}`;
  const button = (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] px-4 text-[15px] font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        style.classes,
      )}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
    >
      <Icon size={17} aria-hidden="true" />
      {label}
    </button>
  );
  if (disabled && disabledReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}>{button}</span></TooltipTrigger>
        <TooltipContent side="top" className="max-w-64">{disabledReason}</TooltipContent>
      </Tooltip>
    );
  }
  return button;
}

/* ---------- stat card ---------- */

/** Tiny inline sparkline (display only; values are pre-computed y-coords 0..1). */
export function Sparkline({ points, className, color = "var(--accent)" }: { points: number[]; className?: string; color?: string }) {
  if (points.length < 2) return null;
  const width = 72;
  const height = 22;
  const step = width / (points.length - 1);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - p * (height - 2) - 1).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-[22px] w-[72px] overflow-visible", className)} aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
      <circle cx={(points.length - 1) * step} cy={height - points[points.length - 1] * (height - 2) - 1} r="2.4" fill={color} />
    </svg>
  );
}

/** A key number with a plain explanation underneath. */
export function StatCard({
  label,
  tip,
  value,
  delta,
  seeWhy,
  onSeeWhy,
  spark,
  tone,
}: {
  label: string;
  tip?: string;
  value: React.ReactNode;
  /** One plain line under the number, e.g. what it includes. */
  delta?: string;
  seeWhy?: string;
  onSeeWhy?: () => void;
  /** Normalised sparkline points 0..1 (display only). */
  spark?: number[];
  tone?: "default" | "warn" | "good";
}) {
  const accent = tone === "warn" ? "var(--sev-high)" : tone === "good" ? "var(--confirmed)" : "var(--accent)";
  return (
    <article className="flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--ink-2)]">
          {label}
          {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
        </p>
        {spark ? <Sparkline points={spark} color={accent} /> : null}
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-[var(--ink)] tnum">{value}</p>
      {delta ? <p className="mt-1.5 text-[14px] leading-snug text-[var(--muted)]">{delta}</p> : null}
      {seeWhy ? (
        <button
          type="button"
          onClick={onSeeWhy}
          className="mt-auto inline-flex w-fit items-center gap-1 pt-3 text-[14px] font-medium text-[var(--accent-strong)] transition-colors hover:underline dark:text-[var(--accent)]"
        >
          {seeWhy} <ArrowRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </article>
  );
}

/* ---------- progress ---------- */

export function Progress({
  value,
  tone = "var(--accent)",
  className,
  label,
}: {
  value: number; // 0..100
  tone?: string;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]", className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="bar-anim h-full rounded-full" style={{ width: `${clamped}%`, background: tone }} />
    </div>
  );
}

/* ---------- states ---------- */

/** Empty states teach: what this place is for and the one thing to do next. */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  actionHref,
  secondaryLabel,
  secondaryHref,
  icon: Icon = Inbox,
}: {
  title: string;
  body?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-2)]">
        <Icon size={22} className="text-[var(--ink-2)]" aria-hidden="true" />
      </div>
      <p className="mt-4 text-[17px] font-semibold text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-1.5 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">{body}</p> : null}
      {actionLabel || secondaryLabel ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && actionHref ? <BtnLink href={actionHref}>{actionLabel}</BtnLink> : null}
          {actionLabel && !actionHref ? <Btn onClick={onAction}>{actionLabel}</Btn> : null}
          {secondaryLabel && secondaryHref ? <BtnLink href={secondaryHref} variant="secondary">{secondaryLabel}</BtnLink> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sev-critical)_35%,transparent)] bg-[var(--sev-critical-soft)] px-5 py-4">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-[var(--sev-critical)]">
        <OctagonAlert size={17} aria-hidden="true" /> We couldn’t load this.
      </p>
      <p className="mt-1 text-[15px] text-[var(--ink-2)]">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sev-critical)_50%,transparent)] px-3 text-[14px] font-medium text-[var(--sev-critical)] transition-colors hover:bg-[var(--surface)]">
          <RotateCcw size={15} aria-hidden="true" /> Try again
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
      <Skeleton className="mt-3 h-4 w-40" />
    </div>
  );
}

/** Keyboard key hint. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-[var(--line-strong)] bg-[var(--surface-2)] px-1.5 py-px font-code text-[13px] text-[var(--ink-2)]">{children}</kbd>;
}

/* ---------- table chrome ---------- */

export const tableShell =
  "overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]";
export const tableHeadRow = "border-b border-[var(--line)] bg-[var(--surface-2)]";
export const tableTh =
  "px-4 py-3 text-left text-[13px] font-semibold text-[var(--muted)]";
export const tableTd = "px-4 py-3.5 text-[15px] text-[var(--ink-2)]";
export const tableRow =
  "border-b border-[var(--line)] last:border-0 transition-colors hover:bg-[var(--surface-2)]/60";
