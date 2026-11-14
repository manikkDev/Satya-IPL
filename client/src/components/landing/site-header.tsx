import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";

/** Minimal public header for secondary pages (research, legal). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--topbar-bg)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-5">
        <Link href="/" aria-label="Satya home" className="inline-flex">
          <Logo size={26} />
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm" aria-label="Site">
          <Link href="/research" className="hidden rounded-[8px] px-3 py-1.5 text-[var(--ink-2)] hover:text-[var(--ink)] sm:inline-flex">Research</Link>
          <Link href="/login" className="rounded-[8px] px-3 py-1.5 text-[var(--ink-2)] hover:text-[var(--ink)]">Sign in</Link>
          <Link href="/app" className="inline-flex items-center gap-1 rounded-[8px] bg-[var(--accent)] px-3 py-1.5 font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)]">
            Workspace <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
