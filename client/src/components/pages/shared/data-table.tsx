"use client";

// Responsive data table (UI spec §2): fixed columns on desktop — money right-
// aligned and tabular, status in one column, actions last — and the same
// fields as stacked cards on phones. Rows never change layout by status; an
// optional 3px left accent is the only per-row colour.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  /** Extra classes for th/td on desktop, e.g. a width. */
  className?: string;
  /** On phones: "title" leads the card, "hide" drops it, default shows label + value. */
  mobile?: "title" | "hide" | "field";
};

export type RowAccent = "critical" | "warn" | "ok" | "info" | null | undefined;

const ACCENT: Record<string, string> = {
  critical: "var(--sev-critical)",
  warn: "var(--sev-medium)",
  ok: "var(--confirmed)",
  info: "var(--likely)",
};

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  actions,
  actionsHeader = "",
  rowAccent,
  caption,
  footer,
  className,
  stickyHeader = true,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Last column: one primary action + overflow (use <RowActions>). */
  actions?: (row: T) => React.ReactNode;
  actionsHeader?: string;
  rowAccent?: (row: T) => RowAccent;
  caption?: string;
  footer?: React.ReactNode;
  className?: string;
  stickyHeader?: boolean;
}) {
  const title = columns.find((c) => c.mobile === "title") ?? columns[0];
  const fields = columns.filter((c) => c !== title && c.mobile !== "hide");

  return (
    <div className={cn("rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]", className)}>
      {/* desktop */}
      <div className="hidden md:block md:overflow-x-auto xl:overflow-visible">
        <table className="w-full border-separate border-spacing-0 text-left">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-[13px] font-semibold text-[var(--muted)]",
                    stickyHeader && "xl:sticky xl:top-16 xl:z-[1]",
                    i === 0 && "rounded-tl-[var(--radius-md)]",
                    !actions && i === columns.length - 1 && "rounded-tr-[var(--radius-md)]",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
              {actions ? (
                <th
                  scope="col"
                  className={cn(
                    "rounded-tr-[var(--radius-md)] border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-right text-[13px] font-semibold text-[var(--muted)]",
                    stickyHeader && "xl:sticky xl:top-16 xl:z-[1]",
                  )}
                >
                  {actionsHeader ? actionsHeader : <span className="sr-only">Actions</span>}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const accent = rowAccent?.(row);
              const last = ri === rows.length - 1;
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn("group transition-colors duration-150 hover:bg-[var(--surface-2)]/70", onRowClick && "cursor-pointer")}
                >
                  {columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={cn(
                        "h-14 px-4 py-3 align-middle text-[15px] text-[var(--ink-2)]",
                        !last && "border-b border-[var(--line)]",
                        c.align === "right" && "text-right tnum",
                        c.align === "center" && "text-center",
                        c.className,
                      )}
                      style={i === 0 && accent ? { boxShadow: `inset 3px 0 0 ${ACCENT[accent]}` } : undefined}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                  {actions ? (
                    <td className={cn("h-14 px-4 py-2 text-right align-middle", !last && "border-b border-[var(--line)]")}>{actions(row)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* phone: stacked cards, same field order */}
      <ul className="divide-y divide-[var(--line)] md:hidden">
        {rows.map((row) => {
          const accent = rowAccent?.(row);
          return (
            <li
              key={rowKey(row)}
              className={cn("px-4 py-4", onRowClick && "cursor-pointer")}
              style={accent ? { boxShadow: `inset 3px 0 0 ${ACCENT[accent]}` } : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              <div className="text-[15px] text-[var(--ink)]">{title.cell(row)}</div>
              {fields.length ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {fields.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[13px] text-[var(--muted)]">{c.header}</dt>
                      <dd className={cn("mt-0.5 text-[15px] text-[var(--ink-2)]", c.align === "right" && "tnum")}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {actions ? <div className="mt-3 flex justify-end">{actions(row)}</div> : null}
            </li>
          );
        })}
      </ul>
      {footer ? <div className="border-t border-[var(--line)] px-4 py-3">{footer}</div> : null}
    </div>
  );
}

/** Skeleton that matches a ResponsiveTable: header bar + n rows. */
export function TableSkeleton({ rows = 6, cols = 5, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)]", className)} aria-busy="true" aria-label="Loading">
      <div className="hidden h-11 items-center gap-6 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 md:flex">
        {Array.from({ length: cols }, (_, i) => <Skeleton key={i} className={cn("h-3.5", i === 0 ? "w-40" : "w-20", i === cols - 1 && "ml-auto")} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-auto flex-col gap-2 border-b border-[var(--line)] px-4 py-4 last:border-0 md:h-14 md:flex-row md:items-center md:gap-6 md:py-0">
          <div className="flex-1 space-y-1.5 md:max-w-xs">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          {Array.from({ length: Math.max(0, cols - 2) }, (_, i) => <Skeleton key={i} className="hidden h-4 w-20 md:block" />)}
          <Skeleton className="h-8 w-24 md:ml-auto" />
        </div>
      ))}
    </div>
  );
}

/** "Showing 11–20 of 35" + numbered pages. */
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
