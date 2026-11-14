"use client";

import Link from "next/link";
import { Download, ArrowUpRight } from "lucide-react";
import type { AnswerTable, Citation, TableColumn, TableRow } from "@/lib/api/copilot";
import { tableToCsv, downloadText } from "@/lib/api/copilot";
import { formatCell } from "./format";
import { cn } from "@/lib/utils";

/** Compact, scrollable table for tool results; rows link to their record. */
export function MiniTable({
  table,
  sources = [],
  maxRows = 8,
  exportable = true,
}: {
  table: { id?: string; title?: string; columns: TableColumn[]; rows: TableRow[]; total?: Record<string, unknown> };
  sources?: Citation[];
  maxRows?: number;
  exportable?: boolean;
}) {
  const rows = table.rows.slice(0, maxRows);
  const hrefOf = (row: TableRow) => (row._ref ? sources.find((s) => s.ref === row._ref)?.href : undefined);
  return (
    <figure className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)]">
      {(table.title || exportable) && (
        <figcaption className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)]/60 px-3 py-2">
          <span className="text-[13px] font-semibold text-[var(--ink)]">{table.title}</span>
          <span className="text-xs text-[var(--muted)]">
            {table.rows.length > rows.length ? `${rows.length} of ${table.rows.length} rows` : `${table.rows.length} row${table.rows.length === 1 ? "" : "s"}`}
          </span>
          {exportable && (
            <button
              type="button"
              onClick={() => downloadText(`${(table.title || table.id || "satya").replace(/[^\w-]+/g, "-").toLowerCase()}.csv`, tableToCsv(table as AnswerTable))}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
              aria-label={`Download ${table.title || "table"} as CSV`}
            >
              <Download size={12} aria-hidden="true" /> CSV
            </button>
          )}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left">
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]", c.align === "right" && "text-right")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const href = hrefOf(row);
              return (
                <tr key={i} className="border-t border-[var(--line)] hover:bg-[var(--surface-2)]/50">
                  {table.columns.map((c, ci) => (
                    <td key={c.key} className={cn("px-3 py-2 align-top text-[var(--ink-2)]", c.align === "right" && "tnum whitespace-nowrap text-right", ci === 0 && "whitespace-nowrap font-medium text-[var(--ink)]")}>
                      {ci === 0 && href ? (
                        <Link href={href} className="inline-flex items-center gap-0.5 hover:text-[var(--accent-strong)] hover:underline">
                          {formatCell(row[c.key], c.format)}
                          <ArrowUpRight size={11} className="opacity-60" aria-hidden="true" />
                        </Link>
                      ) : (
                        formatCell(row[c.key], c.format)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {table.total && (
            <tfoot>
              <tr className="border-t-2 border-[var(--line-strong)] bg-[var(--surface-2)]/40 font-semibold text-[var(--ink)]">
                {table.columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-2", c.align === "right" && "tnum whitespace-nowrap text-right")}>
                    {table.total?.[c.key] !== undefined ? formatCell(table.total[c.key], c.format) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </figure>
  );
}
