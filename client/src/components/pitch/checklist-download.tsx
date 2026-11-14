"use client";

import { Download } from "lucide-react";
import { checklistCsv, checklistMarkdown } from "@/content/pitch/guide";

function save(name: string, type: string, text: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Generates the data-request checklist in the browser; nothing is uploaded. */
export function ChecklistDownload() {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        onClick={() => save("satya-pilot-data-checklist.csv", "text/csv;charset=utf-8", "﻿" + checklistCsv())}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
      >
        <Download size={14} aria-hidden="true" /> Download checklist (CSV)
      </button>
      <button
        type="button"
        onClick={() => save("satya-pilot-data-checklist.md", "text/markdown;charset=utf-8", checklistMarkdown())}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-2)]"
      >
        <Download size={14} aria-hidden="true" /> Markdown
      </button>
    </div>
  );
}
