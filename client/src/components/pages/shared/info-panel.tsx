"use client";

// "How this works" — explain a rule ONCE per page instead of on every row.
// Collapsible; remembers per-viewer whether it was closed (localStorage,
// guarded — the page renders correctly without it).

import { useEffect, useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

function readClosed(key?: string): boolean | null {
  if (!key) return null;
  try {
    const v = window.localStorage.getItem(`satya.info.${key}`);
    return v === null ? null : v === "closed";
  } catch {
    return null;
  }
}

export function InfoPanel({
  title,
  children,
  defaultOpen = false,
  storageKey,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Remember open/closed for this viewer. */
  storageKey?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  useEffect(() => {
    const closed = readClosed(storageKey);
    if (closed !== null) setOpen(!closed);
  }, [storageKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) {
      try {
        window.localStorage.setItem(`satya.info.${storageKey}`, next ? "open" : "closed");
      } catch {
        /* storage unavailable — fine */
      }
    }
  };

  return (
    <section className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-4 py-3 text-left text-[15px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]/60"
      >
        <Info size={17} className="shrink-0 text-[var(--likely)]" aria-hidden="true" />
        <span className="min-w-0 flex-1">{title}</span>
        <ChevronDown size={17} className={cn("shrink-0 text-[var(--muted)] transition-transform duration-200", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} className="rise border-t border-[var(--line)] px-4 pb-4 pt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
          {children}
        </div>
      ) : null}
    </section>
  );
}
