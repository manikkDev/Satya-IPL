"use client";

// Right-hand panel, opened on demand: the records an answer rests on, with
// details, plus how the answer was checked. Non-modal on desktop (you can
// keep reading); a full-width sheet on phones. Esc closes.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Database, FileText, Gavel, Landmark, ShieldCheck, Sparkles, Truck, Wallet, X, BarChart3, AlertTriangle } from "lucide-react";
import type { Citation, CopilotAnswer } from "@/lib/api/copilot";
import { getCitationPreview } from "@/lib/api/copilot";
import { inr, shortDate } from "./format";
import { cn } from "@/lib/utils";

const ICON = { document: FileText, supplier: Truck, case: Gavel, finding: AlertTriangle, payment: Wallet, compliance: Landmark, report: BarChart3 } as const;

function SourceRow({ s, cited }: { s: Citation; cited: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ["copilot-cite", s.kind, s.id], queryFn: () => getCitationPreview(s), staleTime: 5 * 60_000 });
  const Icon = ICON[s.kind] ?? FileText;
  return (
    <li>
      <Link href={s.href} className="group flex gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50">
        <span className={cn("grid h-6 min-w-6 shrink-0 place-items-center rounded-[6px] px-1 text-[11.5px] font-semibold", cited ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--surface-2)] text-[var(--muted)]")}>{s.n}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--muted)]"><Icon size={12} aria-hidden="true" /> {data?.kindLabel ?? s.kind}</span>
          <span className="mt-0.5 block truncate text-[14px] font-medium text-[var(--ink)]">{data?.number || s.label}</span>
          {isLoading ? <span className="mt-1 block h-3 w-32 animate-pulse rounded bg-[var(--surface-2)]" /> : (
            <span className="block text-[12.5px] text-[var(--ink-2)]">
              {[data?.party, data?.amount ? inr(data.amount) : null, data?.date ? shortDate(data.date) : null].filter(Boolean).join(" · ") || null}
            </span>
          )}
        </span>
        <ArrowUpRight size={14} className="mt-1 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)]" aria-hidden="true" />
      </Link>
    </li>
  );
}

export function SourcesPanel({ answer, onClose }: { answer: CopilotAnswer | null; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!answer) return;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, onClose]);
  if (!answer) return null;
  const cited = new Set((answer.citations ?? []).map((c) => c.ref));
  const citedList = answer.citations ?? [];
  const extra = (answer.sources ?? []).filter((s) => !cited.has(s.ref)).map((s, i) => ({ ...s, n: citedList.length + i + 1 }));
  const numbered = [...citedList, ...extra];
  const list = numbered;
  const g = answer.grounding;
  const agent = answer.responseMode === "agent";
  return (
    <aside
      aria-label="Sources"
      className="sx-rise fixed inset-x-0 bottom-0 top-16 z-40 flex flex-col border-l border-[var(--line)] bg-[var(--paper)] shadow-[var(--shadow-3)] md:inset-x-auto md:right-0 md:w-[400px]"
    >
      <header className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-4">
        <h2 ref={heading} tabIndex={-1} className="text-[16px] font-semibold text-[var(--ink)] focus:outline-none">Sources</h2>
        <span className="text-[13px] text-[var(--muted)]">{list.length}</span>
        <button type="button" onClick={onClose} aria-label="Close sources" className="ml-auto grid h-9 w-9 place-items-center rounded-[10px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]">
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sx-scroll">
        <section className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4">
          <h3 className="text-[13px] font-semibold text-[var(--ink)]">How this answer was checked</h3>
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-[var(--ink-2)]">
            {g && g.claims > 0 ? (
              <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--confirmed)]" aria-hidden="true" /> {g.grounded} of {g.claims} figures matched your records or Satya’s calculator</li>
            ) : (
              <li className="flex items-start gap-2"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--confirmed)]" aria-hidden="true" /> No figures to check in this answer</li>
            )}
            <li className="flex items-start gap-2">
              {agent ? <Sparkles size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" /> : <Database size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />}
              {agent ? `Planned and written by ${answer.llm?.model ?? "the AI model"}; every figure verified before you saw it` : "Written directly from your records — no AI writing"}
            </li>
            {answer.toolCalls?.length ? <li className="flex items-start gap-2"><Database size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" aria-hidden="true" /> {answer.toolCalls.length} lookup{answer.toolCalls.length === 1 ? "" : "s"} in your records</li> : null}
          </ul>
        </section>
        {list.length ? (
          <ul className="space-y-2">
            {numbered.map((s) => <SourceRow key={s.ref} s={s} cited={cited.has(s.ref)} />)}
          </ul>
        ) : (
          <p className="text-[14px] text-[var(--muted)]">This answer didn’t rest on specific records.</p>
        )}
      </div>
    </aside>
  );
}
