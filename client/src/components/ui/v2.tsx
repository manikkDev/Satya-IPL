"use client";

// Satya v2 primitives. One type scale and one set of tokens for every page:
// page title 28px · section title 19px · body 16px · UI/table 15px ·
// labels 13–14px (never smaller). Certainty, severity and status are always
// icon + word + colour — never colour alone. Money renders exact decimal
// strings only (lib/format).
//
// Binding spec: docs/design/UI_SPEC.md. The page kit (§3) lives here:
//   PageHeader · SectionHeader · TextLink · Card · StatCard (alias KpiCard) ·
//   StatusChip · Money · DateText · RelativeDue · ResponsiveTable (+ Column) ·
//   RowActions · FilterChips · InfoPanel · EmptyState · TableSkeleton /
//   ListSkeleton / CardGridSkeleton / StatCardSkeleton. Use these instead of
//   page-local variants so every list aligns the same way.

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import {
  CheckCircle2, CircleDot, Circle, CircleHelp, CircleDashed, OctagonAlert, TriangleAlert, CircleAlert, Info, Check,
  MessageCircleQuestion, CircleArrowUp, PauseCircle, Inbox, RotateCcw, ArrowRight, ChevronDown, MoreHorizontal,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatMoney, formatQty, formatDate, formatDateTimeIst, daysFromTodayIst, type Money as MoneyValue } from "@/lib/format";
import { relativeDue, dueTone } from "@/lib/humanize";
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

/** Section head inside a page: 19px title + optional one-liner + a right-hand
 *  action or a quiet "View all →" style `link`. */
export function SectionHeader({
  title,
  description,
  action,
  link,
  id,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** Quiet text link on the right, e.g. { href: "/app/audit", label: "Activity log" }. */
  link?: { href: string; label: string };
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className="type-section-title">{title}</h2>
        {description ? <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
      {!action && link ? <TextLink href={link.href} className="shrink-0">{link.label}</TextLink> : null}
    </div>
  );
}

/** Quiet accent text link with a trailing arrow ("View all →"). */
export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] text-[15px] font-medium text-[var(--accent-strong)] transition-colors hover:underline hover:underline-offset-4 dark:text-[var(--accent)]",
        className,
      )}
    >
      {children} <ArrowRight size={15} aria-hidden="true" />
    </Link>
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

/** Surface for a group of related content: 1px line, 12px radius, 24px padding
 *  (20px on phones). `as="section"` + `aria-labelledby` for landmark sections. */
