// A Next <Link> styled like <Btn> — so navigation stays a real link instead
// of a <button> nested inside an <a>.

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  primary: "bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-strong)]",
  secondary: "bg-[var(--surface)] text-[var(--ink)] border border-[var(--line-strong)] shadow-[var(--shadow-1)] hover:bg-[var(--surface-2)]",
  outline: "border border-[var(--accent)]/45 text-[var(--accent-strong)] bg-transparent hover:bg-[var(--accent-soft)] hover:border-[var(--accent)]/70",
  ghost: "text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
} as const;

export function LinkBtn({
  href,
  children,
  icon: Icon,
  variant = "secondary",
  size = "sm",
  className,
}: {
  href: string;
  children: React.ReactNode;
  icon?: LucideIcon;
  variant?: keyof typeof VARIANTS;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] font-medium transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--paper)]",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {Icon ? <Icon size={size === "sm" ? 13 : 15} aria-hidden="true" /> : null}
      {children}
    </Link>
  );
}
