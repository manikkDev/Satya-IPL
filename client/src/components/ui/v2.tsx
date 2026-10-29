"use client";

// Satya v2 primitives (docs/plan/06 §2–§3). Certainty and severity are always
// icon + word + colour — never colour alone. Money renders formatted decimal
// strings only.

import { CheckCircle2, CircleDot, Circle, CircleHelp, CircleDashed, OctagonAlert, TriangleAlert, CircleAlert, Info, Check, MessageCircleQuestion, CircleArrowUp, PauseCircle, Inbox, RotateCcw, ArrowRight, type LucideIcon } from "lucide-react";
import { motion, type Variants } from "framer-motion";
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

/** Plain word + official term, with a ≤20-word explanation on hover/focus.
 *  Renders a focusable <span> (never a button) so it is valid inside
 *  buttons, tab triggers and table cells. */
export function Term({ of, children, className }: { of: keyof typeof TERM_TIPS; children?: React.ReactNode; className?: string }) {
  const term = TERM_TIPS[of];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("underline decoration-dotted decoration-1 underline-offset-4 cursor-help text-inherit font-inherit", className)}>
          {children ?? term.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60 text-xs leading-relaxed">{term.tip}</TooltipContent>
    </Tooltip>
  );
}

/* ---------- buttons ---------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary:
    "bg-[var(--accent)] text-white shadow-[0_1px_0_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-[var(--accent-strong)] hover:shadow-[var(--shadow-2)] active:translate-y-px dark:text-[#06231c]",
  secondary:
    "bg-[var(--surface-2)] text-[var(--ink)] border border-[var(--line)] hover:bg-[var(--surface-3)] hover:border-[var(--line-strong)]",
  outline:
    "border border-[var(--accent)]/45 text-[var(--accent-strong)] bg-transparent hover:bg-[var(--accent-soft)] hover:border-[var(--accent)]/70",
  ghost:
    "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
  danger:
    "border border-[var(--sev-critical)]/45 text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]",
};

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
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--paper)]",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-4 text-sm",
        size === "lg" && "h-11 px-5 text-[15px]",
        BTN_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon size={size === "sm" ? 13 : 15} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ---------- layout & motion ---------- */

/** Consistent page head: eyebrow + title + one plain-English line + actions. */
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
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{eyebrow}</p>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--ink)]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Subtle rise-in on mount — shared by every page so motion stays uniform. */
export function FadeIn({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: [0.21, 0.65, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

const STAGGER: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const STAGGER_ITEM: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.21, 0.65, 0.36, 1] } },
};

/** Staggered entrance for grids/lists of cards. */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={STAGGER} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={STAGGER_ITEM}>
      {children}
    </motion.div>
  );
}

