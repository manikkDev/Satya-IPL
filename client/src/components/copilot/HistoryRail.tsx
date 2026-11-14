"use client";

// Conversation history: new chat, search, date-grouped list, delete with an
// inline confirm. Collapsible on desktop; a drawer on phones.

import { useMemo, useState } from "react";
import { PanelLeftClose, Search, SquarePen, Trash2 } from "lucide-react";
import type { CopilotConversation } from "@/lib/api/copilot";
import { dayBucket } from "./format";
import { cn } from "@/lib/utils";

const ORDER = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;

export function HistoryRail({
  items,
  loading,
  activeId,
  onNew,
  onOpen,
  onDelete,
  onCollapse,
}: {
  items: CopilotConversation[];
  loading: boolean;
  activeId: string | null;
  onNew: () => void;
  onOpen: (c: CopilotConversation) => void;
  onDelete: (id: string) => void;
  onCollapse?: () => void;
}) {
  const [q, setQ] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = term ? items.filter((c) => (c.title || "").toLowerCase().includes(term)) : items;
    const map = new Map<string, CopilotConversation[]>();
    for (const c of filtered) {
      const b = dayBucket(c.updatedAt ?? c.createdAt);
      map.set(b, [...(map.get(b) ?? []), c]);
    }
    return ORDER.filter((k) => map.has(k)).map((k) => ({ label: k, items: map.get(k) ?? [] }));
  }, [items, q]);

  return (
    <nav aria-label="Conversations" className="flex h-full flex-col">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onNew} className="flex h-10 flex-1 items-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[14px] font-medium text-[var(--ink)] shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--surface-2)]">
          <SquarePen size={16} aria-hidden="true" /> New chat
          <kbd className="ml-auto hidden rounded border border-[var(--line)] px-1.5 font-code text-[11px] font-normal text-[var(--muted)] lg:inline">⌘K</kbd>
        </button>
        {onCollapse ? (
          <button type="button" onClick={onCollapse} aria-label="Hide conversations" title="Hide conversations" className="grid h-10 w-10 place-items-center rounded-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
            <PanelLeftClose size={17} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {items.length > 6 && (
        <div className="relative mt-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
          <label htmlFor="sx-hist-q" className="sr-only">Search conversations</label>
          <input id="sx-hist-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 w-full rounded-[10px] border border-[var(--line)] bg-[var(--surface)] pl-8 pr-2 text-[13.5px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none" />
        </div>
      )}

      <div className="mt-4 flex-1 space-y-5 overflow-y-auto pr-1 sx-scroll">
        {loading && (
          <div className="space-y-2 px-1">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-8 animate-pulse rounded-[8px] bg-[var(--surface-2)]" />)}</div>
        )}
        {!loading && !items.length && <p className="px-2 text-[13px] leading-relaxed text-[var(--muted)]">Your conversations are saved here so you can pick up later.</p>}
        {!loading && items.length > 0 && !groups.length && <p className="px-2 text-[13px] text-[var(--muted)]">No conversation matches “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-2 text-[12px] font-medium text-[var(--muted)]">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id} className="group relative">
                  {confirming === c.id ? (
                    <div className="flex items-center gap-1 rounded-[10px] bg-[var(--sev-critical-soft)] px-2.5 py-1.5 text-[13px]">
                      <span className="flex-1 text-[var(--ink-2)]">Delete for good?</span>
                      <button type="button" onClick={() => { onDelete(c.id); setConfirming(null); }} className="rounded-[6px] px-2 py-0.5 font-medium text-[var(--sev-critical)] hover:bg-[var(--surface)]">Delete</button>
                      <button type="button" onClick={() => setConfirming(null)} className="rounded-[6px] px-2 py-0.5 text-[var(--ink-2)] hover:bg-[var(--surface)]">Keep</button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpen(c)}
                        aria-current={c.id === activeId ? "true" : undefined}
                        className={cn(
                          "block w-full truncate rounded-[10px] py-2 pl-2.5 pr-8 text-left text-[14px] transition-colors",
                          c.id === activeId ? "bg-[var(--surface-2)] font-medium text-[var(--ink)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]/70",
                        )}
                      >
                        {c.title || "Conversation"}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete “${c.title || "conversation"}”`}
                        onClick={() => setConfirming(c.id)}
                        className="absolute right-1 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-[8px] text-[var(--muted)] opacity-0 transition-opacity hover:bg-[var(--surface)] hover:text-[var(--sev-critical)] focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
