// Shared layout for sign-in, sign-up and invitation pages: a plain header
// (logo + one link), the page content, and a quiet footer. No decorative art —
// the page is about getting into the product.

import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export function AuthLayout({
  children,
  headerLink,
  wide = false,
}: {
  children: React.ReactNode;
  /** One link in the top-right, e.g. "New to Satya? Start a pilot". */
  headerLink?: { prompt?: string; label: string; href: string };
  /** Two-column content (sign-in + demo) instead of a single narrow form. */
  wide?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--paper)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Satya — back to the home page" className="inline-flex rounded-[var(--radius-sm)]">
            <Logo size={28} />
          </Link>
          {headerLink ? (
            <p className="text-[15px] text-[var(--muted)]">
              {headerLink.prompt ? <span className="hidden sm:inline">{headerLink.prompt} </span> : null}
              <Link href={headerLink.href} className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">
                {headerLink.label}
              </Link>
            </p>
          ) : null}
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6 sm:py-16">
        <div className={cn("rise w-full", wide ? "max-w-5xl" : "max-w-[440px]")}>{children}</div>
      </main>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-5 text-[14px] text-[var(--muted)] sm:px-6">
          <span>Made for Indian businesses · ₹ · GST · IST</span>
          <span className="flex flex-wrap gap-x-5 gap-y-1 sm:ml-auto">
            <Link href="/trust" className="hover:text-[var(--ink)]">Security</Link>
            <Link href="/legal/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
            <Link href="/legal/terms" className="hover:text-[var(--ink)]">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}

export function AuthCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[var(--shadow-1)] sm:p-8", className)}>
      {children}
    </div>
  );
}

export function AuthField({
  id,
  label,
  hint,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: React.ReactNode; error?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-[15px] font-medium text-[var(--ink)]">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
        className={cn(
          "mt-1.5 block h-12 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 text-base text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-glow)] read-only:bg-[var(--surface-2)] read-only:text-[var(--ink-2)]",
          error && "border-[var(--sev-critical)]",
        )}
      />
      {hint && !error ? <p id={`${id}-hint`} className="mt-1.5 text-[14px] text-[var(--muted)]">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="mt-1.5 text-[14px] text-[var(--sev-critical)]">{error}</p> : null}
    </div>
  );
}

export const authButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-base font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-60";

export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-[var(--radius-sm)] border border-[var(--sev-critical)]/30 bg-[var(--sev-critical-soft)] px-3.5 py-2.5 text-[15px] text-[var(--sev-critical)]">
      {children}
    </p>
  );
}