export function Card({
  children,
  className,
  pad = true,
  hover = false,
  glow: _glow = false,
  as: Tag = "div",
  id,
  "aria-labelledby": labelledBy,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  hover?: boolean;
  /** Deprecated: kept for compatibility, renders flat. */
  glow?: boolean;
  as?: "div" | "section" | "article" | "aside";
  id?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
}) {
  void _glow;
  return (
    <Tag
      id={id}
      aria-labelledby={labelledBy}
      aria-label={ariaLabel}
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]",
        hover && "card-hover",
        pad && "p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </Tag>
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
        "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
        active
          ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
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

/** KPI card: label (+ optional (i) tip), one big number, one short plain line,
 *  and an optional "See why" drill-down (button via `onSeeWhy`, or link via
 *  `seeWhyHref`). Keep KPI rows to 3–4 cards. Also exported as `KpiCard`. */
export function StatCard({
  label,
  tip,
  value,
  delta,
  seeWhy,
  onSeeWhy,
  seeWhyHref,
  spark,
  tone,
}: {
  label: string;
  tip?: string;
  value: React.ReactNode;
  /** One plain line under the number, e.g. what it includes. */
  delta?: React.ReactNode;
  seeWhy?: string;
  onSeeWhy?: () => void;
  seeWhyHref?: string;
  /** Normalised sparkline points 0..1 (display only). */
  spark?: number[];
  tone?: "default" | "warn" | "good" | "critical";
}) {
  const accent = tone === "warn" ? "var(--sev-high)" : tone === "critical" ? "var(--sev-critical)" : tone === "good" ? "var(--confirmed)" : "var(--accent)";
  return (
    <article className="flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--ink-2)]">
          {label}
          {tip ? <InfoTip label={`About ${label}`}>{tip}</InfoTip> : null}
        </p>
        {spark ? <Sparkline points={spark} color={accent} /> : null}
      </div>
      <p className="mt-2 text-[28px] font-semibold leading-9 tracking-[-0.02em] text-[var(--ink)] tnum">{value}</p>
      {delta ? <p className="mt-1.5 text-[14px] leading-snug text-[var(--muted)]">{delta}</p> : null}
      {seeWhy && seeWhyHref ? (
        <Link
          href={seeWhyHref}
          className="mt-auto inline-flex w-fit items-center gap-1 pt-3 text-[14px] font-medium text-[var(--accent-strong)] transition-colors hover:underline dark:text-[var(--accent)]"
        >
          {seeWhy} <ArrowRight size={14} aria-hidden="true" />
        </Link>
      ) : seeWhy ? (
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

/** Spec name for StatCard (UI_SPEC §3 "StatCard/KPI"). */
export const KpiCard = StatCard;

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
/** Empty states teach: icon, title, one line, and the one thing to do next.
 *  `compact` drops the dashed frame — use it inside a table or card. */
export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
  actionHref,
  secondaryLabel,
  secondaryHref,
  action,
  compact = false,
  tone = "neutral",
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  body?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  /** Any custom action node (rendered after the standard buttons). */
  action?: React.ReactNode;
  compact?: boolean;
  /** "ok" tints the icon green — for "all clear" states. */
  tone?: "neutral" | "ok";
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact
          ? "px-4 py-10"
          : "rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12",
        className,
      )}
    >
      <div className={cn("grid h-12 w-12 place-items-center rounded-full", tone === "ok" ? "bg-[var(--confirmed-soft)]" : "bg-[var(--surface-2)]")}>
        <Icon size={22} className={tone === "ok" ? "text-[var(--confirmed)]" : "text-[var(--ink-2)]"} aria-hidden="true" />
      </div>
      <p className="mt-4 text-[17px] font-semibold text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-1.5 max-w-lg text-[15px] leading-relaxed text-[var(--muted)]">{body}</p> : null}
      {actionLabel || secondaryLabel || action ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actionLabel && actionHref ? <BtnLink href={actionHref}>{actionLabel}</BtnLink> : null}
          {actionLabel && !actionHref ? <Btn onClick={onAction}>{actionLabel}</Btn> : null}
          {secondaryLabel && secondaryHref ? <BtnLink href={secondaryHref} variant="secondary">{secondaryLabel}</BtnLink> : null}
          {action}
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
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6" aria-hidden="true">
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
/** Rows are ≥ 56px tall (UI_SPEC §2). */
export const tableTd = "px-4 py-4 text-[15px] text-[var(--ink-2)] align-middle";
export const tableRow =
  "border-b border-[var(--line)] last:border-0 transition-colors hover:bg-[var(--surface-2)]";

/* =====================================================================
   Page kit (UI_SPEC §3): status, deadlines, tables, actions, filters,
   explanations and matching skeletons.
   ===================================================================== */

export type StatusTone = "critical" | "warn" | "ok" | "info" | "neutral";

const STATUS_CHIP: Record<StatusTone, { icon: LucideIcon; color: string; bg: string }> = {
  critical: { icon: OctagonAlert, color: "var(--sev-critical)", bg: "var(--sev-critical-soft)" },
  warn: { icon: CircleAlert, color: "var(--sev-medium)", bg: "var(--sev-medium-soft)" },
  ok: { icon: CheckCircle2, color: "var(--confirmed)", bg: "var(--confirmed-soft)" },
  info: { icon: Info, color: "var(--likely)", bg: "var(--likely-soft)" },
  neutral: { icon: Circle, color: "var(--ink-2)", bg: "var(--surface-2)" },
};

/** Status as a small chip: icon + word, never colour alone. Tones:
 *  critical (overdue / must act) · warn (soon / on hold) · ok (all clear) ·
 *  info · neutral. Pass `icon` to override (e.g. PauseCircle for "On hold"). */
export function StatusChip({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: StatusTone;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  /** Optional native tooltip with a longer explanation. */
  title?: string;
}) {
  const style = STATUS_CHIP[tone];
  const Icon = icon ?? style.icon;
  return (
    <span
      title={title}
      className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[13px] font-medium leading-none", className)}
      style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 24%, transparent)` }}
    >
      <Icon size={14} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Deadline in words + date: "3 days overdue · 12 Nov 2026". Red only when
 *  overdue, amber within 7 days, muted otherwise. Give `daysLeft` (preferred,
 *  from the server) or just `date` (days are then counted in IST). */
export function RelativeDue({
  daysLeft,
  date,
  showDate = true,
  layout = "stack",
  className,
}: {
  daysLeft?: number | null;
  date?: string | null;
  showDate?: boolean;
  /** "stack": words over date (tables) · "inline": "words · date". */
  layout?: "stack" | "inline";
  className?: string;
}) {
  const days = daysLeft ?? daysFromTodayIst(date ?? null);
  if (days === null || days === undefined) return <span className={cn("text-[var(--muted)]", className)}>—</span>;
  const tone = dueTone(days);
  const color = tone === "critical" ? "var(--sev-critical)" : tone === "warn" ? "var(--sev-medium)" : "var(--ink-2)";
  const words = relativeDue(days);
  const wordsCap = words.charAt(0).toUpperCase() + words.slice(1);
  if (layout === "inline") {
    return (
      <span className={cn("tnum", className)}>
        <span className="font-medium" style={{ color }}>{wordsCap}</span>
        {showDate && date ? <span className="text-[var(--muted)]"> · {formatDate(date)}</span> : null}
      </span>
    );
  }
  return (
    <span className={cn("tnum inline-flex flex-col leading-snug", className)}>
      <span className="font-medium" style={{ color }}>{wordsCap}</span>
      {showDate && date ? <span className="text-[13px] text-[var(--muted)]">{formatDate(date)}</span> : null}
    </span>
  );
}

/* ---------- row actions ---------- */

export type RowAction = {
  label: string;
  onSelect?: () => void;
  href?: string;
  icon?: LucideIcon;
  /** Destructive or irreversible — shown in red, after a separator. */
  danger?: boolean;
  disabled?: boolean;
};

const isRowAction = (x: unknown): x is RowAction =>
  !!x && typeof x === "object" && "label" in (x as object) && !("$$typeof" in (x as object));

/** One visible, contextual primary action + a "⋯" menu for the rest
 *  (UI_SPEC §2). `primary` may be a RowAction or any node. `label` names the
 *  row for screen readers ("More actions for INV-104"). */
export function RowActions({
  primary,
  items = [],
  label,
  className,
}: {
  primary?: RowAction | React.ReactNode;
  items?: RowAction[];
  label: string;
  className?: string;
}) {
  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  let primaryNode: React.ReactNode = null;
  if (isRowAction(primary)) {
    primaryNode = primary.href ? (
      <BtnLink href={primary.href} size="sm" variant="secondary" icon={primary.icon}>
        {primary.label}
      </BtnLink>
    ) : (
      <Btn size="sm" variant="secondary" icon={primary.icon} onClick={primary.onSelect} disabled={primary.disabled}>
        {primary.label}
      </Btn>
    );
  } else if (primary) {
    primaryNode = primary as React.ReactNode;
  }
  const renderItem = (item: RowAction) =>
    item.href ? (
      <DropdownMenuItem key={item.label} asChild disabled={item.disabled} className="min-h-10 cursor-pointer gap-2.5 px-3 text-[15px]">
        <Link href={item.href}>
          {item.icon ? <item.icon size={16} aria-hidden="true" /> : null}
          {item.label}
        </Link>
      </DropdownMenuItem>
    ) : (
      <DropdownMenuItem
        key={item.label}
        disabled={item.disabled}
        variant={item.danger ? "destructive" : "default"}
        onSelect={() => item.onSelect?.()}
        className="min-h-10 cursor-pointer gap-2.5 px-3 text-[15px]"
      >
        {item.icon ? <item.icon size={16} aria-hidden="true" /> : null}
        {item.label}
      </DropdownMenuItem>
    );
  return (
    <div className={cn("flex items-center justify-end gap-1.5", className)}>
      {primaryNode}
      {items.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More actions for ${label}`}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 data-[state=open]:bg-[var(--surface-2)]"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52 p-1.5">
            {safe.map(renderItem)}
            {danger.length && safe.length ? <DropdownMenuSeparator /> : null}
            {danger.map(renderItem)}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/* ---------- filters ---------- */

export type FilterOption<V extends string = string> = {
  value: V;
  label: string;
  count?: number;
  /** Tints the count when it matters (e.g. critical for "Overdue"). */
  tone?: StatusTone;
};

/** Segmented filter chips with counts: "Overdue 7 · Due in 7 days 1 · …".
 *  Zero-count options stay visible (counts teach the shape of the list). */
export function FilterChips<V extends string>({
  options,
  value,
  onChange,
  label = "Filter",
  className,
}: {
  options: FilterOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        const countColor = !active && o.count && o.tone === "critical" ? "var(--sev-critical)" : !active && o.count && o.tone === "warn" ? "var(--sev-medium)" : undefined;
        return (
          <Chip key={o.value} active={active} onClick={() => onChange(o.value)}>
            {o.label}
            {o.count !== undefined ? (
              <span className={cn("tnum text-[13px] font-semibold", active ? "" : "text-[var(--muted)]")} style={countColor ? { color: countColor } : undefined}>
                {o.count}
              </span>
            ) : null}
          </Chip>
        );
      })}
    </div>
  );
}

