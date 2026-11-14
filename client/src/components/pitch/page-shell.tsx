// Shared chrome for the public pitch pages (/research, /guide, /roi, /trust):
// the site header, a small section nav between these pages, readable prose
// widths and one consistent footer. Server component — no client JS.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/landing/site-header";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import type { Reference } from "@/content/pitch/references";

export const PITCH_PAGES = [
  { href: "/research", label: "Problem & research" },
  { href: "/research/model", label: "Model performance" },
  { href: "/guide", label: "Pilot guide" },
  { href: "/roi", label: "ROI calculator" },
  { href: "/trust", label: "Trust & security" },
] as const;

export function PitchNav({ current }: { current: (typeof PITCH_PAGES)[number]["href"] }) {
  return (
    <nav aria-label="About Satya" className="border-b border-[var(--line)] bg-[var(--paper)] print:hidden">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2 text-sm sm:px-5">
        {PITCH_PAGES.map((page) => {
          const active = page.href === current;
          return (
            <li key={page.href} className="shrink-0">
              <Link
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex rounded-[var(--radius-sm)] px-3 py-1.5 transition-colors",
                  active ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--muted)] hover:text-[var(--ink)]",
                )}
              >
                {page.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PitchFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--line)] print:hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <Logo size={26} />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
            Know what you really owe, and why. Every number with its source.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-12 gap-y-6 text-sm text-[var(--muted)]">
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-2)]">About</span>
            {PITCH_PAGES.map((p) => (
              <Link key={p.href} href={p.href} className="hover:text-[var(--ink)]">{p.label}</Link>
            ))}
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-2)]">Product</span>
            <Link href="/app" className="hover:text-[var(--ink)]">Demo workspace</Link>
            <Link href="/login" className="hover:text-[var(--ink)]">Sign in</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-2)]">Legal</span>
            <Link href="/legal/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-[var(--ink)]">Terms</Link>
            <Link href="/legal/ai" className="hover:text-[var(--ink)]">AI transparency</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-[var(--line)] px-4 py-5 text-center text-xs leading-relaxed text-[var(--muted)]">
        Satya is a prototype decision-support tool. It does not file returns or move money. External figures are cited to
        their sources; verify important figures with your accountant or tax adviser.
      </div>
    </footer>
  );
}

export function PitchPage({
  current,
  children,
}: {
  current: (typeof PITCH_PAGES)[number]["href"];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <PitchNav current={current} />
      <main id="main" className="mx-auto max-w-5xl px-4 pt-10 sm:px-5 sm:pt-14">{children}</main>
      <PitchFooter />
    </div>
  );
}

/** Page hero: eyebrow, h1, lead paragraph (max ~72ch). */
export function PitchHero({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="max-w-[72ch]">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">{eyebrow}</p>
      <h1 className="mt-3 text-[32px] font-semibold leading-[1.15] tracking-[-0.025em] text-[var(--ink)] sm:text-[40px]">{title}</h1>
      {children ? <div className="mt-5 space-y-4 text-[17px] leading-[1.65] text-[var(--ink-2)]">{children}</div> : null}
    </header>
  );
}

export function Section({
  id,
  title,
  kicker,
  intro,
  children,
  className,
}: {
  id: string;
  title: string;
  kicker?: string;
  intro?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={cn("mt-16 sm:mt-20", className)}>
      {kicker ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">{kicker}</p> : null}
      <h2 id={`${id}-h`} className="mt-1.5 max-w-[60ch] text-2xl font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)] sm:text-[28px]">
        {title}
      </h2>
      {intro ? <div className="mt-4 max-w-[72ch] space-y-4 text-base leading-[1.7] text-[var(--ink-2)]">{intro}</div> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}

export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("max-w-[72ch] space-y-4 text-base leading-[1.7] text-[var(--ink-2)]", className)}>{children}</div>;
}

/** Inline citation: "(Source, 2026)" linking out. */
export function Cite({ r, label }: { r: Reference; label?: string }) {
  const text = label ?? shortSource(r);
  const year = r.year ? `, ${r.year}` : "";
  if (!r.url) return <span className="text-[var(--muted)]">({text}{year})</span>;
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap text-[0.92em] text-[var(--accent)] underline decoration-[color-mix(in_srgb,var(--accent)_40%,transparent)] underline-offset-[3px] hover:decoration-[var(--accent)]"
    >
      {text}{year}
      <span className="sr-only"> (opens in a new tab; reference {r.n})</span>
    </a>
  );
}

/** First phrase of a reference entry, e.g. "Ardent Partners". */
export function shortSource(r: Reference): string {
  const head = r.text.split(/,\s|\.\s/)[0];
  return head.length > 40 ? `${head.slice(0, 38)}…` : head;
}

export function Callout({ tone = "note", title, children }: { tone?: "note" | "warn" | "honest"; title: string; children: React.ReactNode }) {
  const color = tone === "warn" ? "var(--sev-medium)" : tone === "honest" ? "var(--unclear)" : "var(--accent)";
  return (
    <aside
      className="max-w-[72ch] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{children}</div>
    </aside>
  );
}

export function LinkCard({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group block rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--line-strong)]"
    >
      <span className="flex items-center justify-between gap-3 text-[15px] font-semibold text-[var(--ink)]">
        {title}
        <ArrowUpRight size={16} className="text-[var(--muted)] transition-colors group-hover:text-[var(--accent)]" aria-hidden="true" />
      </span>
      <span className="mt-1.5 block text-sm leading-relaxed text-[var(--muted)]">{children}</span>
    </Link>
  );
}

/** Responsive data table: scrolls inside its own box on narrow screens. */
export function DataTable({
  caption,
  head,
  rows,
  minWidth = 640,
}: {
  caption?: string;
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]" tabIndex={0} role="region" aria-label={caption ?? "Table"}>
      <table className="w-full border-collapse text-left text-[14.5px]" style={{ minWidth }}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 align-bottom text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[var(--line)] align-top last:border-0">
              {row.map((cell, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="px-4 py-3.5 font-medium leading-relaxed text-[var(--ink)]">{cell}</th>
                ) : (
                  <td key={ci} className="px-4 py-3.5 leading-relaxed text-[var(--ink-2)]">{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "accent" | "warn" | "planned" }) {
  const styles: Record<string, string> = {
    neutral: "border-[var(--line-strong)] text-[var(--ink-2)] bg-[var(--surface-2)]",
    accent: "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[var(--accent)] bg-[var(--accent-soft)]",
    warn: "border-[color-mix(in_srgb,var(--possible)_35%,transparent)] text-[var(--possible)] bg-[var(--possible-soft)]",
    planned: "border-dashed border-[var(--line-strong)] text-[var(--muted)] bg-transparent",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-5", styles[tone])}>
      {children}
    </span>
  );
}
