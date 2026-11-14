"use client";

// Segmented filter chips with counts — "Open 11 · In review 8 · Resolved 15".
// One row above a table; the active chip is filled. Counts are optional and
// render as a quiet number so the label stays the thing you read.

import { cn } from "@/lib/utils";

export type FilterOption<T extends string = string> = {
  value: T;
  label: string;
  count?: number | null;
  /** Colour the count when it means "needs attention". */
  tone?: "default" | "warn" | "bad";
};

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Filter",
  className,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex flex-wrap items-center gap-2", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors duration-150",
              active
                ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]"
                : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count !== null ? (
              <span
                className={cn(
                  "tnum min-w-5 rounded-full px-1.5 text-center text-[13px] leading-5",
                  active
                    ? "bg-[color-mix(in_srgb,var(--paper)_18%,transparent)] text-[var(--paper)]"
                    : o.tone === "bad" && o.count > 0
                      ? "bg-[var(--sev-critical-soft)] text-[var(--sev-critical)]"
                      : o.tone === "warn" && o.count > 0
                        ? "bg-[var(--sev-medium-soft)] text-[var(--sev-medium)]"
                        : "bg-[var(--surface-2)] text-[var(--muted)]",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
