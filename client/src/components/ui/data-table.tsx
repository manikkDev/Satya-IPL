"use client";

// Thin TanStack Table wrapper (docs/plan/06 §3): sortable columns, sticky
// header. Column visibility + virtualisation land when a list needs >200 rows.

import { useState } from "react";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function DataTable<T>({
  data, columns, onRowClick, ariaLabel,
}: {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRowClick?: (row: T) => void;
  ariaLabel?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
      <table className="w-full text-sm" aria-label={ariaLabel}>
        <thead className="sticky top-0 bg-[var(--surface-2)]/70 backdrop-blur">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-[var(--line)]">
              {group.headers.map((header) => (
                <th key={header.id} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="inline-flex items-center gap-1 uppercase tracking-wide"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === "asc" && <ArrowUp size={12} aria-label="sorted ascending" />}
                      {header.column.getIsSorted() === "desc" && <ArrowDown size={12} aria-label="sorted descending" />}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick(row.original);
                      }
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={cn(
                "border-b border-[var(--line)] last:border-0 transition-colors",
                onRowClick && "cursor-pointer hover:bg-[var(--surface-2)]/60 focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3.5 text-[var(--ink-2)]">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">Nothing to show.</p>}
    </div>
  );
}