/** Scroll-reveal for long pages (lands once). */
export function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay, ease: [0.21, 0.65, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ---------- cards ---------- */

export function Card({
  children,
  className,
  pad = true,
  hover = false,
  glow = false,
}: {
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
  hover?: boolean;
  glow?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]",
        hover && "card-hover hover:-translate-y-0.5",
        glow && "glow-accent",
        pad && "p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, hint, icon: Icon }: { children: React.ReactNode; hint?: string; icon?: LucideIcon }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--ink)]">
        {Icon ? <Icon size={15} className="text-[var(--muted)]" aria-hidden="true" /> : null}
        {children}
      </h2>
      {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
    </div>
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
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium leading-none"
      style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 32%, transparent)` }}
    >
      <Icon size={12} aria-hidden="true" />
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
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-medium leading-none"
      style={{ color: style.color, background: style.bg, borderColor: `color-mix(in srgb, ${style.color} 32%, transparent)` }}
    >
      <Icon size={12} aria-hidden="true" />
      {style.word}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-[3px] text-[11px] font-medium leading-none text-[var(--ink-2)]">
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
      {STATUS_LABEL[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}

/** Small filter chip used for segmented choices. */
export function Chip({ active, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--accent)] text-white dark:text-[#06231c]"
          : "bg-[var(--surface-2)] text-[var(--ink-2)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------- actions ---------- */

const ACTION_STYLE: Record<Action, { icon: LucideIcon; classes: string }> = {
  APPROVE: { icon: Check, classes: "bg-[var(--accent)] text-white hover:bg-[var(--accent-strong)] dark:text-[#06231c] shadow-[0_1px_0_rgb(0_0_0/0.2)]" },
  REQUEST_CLARIFICATION: { icon: MessageCircleQuestion, classes: "border border-[var(--accent)]/45 text-[var(--accent-strong)] bg-transparent hover:bg-[var(--accent-soft)]" },
  ESCALATE: { icon: CircleArrowUp, classes: "border border-[var(--sev-high)]/50 text-[var(--sev-high)] bg-transparent hover:bg-[var(--sev-high-soft)]" },
  PLACE_ON_HOLD: { icon: PauseCircle, classes: "border border-[var(--sev-critical)]/50 text-[var(--sev-critical)] bg-transparent hover:bg-[var(--sev-critical-soft)]" },
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
        "inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-all duration-150 hover:-translate-y-px",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0",
        style.classes,
      )}
      disabled={disabled}
      aria-disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={onClick}
    >
      <Icon size={15} aria-hidden="true" />
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
  delta?: string;
  seeWhy?: string;
  onSeeWhy?: () => void;
  /** Normalised sparkline points 0..1 (display only). */
  spark?: number[];
  tone?: "default" | "warn" | "good";
}) {
  const accent =
    tone === "warn" ? "var(--sev-high)" : tone === "good" ? "var(--confirmed)" : "var(--accent)";
  return (
    <article className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]">
      <span
        className="absolute inset-x-5 top-0 h-px opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] text-[var(--muted)]">
          {tip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="underline decoration-dotted underline-offset-4 cursor-help">{label}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-60 text-xs">{tip}</TooltipContent>
            </Tooltip>
          ) : label}
        </p>
        {spark ? <Sparkline points={spark} color={accent} /> : null}
      </div>
      <p className="mt-3 text-[26px] leading-8 font-semibold tnum tracking-tight text-[var(--ink)]">{value}</p>
      <div className="mt-3.5 flex items-center justify-between gap-2">
        {delta ? <span className="text-xs leading-snug text-[var(--muted)]">{delta}</span> : <span />}
        {seeWhy ? (
          <button
            type="button"
            onClick={onSeeWhy}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-strong)]"
          >
            {seeWhy} <ArrowRight size={12} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </article>
  );
}

/* ---------- progress ---------- */

export function Progress({
  value,
  tone = "var(--accent)",
  className,
}: {
  value: number; // 0..100
  tone?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-[5px] w-full overflow-hidden rounded-full bg-[var(--surface-3)]", className)} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className="bar-anim h-full rounded-full" style={{ width: `${clamped}%`, background: tone }} />
    </div>
  );
}

/* ---------- states ---------- */

export function EmptyState({ title, body, actionLabel, onAction, icon: Icon = Inbox }: { title: string; body?: string; actionLabel?: string; onAction?: () => void; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-md)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--accent-soft)]">
        <Icon size={20} className="text-[var(--accent)]" aria-hidden="true" />
      </div>
      <p className="mt-4 text-[15px] font-medium text-[var(--ink)]">{title}</p>
      {body ? <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[var(--muted)]">{body}</p> : null}
      {actionLabel ? (
        <Btn onClick={onAction} className="mt-5">{actionLabel}</Btn>
      ) : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sev-critical)_35%,transparent)] bg-[var(--sev-critical-soft)] px-5 py-4">
      <p className="text-sm font-medium text-[var(--sev-critical)]">We couldn’t load this.</p>
      <p className="mt-1 text-sm text-[var(--ink-2)]">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sev-critical)_50%,transparent)] px-3 py-1.5 text-sm font-medium text-[var(--sev-critical)] transition-colors hover:bg-[var(--sev-critical-soft)]">
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

/* ---------- table chrome ---------- */

export const tableShell =
  "overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]";
export const tableHeadRow = "border-b border-[var(--line)] bg-[var(--surface-2)]/60";
export const tableTh =
  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]";
export const tableTd = "px-4 py-3.5 text-sm text-[var(--ink-2)]";
export const tableRow =
  "border-b border-[var(--line)] last:border-0 transition-colors hover:bg-[var(--surface-2)]/50";
