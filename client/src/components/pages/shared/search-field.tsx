"use client";

// Search box used in list toolbars (right-aligned next to filter chips).

import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchField({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] pl-10 pr-9 text-[15px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-glow)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Toolbar row: chips on the left, search on the right; wraps on phones. */
export function ListToolbar({ children, search, className }: { children?: React.ReactNode; search?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between", className)}>
      <div className="min-w-0">{children}</div>
      {search ? <div className="shrink-0">{search}</div> : null}
    </div>
  );
}
