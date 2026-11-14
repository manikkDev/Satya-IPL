"use client";

// "Showing 11–20 of 35 orders" + numbered pages, under a ResponsiveTable.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Pager({
  page,
  pages,
  total,
  pageSize,
  onPage,
  noun = "items",
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  noun?: string;
}) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  const btn = "grid h-9 min-w-9 place-items-center rounded-[var(--radius-sm)] border px-2 text-[14px] font-medium transition-colors";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[14px] text-[var(--muted)] tnum">
        {total <= pageSize ? `${total} ${noun}` : `Showing ${from}–${to} of ${total} ${noun}`}
      </p>
      {pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center gap-1">
          <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page === 1} aria-label="Previous page"
            className={cn(btn, "border-[var(--line-strong)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-40")}>
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          {nums.map((n) => (
            <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? "page" : undefined}
              className={cn(btn, n === page ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}>
              {n}
            </button>
          ))}
          <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page === pages} aria-label="Next page"
            className={cn(btn, "border-[var(--line-strong)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] disabled:opacity-40")}>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
