"use client";

// Public site header, shared by the landing page and secondary public pages
// (research, guide, ROI, trust, legal). One primary action: Start a pilot.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Menu, Moon, Sun, X } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export const SITE_NAV = [
  { href: "/#product", label: "Product" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/guide", label: "Guide" },
  { href: "/roi", label: "ROI" },
  { href: "/research", label: "Research" },
  { href: "/trust", label: "Security" },
];

function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className={cn("sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--topbar-bg)] backdrop-blur-md", className)}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" aria-label="Satya home" className="mr-4 inline-flex rounded-[var(--radius-sm)]">
          <Logo size={28} />
        </Link>
        <nav aria-label="Site" className="hidden items-center gap-1 lg:flex">
          {SITE_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-[var(--radius-sm)] px-3 py-2 text-[15px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeButton />
          <Link href="/login" className="hidden rounded-[var(--radius-sm)] px-3 py-2 text-[15px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="hidden h-10 items-center rounded-[var(--radius-sm)] bg-[var(--accent)] px-4 text-[15px] font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)] sm:inline-flex">
            Start a pilot
          </Link>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-[var(--radius-sm)] text-[var(--ink)] hover:bg-[var(--surface-2)] lg:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="site-menu" aria-label="Site" className="border-t border-[var(--line)] bg-[var(--surface)] px-4 pb-5 pt-2 lg:hidden">
          <ul>
            {SITE_NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} onClick={() => setOpen(false)} className="block border-b border-[var(--line)] py-3 text-base text-[var(--ink)]">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] text-[15px] font-medium text-[var(--ink)]">Sign in</Link>
            <Link href="/signup" className="inline-flex h-11 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--accent)] text-[15px] font-semibold text-[var(--on-accent)]">Start a pilot</Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  const groups = [
    {
      title: "Product",
      links: [
        { href: "/login?demo=1", label: "Live demo" },
        { href: "/signup", label: "Start a pilot" },
        { href: "/guide", label: "User guide" },
        { href: "/roi", label: "ROI calculator" },
      ],
    },
    {
      title: "Learn",
      links: [
        { href: "/research", label: "Research" },
        { href: "/trust", label: "Security & trust" },
        { href: "/legal/ai", label: "How we use AI" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/legal/privacy", label: "Privacy" },
        { href: "/legal/terms", label: "Terms" },
        { href: "/legal/dpa", label: "Data processing" },
        { href: "/legal/grievance", label: "Grievance officer" },
      ],
    },
  ];
  return (
    <footer className="border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Logo size={28} />
          <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-[var(--muted)]">
            Accounts payable checks for Indian manufacturers and distributors. Built for ₹, GST and IST.
          </p>
        </div>
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-[14px] font-semibold text-[var(--ink)]">{group.title}</p>
            <ul className="mt-3 space-y-2.5">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[15px] text-[var(--muted)] transition-colors hover:text-[var(--ink)]">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--line)]">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[14px] text-[var(--muted)] sm:px-6">
          © {new Date().getFullYear()} Satya. A working prototype — the live demo uses a fictional company.
        </p>
      </div>
    </footer>
  );
}
