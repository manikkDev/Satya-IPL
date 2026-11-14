"use client";

// Review history (/app/audit) — docs/plan/06 §5.12. Every recorded change in
// the group, newest first, from GET /api/v2/audit, with the hash-chain
// integrity check from GET /api/v2/audit/verify. Read-only.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RotateCcw, ArrowUpRight, History, FilterX, CircleCheck, CircleX, Ban } from "lucide-react";
import { auditApi, accountApi, isoDateIst, downloadCsv, type AuditRow } from "@/lib/api/v2-pages";
import { ApiError } from "@/lib/api/client";
import { mocksEnabled } from "@/lib/flags";
import { describeAudit, actionRegex, OBJECT_TYPES, ACTION_KINDS } from "@/components/pages/audit/describe";
import { DateText, ErrorState, EmptyState, PageHeader, FadeIn, Btn, Card } from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const selectCls =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-2.5 text-sm text-[var(--ink)] outline-none transition-colors focus:border-[var(--accent)]";
const labelCls = "mb-1 block text-xs font-medium text-[var(--muted)]";

const shortId = (id?: string | null) => (id ? (id.length > 14 ? `…${id.slice(-8)}` : id) : "—");
const roleWord = (role?: string | null) => (!role || role === "*" ? null : role.replaceAll("_", " "));

/* ---------- chain integrity banner ---------- */

function ChainBanner() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["audit-verify"],
    queryFn: () => auditApi.verify(),
    enabled: !mocksEnabled(),
    staleTime: 60_000,
  });

  const base = "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border px-4 py-3 text-sm";

  if (mocksEnabled()) {
    return (
      <div className={cn(base, "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]")}>
        <ShieldQuestion size={16} aria-hidden="true" /> Demo data — the integrity check runs against a live server.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className={cn(base, "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)]")} aria-live="polite">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking the history has not been altered…
      </div>
    );
  }
  if (error) {
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <div className={cn(base, "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)]")}>
        <ShieldQuestion size={16} className="text-[var(--muted)]" aria-hidden="true" />
        <span className="min-w-[14rem] flex-1">
          {forbidden ? "Your role cannot run the integrity check." : `Integrity check unavailable — ${error instanceof Error ? error.message : "try again"}.`}
        </span>
        {!forbidden ? <Btn size="sm" variant="ghost" icon={RotateCcw} onClick={() => refetch()}>Retry</Btn> : null}
      </div>
    );
  }
  if (data?.valid) {
    return (
      <div className={cn(base, "border-[color-mix(in_srgb,var(--confirmed)_35%,transparent)] bg-[var(--confirmed-soft)]")} role="status">
        <ShieldCheck size={16} className="text-[var(--confirmed)]" aria-hidden="true" />
        <span className="min-w-[14rem] flex-1 text-[var(--ink)]">
          <strong className="font-semibold text-[var(--confirmed)]">Chain verified</strong> — all{" "}
          <span className="tnum">{data.checked ?? 0}</span> entries link up; nothing has been edited or removed.
        </span>
        <Btn size="sm" variant="ghost" icon={isFetching ? Loader2 : RotateCcw} disabled={isFetching} onClick={() => refetch()}>Re-check</Btn>
      </div>
    );
  }
  const position = typeof data?.checked === "number" ? data.checked + 1 : null;
  return (
    <div className={cn(base, "border-[color-mix(in_srgb,var(--sev-critical)_40%,transparent)] bg-[var(--sev-critical-soft)]")} role="alert">
      <ShieldAlert size={16} className="text-[var(--sev-critical)]" aria-hidden="true" />
      <span className="min-w-[14rem] flex-1 text-[var(--ink)]">
        <strong className="font-semibold text-[var(--sev-critical)]">Chain broken</strong>
        {position ? <> at entry <span className="tnum">#{position}</span></> : null}
        {data?.brokenAt ? <> (<span className="font-code text-xs">{data.brokenAt}</span>)</> : null} — an entry from that point no
        longer matches its recorded fingerprint. Entries after it cannot be trusted until an administrator investigates.
      </span>
      <Btn size="sm" variant="ghost" icon={isFetching ? Loader2 : RotateCcw} disabled={isFetching} onClick={() => refetch()}>Re-check</Btn>
    </div>
  );
}

/* ---------- one entry ---------- */

