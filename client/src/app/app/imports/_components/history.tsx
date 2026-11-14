"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, KeyRound, History as HistoryIcon } from "lucide-react";
import { importsApi, type ImportRun } from "@/lib/api/imports";
import { EmptyState, ErrorState, Btn } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { sourceMeta, sourceLabel, Pill, relTime, errorText } from "./shared";
import { RunOutcome } from "./new-import";

const statusTone = (r: ImportRun) => (r.status === "committed" ? "create" : r.status === "failed" ? "error" : r.status === "committing" ? "update" : "unchanged");
const statusWord = (r: ImportRun) => (r.status === "committed" ? "Imported" : r.status === "failed" ? "Failed" : r.status === "committing" ? "Importing" : "Checked, not imported");

function RunRow({ run }: { run: ImportRun }) {
  const [open, setOpen] = useState(false);
  const meta = sourceMeta(run.source);
  const Icon = meta?.icon ?? HistoryIcon;
  const s: NonNullable<ImportRun["result"]> = run.result ?? run.summary ?? {};
  const created = s.created ?? s.create ?? 0;
  const parts = [
    created ? `${created} new` : null,
    s.update ? `${s.update} updated` : null,
    s.duplicate ? `${s.duplicate} already in Satya` : null,
    s.error ? `${s.error} not imported (errors)` : null,
  ].filter(Boolean);
  return (
    <li className="border-b border-[var(--line)] last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-[var(--surface-2)]/50 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--surface-2)] text-[var(--ink-2)]"><Icon size={15} aria-hidden="true" /></span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-[var(--ink)]">{run.fileName || sourceLabel(run.source)}</p>
            <p className="mt-0.5 text-[13px] text-[var(--muted)]">
              {sourceLabel(run.source)} · {relTime(run.committedAt || run.createdAt)}
              {run.via === "api_key" ? <span className="ml-1 inline-flex items-center gap-1"><KeyRound size={11} aria-hidden="true" /> connector</span> : null}
            </p>
            {parts.length ? <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">{parts.join(" · ")}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 sm:pl-0">
          {run.live?.checksRunning ? <Pill tone="update" icon={Loader2}>Checking</Pill> : null}
          {run.live?.openFindings ? <Pill tone="warning">{run.live.openFindings} issue{run.live.openFindings === 1 ? "" : "s"}</Pill> : null}
          {run.live?.waitingForReview ? <Pill tone="accent">{run.live.waitingForReview} to review</Pill> : null}
          <Pill tone={statusTone(run)}>{statusWord(run)}</Pill>
          <ChevronDown size={16} className={cn("text-[var(--muted)] transition-transform", open && "rotate-180")} aria-hidden="true" />
        </div>
      </button>
      {open ? (
        <div className="border-t border-[var(--line)] bg-[var(--surface-2)]/30 px-4 py-4 sm:px-5">
          {run.status === "committed" ? <RunOutcome runId={run.id} /> : (
            <p className="text-[14px] text-[var(--ink-2)]">{run.status === "failed" ? `Import failed: ${run.error ?? "unknown error"}` : "This file was checked but not imported. Upload it again from New import to finish."}</p>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ImportHistory() {
  const q = useInfiniteQuery({
    queryKey: ["import-runs"],
    queryFn: ({ pageParam }) => importsApi.runs({ limit: 20, before: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextBefore || undefined,
    refetchInterval: (query) => (query.state.data?.pages.some((p) => p.items.some((r) => r.live?.checksRunning || r.status === "committing")) ? 4000 : false),
  });
  if (q.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (q.error) return <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />;
  const runs = (q.data?.pages ?? []).flatMap((p) => p.items);
  if (!runs.length) return <EmptyState icon={HistoryIcon} title="No imports yet" body="Files you import — and anything the Tally connector sends — will be listed here with what was created, linked and flagged." />;
  return (
    <div>
      <ul className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-1)]">
        {runs.map((r) => <RunRow key={r.id} run={r} />)}
      </ul>
      {q.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Btn variant="secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} icon={q.isFetchingNextPage ? Loader2 : undefined}>Show older imports</Btn>
        </div>
      ) : null}
    </div>
  );
}
