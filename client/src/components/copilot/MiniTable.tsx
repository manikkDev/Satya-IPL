"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Download } from "lucide-react";
import type { AnswerTable, Citation, TableColumn, TableRow } from "@/lib/api/copilot";
import { tableToCsv, downloadText } from "@/lib/api/copilot";
import { formatCell } from "./format";
import { cn } from "@/lib/utils";

/** Clean mini-table for tool results: money right-aligned, rows link to their record, CSV export. */
export function MiniTable({
  table,
  sources = [],
  maxRows = 6,
  exportable = true,
}: {
  table: { id?: string; title?: string; columns: TableColumn[]; rows: TableRow[]; total?: Record<string, unknown> };
  sources?: Citation[];
  maxRows?: number;
  exportable?: boolean;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, maxRows);
  const hrefOf = (row: TableRow) => (row._ref ? sources.find((s) => s.ref === row._ref)?.href : undefined);
  const hidden = table.rows.length - rows.length;
  return (
    <figure className="sx-rise overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
      {(table.title || exportable) && (
        <figcaption className="flex items-center gap-2 px-4 pb-1 pt-3">
          <span className="text-[14px] font-semibold text-[var(--ink)]">{table.title}</span>
          <span className="text-[12.5px] text-[var(--muted)]">{table.rows.length} row{table.rows.length === 1 ? "" : "s"}</span>
          {exportable && (
            <button
              type="button"
              onClick={() => downloadText(`${(table.title || table.id || "satya").replace(/[^\w-]+/g, "-").toLowerCase()}.csv`, tableToCsv(table as AnswerTable))}
              className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12.5px] font-medium text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]"
              aria-label={`Export ${table.title || "table"} as CSV`}
            >
              <Download size={13} aria-hidden="true" /> Export CSV
            </button>
          )}
        </figcaption>
      )}
      <div className="sx-scroll overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[14px]">
          <thead>
            <tr className="text-left">
              {table.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap px-4 py-2 text-[12.5px] font-medium text-[var(--muted)]", c.align === "right" && "text-right")}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const href = hrefOf(row);
              return (
                <tr key={i} className="border-t border-[var(--line)] transition-colors hover:bg-[var(--surface-2)]/60">
                  {table.columns.map((c, ci) => (
                    <td key={c.key} className={cn("px-4 py-2.5 align-top text-[var(--ink-2)]", c.align === "right" && "tnum whitespace-nowrap text-right", (c.format === "date" || c.format === "inr" || c.format === "int" || c.format === "pct") && "whitespace-nowrap", ci === 0 && "whitespace-nowrap font-medium text-[var(--ink)]", ci > 0 && !c.format && "min-w-[150px]")}>
                      {ci === 0 && href ? (
                        <Link href={href} className="inline-flex items-center gap-0.5 hover:text-[var(--accent-strong)] hover:underline">
                          {formatCell(row[c.key], c.format)}
                          <ArrowUpRight size={12} className="opacity-50" aria-hidden="true" />
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
          {table.total && (all || !hidden) && (
            <tfoot>
              <tr className="border-t border-[var(--line-strong)] font-semibold text-[var(--ink)]">
                {table.columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-2.5", c.align === "right" && "tnum whitespace-nowrap text-right")}>
                    {table.total?.[c.key] !== undefined ? formatCell(table.total[c.key], c.format) : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.rows.length > maxRows && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="flex w-full items-center justify-center gap-1 border-t border-[var(--line)] py-2 text-[13px] font-medium text-[var(--muted)] hover:bg-[var(--surface-2)]/60 hover:text-[var(--ink)]">
          {all ? "Show fewer" : `Show all ${table.rows.length} rows`}
          <ChevronDown size={14} className={cn("transition-transform duration-200", all && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </figure>
  );
}