/* ---------- explanations ---------- */

const infoKey = (key: string) => `satya.info.${key}`;

/** Collapsible "How this check works" panel — explain a rule once, not on
 *  every row. Open on the first visit, then remembers the reader's choice
 *  (localStorage, guarded: private mode just falls back to open). */
export function InfoPanel({
  storageKey,
  title = "How this check works",
  summary,
  children,
  className,
  icon: Icon = Info,
}: {
  /** Stable id, e.g. "compliance.msme". */
  storageKey: string;
  title?: React.ReactNode;
  /** One line shown under the title while collapsed. */
  summary?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  useEffect(() => {
    let next = true;
    try {
      const saved = window.localStorage.getItem(infoKey(storageKey));
      if (saved === "closed" || saved === "seen") next = false;
      else if (saved !== "open") window.localStorage.setItem(infoKey(storageKey), "seen");
    } catch {
      /* storage unavailable: show it open */
    }
    setOpen(next);
  }, [storageKey]);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(infoKey(storageKey), next ? "open" : "closed");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 sm:px-5"
      >
        <Icon size={18} className="shrink-0 text-[var(--likely)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-[var(--ink)]">{title}</span>
          {summary && !open ? <span className="mt-0.5 block text-[14px] leading-snug text-[var(--muted)]">{summary}</span> : null}
        </span>
        <ChevronDown size={18} className={cn("shrink-0 text-[var(--muted)] transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={bodyId} hidden={!open} className="fade-in border-t border-[var(--line)] px-4 pb-5 pt-4 text-[15px] leading-relaxed text-[var(--ink-2)] sm:px-5">
        {children}
      </div>
    </div>
  );
}

/** Label/value rows for an InfoPanel ("The rule", "If missed", "How Satya
 *  checks", "Law") — two aligned columns on wide screens. */
export function InfoList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[168px_1fr] sm:gap-y-3">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="pt-2 text-[14px] font-medium text-[var(--muted)] first:pt-0 sm:pt-0">{item.label}</dt>
          <dd className="text-[15px] leading-relaxed text-[var(--ink-2)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- responsive table ---------- */

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Money and counts align right. */
  align?: "left" | "right";
  /** Tailwind width class for the desktop column, e.g. "w-[140px]". */
  width?: string;
  /** Label on the stacked phone card (defaults to `header` when it's text). */
  mobileLabel?: string;
  /** Becomes the card title on phones (use for the identifying column). */
  primary?: boolean;
  hideOnMobile?: boolean;
  className?: string;
};

const BREAKPOINT = {
  md: { table: "md:block", cards: "md:hidden" },
  lg: { table: "lg:block", cards: "lg:hidden" },
  xl: { table: "xl:block", cards: "xl:hidden" },
} as const;

/** One list, two layouts: an aligned table on wide screens (fixed columns,
 *  money right-aligned, status in one column, actions last, sticky header
 *  for long lists) and stacked cards on phones with the same field order.
 *  Rows never change layout based on status; `rowAccent` adds at most a 3px
 *  left accent. Optional checkbox `selection` for bulk actions. */
export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  actions,
  actionsHeader = "Action",
  selection,
  empty,
  caption,
  rowAccent,
  breakpoint = "lg",
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  actions?: (row: T) => React.ReactNode;
  actionsHeader?: string;
  selection?: {
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    /** Rows that can't be selected show a disabled box. */
    isSelectable?: (row: T) => boolean;
    /** Accessible name for a row's checkbox, e.g. "Select INV-104". */
    rowLabel: (row: T) => string;
  };
  /** Shown inside the table frame when there are no rows. */
  empty?: React.ReactNode;
  /** Screen-reader caption describing the table. */
  caption?: string;
  rowAccent?: (row: T) => StatusTone | null | undefined;
  breakpoint?: keyof typeof BREAKPOINT;
  className?: string;
}) {
  const bp = BREAKPOINT[breakpoint];
  const selectable = selection ? rows.filter((r) => selection.isSelectable?.(r) ?? true) : [];
  const allSelected = !!selection && selectable.length > 0 && selectable.every((r) => selection.selected.has(rowKey(r)));
  const someSelected = !!selection && selectable.some((r) => selection.selected.has(rowKey(r)));
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (allSelected) selectable.forEach((r) => next.delete(rowKey(r)));
    else selectable.forEach((r) => next.add(rowKey(r)));
    selection.onChange(next);
  };
  const toggle = (row: T) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    const k = rowKey(row);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selection.onChange(next);
  };
  const accentColor = (row: T) => {
    const tone = rowAccent?.(row);
    return tone === "critical" ? "var(--sev-critical)" : tone === "warn" ? "var(--sev-medium)" : tone === "ok" ? "var(--confirmed)" : tone === "info" ? "var(--likely)" : null;
  };
  const checkbox = (row: T) => {
    if (!selection) return null;
    const can = selection.isSelectable?.(row) ?? true;
    return (
      <input
        type="checkbox"
        className="h-[18px] w-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        checked={selection.selected.has(rowKey(row))}
        disabled={!can}
        onChange={() => toggle(row)}
        aria-label={selection.rowLabel(row)}
      />
    );
  };
  const long = rows.length > 12;
  const colCount = columns.length + (actions ? 1 : 0) + (selection ? 1 : 0);
  const primaryCol = columns.find((c) => c.primary) ?? columns[0];
  const labelOf = (c: Column<T>) => c.mobileLabel ?? (typeof c.header === "string" ? c.header : c.key);
  const emptyNode = empty ?? <EmptyState compact title="Nothing to show" />;

  return (
    <div className={className}>
      {/* wide screens: aligned table */}
      <div className={cn(tableShell, "hidden", bp.table)}>
        <div className={cn("table-scroll", long && "max-h-[min(72vh,760px)] overflow-y-auto")}>
          <table className="w-full border-collapse">
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead className={cn(long && "sticky top-0 z-10")}>
              <tr className={tableHeadRow}>
                {selection ? (
                  <th scope="col" className={cn(tableTh, "w-12 pr-0")}>
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected && !allSelected;
                      }}
                      onChange={toggleAll}
                      disabled={!selectable.length}
                      aria-label="Select all rows"
                    />
                  </th>
                ) : null}
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn(tableTh, "whitespace-nowrap", c.align === "right" && "text-right", c.width)}>
                    {c.header}
                  </th>
                ))}
                {actions ? (
                  <th scope="col" className={cn(tableTh, "text-right")}>
                    <span className="sr-only">{actionsHeader}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount}>{emptyNode}</td>
                </tr>
              ) : (
                rows.map((row) => {
                  const accent = accentColor(row);
                  return (
                    <tr key={rowKey(row)} className={tableRow}>
                      {selection ? (
                        <td className={cn(tableTd, "w-12 pr-0")} style={accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}>
                          {checkbox(row)}
                        </td>
                      ) : null}
                      {columns.map((c, i) => (
                        <td
                          key={c.key}
                          className={cn(tableTd, c.align === "right" && "text-right tnum", c.className)}
                          style={!selection && i === 0 && accent ? { boxShadow: `inset 3px 0 0 ${accent}` } : undefined}
                        >
                          {c.cell(row)}
                        </td>
                      ))}
                      {actions ? <td className={cn(tableTd, "py-3 text-right")}>{actions(row)}</td> : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* phones and narrow windows: stacked cards, same field order */}
      <div className={bp.cards}>
        {rows.length === 0 ? (
          <div className={tableShell}>{emptyNode}</div>
        ) : (
          <ul className="space-y-3" aria-label={caption}>
            {rows.map((row) => {
              const accent = accentColor(row);
              return (
                <li
                  key={rowKey(row)}
                  className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]"
                  style={accent ? { boxShadow: `inset 3px 0 0 ${accent}, var(--shadow-1)` } : undefined}
                >
                  <div className="flex items-start gap-3">
                    {selection ? <div className="pt-0.5">{checkbox(row)}</div> : null}
                    <div className="min-w-0 flex-1 text-[15px] font-medium text-[var(--ink)]">{primaryCol.cell(row)}</div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    {columns
                      .filter((c) => c !== primaryCol && !c.hideOnMobile)
                      .map((c) => (
                        <div key={c.key} className="min-w-0">
                          <dt className="text-[13px] text-[var(--muted)]">{labelOf(c)}</dt>
                          <dd className={cn("mt-0.5 min-w-0 break-words text-[15px] text-[var(--ink-2)]", c.align === "right" && "tnum")}>{c.cell(row)}</dd>
                        </div>
                      ))}
                  </dl>
                  {actions ? <div className="mt-4 flex justify-end border-t border-[var(--line)] pt-3">{actions(row)}</div> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- skeletons that match the final layout ---------- */

/** Table-shaped loading state (header + rows); stacks as cards on phones. */
export function TableSkeleton({ rows = 5, columns = 5, className }: { rows?: number; columns?: number; className?: string }) {
  return (
    <div className={className} aria-busy="true" aria-label="Loading">
      <div className={cn(tableShell, "hidden lg:block")}>
        <div className={cn(tableHeadRow, "flex gap-6 px-4 py-3.5")}>
          {Array.from({ length: columns }, (_, i) => <Skeleton key={i} className="h-3.5 flex-1" />)}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex h-14 items-center gap-6 border-b border-[var(--line)] px-4 last:border-0">
            {Array.from({ length: columns }, (_, c) => <Skeleton key={c} className={cn("h-4 flex-1", c === 0 && "max-w-40")} />)}
          </div>
        ))}
      </div>
      <div className="space-y-3 lg:hidden">
        {Array.from({ length: Math.min(rows, 3) }, (_, r) => (
          <div key={r} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** List-row loading state for cards like "Needs you today". */
export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("divide-y divide-[var(--line)]", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-4">
          <Skeleton className="h-5 w-5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Grid of card placeholders (e.g. the six compliance checks). */
export function CardGridSkeleton({ count = 3, className, height = "h-[176px]" }: { count?: number; className?: string; height?: string }) {
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5", height)}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-7 w-24" />
          <Skeleton className="mt-3 h-4 w-40" />
          <Skeleton className="mt-2 h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