function Entry({ row, meId, broken }: { row: AuditRow; meId?: string; broken: boolean }) {
  const d = describeAudit(row);
  const when = row.at ?? row.createdAt;
  const who = row.actor && row.actor === meId ? "You" : row.actor ? `User ${shortId(row.actor)}` : "System";
  const role = roleWord(row.actorRole);
  const StatusIcon = d.denied ? Ban : d.ok ? CircleCheck : CircleX;
  return (
    <li
      className={cn(
        "grid grid-cols-1 gap-x-4 gap-y-1.5 border-b border-[var(--line)] px-4 py-3.5 last:border-0 sm:grid-cols-[170px_minmax(0,1fr)_minmax(0,200px)] sm:items-center",
        broken && "bg-[var(--sev-critical-soft)]",
      )}
    >
      <p className="text-xs text-[var(--muted)]"><DateText value={when} withTime /></p>
      <div className="min-w-0">
        <p className="text-sm text-[var(--ink)]">
          <span className="font-medium">{who}</span>
          {role ? <span className="text-[var(--muted)]"> · {role}</span> : null}{" "}
          <span className="text-[var(--ink-2)]">{d.verb.charAt(0).toLowerCase() + d.verb.slice(1)}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-medium",
              d.denied ? "text-[var(--sev-high)]" : d.ok ? "text-[var(--confirmed)]" : "text-[var(--sev-critical)]",
            )}
          >
            <StatusIcon size={12} aria-hidden="true" />
            {d.denied ? "Blocked" : d.ok ? "Done" : "Failed"}
          </span>
          <span className="font-code truncate" title={row.action}>{row.action}</span>
        </p>
      </div>
      <div className="min-w-0 sm:text-right">
        {d.object.href ? (
          <Link
            href={d.object.href}
            className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-strong)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
          >
            <span className="truncate">{d.object.kind}{d.object.id ? <> · <span className="font-code">{shortId(d.object.id)}</span></> : null}</span>
            <ArrowUpRight size={12} className="shrink-0" aria-hidden="true" />
          </Link>
        ) : (
          <span className="text-xs text-[var(--muted)]">{d.object.kind}{d.object.id ? <> · <span className="font-code">{shortId(d.object.id)}</span></> : null}</span>
        )}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <Card pad={false}>
      <ul aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 border-b border-[var(--line)] px-4 py-3.5 last:border-0 sm:grid-cols-[170px_minmax(0,1fr)_200px] sm:items-center">
            <Skeleton className="h-3.5 w-32" />
            <div className="space-y-1.5"><Skeleton className="h-4 w-3/5" /><Skeleton className="h-3 w-2/5" /></div>
            <Skeleton className="h-3.5 w-28 sm:ml-auto" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------- page ---------- */

type Filters = { actor: string; kind: string; objectType: string; from: string; to: string };
const EMPTY_FILTERS: Filters = { actor: "", kind: "", objectType: "", from: "", to: "" };

export default function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = Object.values(filters).some(Boolean);

  const meQ = useQuery({ queryKey: ["me-full"], queryFn: () => accountApi.me(), enabled: !mocksEnabled(), staleTime: 5 * 60_000 });
  const meId = meQ.data?.user.id;

  const serverParams = useMemo(() => {
    const action = actionRegex(filters.kind, filters.objectType);
    return {
      action,
      actor: filters.actor === "me" ? meId : filters.actor || undefined,
      from: filters.from ? new Date(`${filters.from}T00:00:00+05:30`).toISOString() : undefined,
      to: filters.to ? new Date(`${filters.to}T23:59:59.999+05:30`).toISOString() : undefined,
    };
  }, [filters, meId]);

  const query = useInfiniteQuery({
    queryKey: ["audit", serverParams],
    enabled: !mocksEnabled(),
    initialPageParam: { cursor: undefined as string | undefined, to: serverParams.to },
    queryFn: ({ pageParam }) =>
      auditApi.list({
        ...serverParams,
        to: pageParam.to,
        cursor: pageParam.cursor,
        limit: String(PAGE_SIZE),
      }),
    // Server cursor when it gives one; otherwise page by time — the next page
    // ends 1 ms before the oldest entry already shown.
    getNextPageParam: (last) => {
      if (last.nextCursor) return { cursor: last.nextCursor, to: serverParams.to };
      if (last.items.length < PAGE_SIZE) return undefined;
      const oldest = last.items[last.items.length - 1];
      const stamp = oldest?.createdAt ?? oldest?.at;
      if (!stamp) return undefined;
      return { cursor: undefined, to: new Date(new Date(stamp).getTime() - 1).toISOString() };
    },
  });

  const verifyQ = useQuery({ queryKey: ["audit-verify"], queryFn: () => auditApi.verify(), enabled: false });
  const brokenAt = verifyQ.data && !verifyQ.data.valid ? verifyQ.data.brokenAt : undefined;

  const rows = useMemo(() => {
    const all = (query.data?.pages ?? []).flatMap((p) => p.items);
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      // actor filter is applied here too, in case the server ignores it
      if (filters.actor === "me" && meId && r.actor !== meId) return false;
      if (filters.actor && filters.actor !== "me" && r.actor !== filters.actor) return false;
      return true;
    });
  }, [query.data, filters.actor, meId]);

  const actorOptions = useMemo(() => {
    const ids = new Set((query.data?.pages ?? []).flatMap((p) => p.items.map((r) => r.actor)).filter((a): a is string => Boolean(a) && a !== meId));
    if (filters.actor && filters.actor !== "me") ids.add(filters.actor);
    return [...ids];
  }, [query.data, meId, filters.actor]);

  const exportCsv = () => {
    downloadCsv(
      `review-history-${isoDateIst(new Date().toISOString())}.csv`,
      ["When (IST)", "Who", "Role", "What", "Object type", "Object id", "Result", "Raw action", "Entry id", "Hash"],
      rows.map((r) => {
        const d = describeAudit(r);
        const when = r.at ?? r.createdAt;
        return [
          when ? new Date(when).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
          r.actor === meId ? "You" : r.actor ?? "",
          roleWord(r.actorRole) ?? "",
          d.verb, d.object.kind, d.object.id ?? "",
          d.denied ? "Blocked" : d.ok ? "Done" : "Failed",
          r.action, r.id, r.hash ?? "",
        ];
      }),
    );
  };

  return (
    <FadeIn className="space-y-5">
      <PageHeader
        title="Review history"
        description="Who did what, when — every change recorded in Satya, newest first. Entries are chained by fingerprint, so any edit after the fact shows up below."
        actions={rows.length ? <Btn variant="secondary" size="sm" onClick={exportCsv}>Export CSV</Btn> : undefined}
      />

      <ChainBanner />

      {/* filters */}
      <Card className="p-4">
        <form
          className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(5,minmax(0,1fr))_auto] md:items-end"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Filter review history"
        >
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="f-actor" className={labelCls}>Who</label>
            <select id="f-actor" className={selectCls} value={filters.actor} onChange={(e) => set({ actor: e.target.value })}>
              <option value="">Anyone</option>
              {meId ? <option value="me">You</option> : null}
              {actorOptions.map((a) => <option key={a} value={a}>User {shortId(a)}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="f-kind" className={labelCls}>Action</label>
            <select id="f-kind" className={selectCls} value={filters.kind} onChange={(e) => set({ kind: e.target.value })}>
              <option value="">Any action</option>
              {ACTION_KINDS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label htmlFor="f-object" className={labelCls}>Object</label>
            <select id="f-object" className={selectCls} value={filters.objectType} onChange={(e) => set({ objectType: e.target.value })}>
              <option value="">Anything</option>
              {OBJECT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className={labelCls}>From</label>
            <input id="f-from" type="date" className={selectCls} value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div>
            <label htmlFor="f-to" className={labelCls}>To</label>
            <input id="f-to" type="date" className={selectCls} value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </div>
          <div className="col-span-2 md:col-span-1">
            <Btn variant="ghost" size="md" icon={FilterX} disabled={!filtered} onClick={() => setFilters(EMPTY_FILTERS)} className="w-full md:w-auto">
              Clear
            </Btn>
          </div>
        </form>
      </Card>

      {mocksEnabled() ? (
        <EmptyState icon={History} title="Review history needs the live server" body="In demo mode there is no recorded history. Connect to a Satya server to see every change." />
      ) : query.error ? (
        <ErrorState
          message={
            query.error instanceof ApiError && query.error.status === 403
              ? "Your role cannot read the review history. Ask an administrator or auditor for access."
              : query.error instanceof Error ? query.error.message : "Something went wrong."
          }
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState icon={FilterX} title="No entries match these filters" body="Widen the date range or clear a filter to see more history." actionLabel="Clear filters" onAction={() => setFilters(EMPTY_FILTERS)} />
        ) : (
          <EmptyState icon={History} title="Nothing recorded yet" body="As people create orders, confirm documents or record decisions, each step is logged here automatically." />
        )
      ) : (
        <div className="space-y-3">
          <Card pad={false} className="overflow-hidden">
            <div className="hidden grid-cols-[170px_minmax(0,1fr)_minmax(0,200px)] gap-x-4 border-b border-[var(--line)] bg-[var(--surface-2)]/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)] sm:grid">
              <span>When (IST)</span><span>Who · what</span><span className="text-right">Object</span>
            </div>
            <ol aria-label="Review history entries">
              {rows.map((row) => <Entry key={row.id} row={row} meId={meId} broken={row.id === brokenAt} />)}
            </ol>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]"><span className="tnum">{rows.length}</span> entr{rows.length === 1 ? "y" : "ies"} shown</p>
            {query.hasNextPage ? (
              <Btn variant="secondary" size="sm" icon={query.isFetchingNextPage ? Loader2 : undefined} disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
                {query.isFetchingNextPage ? "Loading…" : "Load older entries"}
              </Btn>
            ) : (
              <p className="text-xs text-[var(--muted)]">That is the beginning of the history{filtered ? " for these filters" : ""}.</p>
            )}
          </div>
        </div>
      )}
    </FadeIn>
  );
}
