"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UploadCloud, FileDown, Loader2, X, ArrowRight, CheckCircle2, AlertTriangle, Sparkles, ScanSearch, RotateCcw } from "lucide-react";
import { importsApi, type ImportRun, type ImportRow, type ImportSource } from "@/lib/api/imports";
import { Btn, Money } from "@/components/ui/v2";
import { cn } from "@/lib/utils";
import { SOURCES, sourceMeta, TYPE_LABEL, ActionPill, Count, Section, Pill, errorText, type SourceMeta } from "./shared";

const MAX_MB = 10;

/* ---------- step 1: source ---------- */
function SourceCard({ meta, active, onPick }: { meta: SourceMeta; active: boolean; onPick: () => void }) {
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={cn(
        "group flex w-full items-start gap-3 rounded-[var(--radius-sm)] border p-3.5 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
        active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/60",
      )}
    >
      <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)]", active ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-2)] text-[var(--ink-2)]")}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-[var(--ink)]">{meta.label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[var(--muted)]">{meta.blurb}</span>
      </span>
    </button>
  );
}

/* ---------- step 2: file ---------- */
function DropZone({ accept, file, onFile, disabled }: { accept: string; file: File | null; onFile: (f: File | null) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f?: File | null) => {
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { toast.error(`That file is over ${MAX_MB} MB — split it (for example one month per file).`); return; }
    onFile(f);
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files?.[0]); }}
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed px-5 py-9 text-center transition-colors",
        over ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-strong)] bg-[var(--surface-2)]/40",
        disabled && "opacity-60",
      )}
    >
      {file ? (
        <div className="flex max-w-full items-center gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
          <CheckCircle2 size={18} className="shrink-0 text-[var(--confirmed)]" aria-hidden="true" />
          <span className="min-w-0 truncate text-[15px] font-medium text-[var(--ink)]">{file.name}</span>
          <span className="shrink-0 text-[13px] text-[var(--muted)]">{(file.size / 1024).toFixed(0)} KB</span>
          {!disabled ? (
            <button type="button" onClick={() => onFile(null)} className="shrink-0 rounded p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]" aria-label="Remove file">
              <X size={15} />
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <UploadCloud size={28} className="text-[var(--accent)]" aria-hidden="true" />
          <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">Drop the file here</p>
          <p className="mt-1 text-[13px] text-[var(--muted)]">or</p>
          <Btn variant="secondary" className="mt-2" onClick={() => input.current?.click()} disabled={disabled}>Choose a file</Btn>
          <p className="mt-3 text-[13px] text-[var(--muted)]">{accept.replaceAll(",", " · ")} · up to {MAX_MB} MB</p>
        </>
      )}
      <input ref={input} type="file" accept={accept} className="hidden" onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

function TemplateDownloads({ kind }: { kind: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const get = async (format: "csv" | "xlsx") => {
    setBusy(format);
    try { await importsApi.downloadTemplate(kind, format); } catch (e) { toast.error(errorText(e)); } finally { setBusy(null); }
  };
  const { data } = useQuery({ queryKey: ["import-templates"], queryFn: importsApi.templates, staleTime: 10 * 60_000 });
  const cols = data?.items.find((t) => t.kind === kind)?.columns ?? [];
  return (
    <div className="mb-4 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ink-2)]">Start from the template — or upload your own sheet; common headings like “Bill No” or “Vendor GSTIN” are recognised.</p>
        <div className="flex gap-2">
          <Btn size="sm" variant="secondary" icon={busy === "xlsx" ? Loader2 : FileDown} onClick={() => get("xlsx")} disabled={Boolean(busy)}>Excel template</Btn>
          <Btn size="sm" variant="ghost" icon={busy === "csv" ? Loader2 : FileDown} onClick={() => get("csv")} disabled={Boolean(busy)}>CSV</Btn>
        </div>
      </div>
      {cols.length ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
          Columns: {cols.map((c, i) => (
            <span key={c.key}>{i ? ", " : ""}<span className={c.required ? "font-medium text-[var(--ink-2)]" : undefined}>{c.label}{c.required ? " *" : ""}</span></span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/* ---------- step 3: preview ---------- */
const ACTION_FILTERS = [["", "All"], ["create", "New"], ["update", "Updated"], ["duplicate", "Already in Satya"], ["error", "Needs fixing"]] as const;

function RowsTable({ rows, bank }: { rows: ImportRow[]; bank: boolean }) {
  const [filter, setFilter] = useState<string>("");
  const shown = filter ? rows.filter((r) => r.action === filter) : rows;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter rows">
        {ACTION_FILTERS.map(([value, label]) => {
          const n = value ? rows.filter((r) => r.action === value).length : rows.length;
          if (value && !n) return null;
          return (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={cn("rounded-full px-3 py-1 text-[13px] font-medium transition-colors", filter === value ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-2)] text-[var(--ink-2)] hover:bg-[var(--surface-3)]")}>
              {label} <span className="tnum opacity-75">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-[var(--radius-sm)] border border-[var(--line)]">
        <ul className="max-h-[420px] divide-y divide-[var(--line)] overflow-y-auto">
          {shown.map((r, i) => (
            <li key={`${r.ref}-${i}`} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-[var(--ink)]">
                  {bank ? (r.party || r.label) : r.label}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">
                  {[r.ref, TYPE_LABEL[r.kind] ?? r.kind, r.date, bank ? r.label : r.party, r.utr ? `UTR ${r.utr}` : null, r.matchedBy ? `supplier matched by ${r.matchedBy.replace("_", " ")}` : null].filter(Boolean).join(" · ")}
                </p>
                {r.notes?.length ? <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">{r.notes.join("; ")}</p> : null}
                {r.changes?.length ? <p className="mt-0.5 text-[13px] text-[var(--ink-2)]">Adds: {r.changes.join(", ")}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {r.amount ? <span className={cn("text-[15px] font-medium tnum", r.direction === "credit" ? "text-[var(--confirmed)]" : "text-[var(--ink)]")}>{r.direction === "credit" ? "+" : ""}<Money value={r.amount} /></span> : null}
                <ActionPill action={r.action} />
              </div>
            </li>
          ))}
          {!shown.length ? <li className="px-4 py-6 text-center text-sm text-[var(--muted)]">Nothing in this view.</li> : null}
        </ul>
      </div>
      {rows.length >= 200 ? <p className="mt-2 text-[13px] text-[var(--muted)]">Showing the first 200 records; the import covers the whole file.</p> : null}
    </div>
  );
}

function Detected({ run }: { run: ImportRun }) {
  const d = run.detected;
  if (!d) return null;
  const items: string[] = [];
  if (run.source === "bank_statement") {
    if (d.bank) items.push(d.bank === "MT940" ? "MT940 statement" : d.bank === "generic" ? "Bank layout recognised" : `${d.bank} statement layout`);
    if (d.account) items.push(`account ${d.account}`);
    if (d.headerRow) items.push(`headings on row ${d.headerRow}`);
    if (typeof d.lines === "number") items.push(`${d.lines} lines`);
  }
  if (d.tally) {
    items.push(`${d.tally.vouchers} vouchers, ${d.tally.suppliers} supplier ledgers, ${d.tally.items} stock items`);
    const skipped = Object.entries(d.tally.skipped || {});
    if (skipped.length) items.push(`skipped: ${skipped.map(([k, n]) => `${n} ${k}`).join(", ")}`);
  }
  if (run.source === "gstr2b_json" && d.period) items.push(`return period ${d.period}`);
  if (d.template && d.headerRow) items.push(`headings on row ${d.headerRow}`);
  if (d.ignoredColumns?.length) items.push(`ignored columns: ${d.ignoredColumns.join(", ")}`);
  const columns = d.columns && run.source === "bank_statement" ? Object.entries(d.columns) : [];
  return (
    <div className="mb-5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)]/40 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]"><ScanSearch size={15} className="text-[var(--accent)]" aria-hidden="true" /> What we found</p>
      {items.length ? <p className="mt-1 text-[14px] text-[var(--ink-2)]">{items.join(" · ")}</p> : null}
      {columns.length ? (
        <p className="mt-1.5 text-[13px] text-[var(--muted)]">
          Columns: {columns.map(([role, header], i) => <span key={role}>{i ? " · " : ""}{role} → <span className="text-[var(--ink-2)]">{header}</span></span>)}
        </p>
      ) : null}
      {d.previouslyCommitted ? <p className="mt-1.5 text-[13px] text-[var(--sev-medium)]">This exact file was imported before — anything already in Satya is skipped.</p> : null}
    </div>
  );
}

function Issues({ run }: { run: ImportRun }) {
  const issues = run.issues ?? [];
  const [all, setAll] = useState(false);
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  const shown = all ? sorted : sorted.slice(0, 8);
  const errors = issues.filter((i) => i.severity === "error").length;
  return (
    <div className="mb-5">
      <p className="mb-2 text-sm font-medium text-[var(--ink)]">
        {errors ? `${errors} row${errors === 1 ? "" : "s"} need fixing` : "Worth a look"}{issues.length - errors ? ` · ${issues.length - errors} warning${issues.length - errors === 1 ? "" : "s"}` : ""}
        {errors ? <span className="ml-1 font-normal text-[var(--muted)]">— those rows are skipped; everything else can be imported.</span> : null}
      </p>
      <ul className="space-y-1.5">
        {shown.map((i, n) => (
          <li key={n} className={cn("flex gap-2.5 rounded-[var(--radius-sm)] border px-3 py-2 text-[14px]", i.severity === "error" ? "border-[color-mix(in_srgb,var(--sev-critical)_30%,transparent)] bg-[var(--sev-critical-soft)]" : "border-[color-mix(in_srgb,var(--sev-medium)_30%,transparent)] bg-[var(--sev-medium-soft)]")}>
            <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: i.severity === "error" ? "var(--sev-critical)" : "var(--sev-medium)" }} aria-hidden="true" />
            <span className="min-w-0 text-[var(--ink)]">
              {i.ref ? <span className="font-medium">{i.ref}{i.field ? ` · ${i.field.replaceAll("_", " ")}` : ""}: </span> : null}
              {i.message}
            </span>
          </li>
        ))}
      </ul>
      {issues.length > 8 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[13px] font-medium text-[var(--accent)] hover:underline">
          {all ? "Show fewer" : `Show all ${run.issueCount ?? issues.length}`}
        </button>
      ) : null}
    </div>
  );
}

function PreviewCounts({ run }: { run: ImportRun }) {
  const s = run.summary ?? {};
  if (run.source === "bank_statement") {
    return (
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Count label="New transactions" value={s.create ?? 0} tone="good" hint={`${s.byType?.PAYMENT_OUT?.create ?? 0} paid · ${s.byType?.PAYMENT_IN?.create ?? 0} received`} />
        <Count label="Already imported" value={s.duplicate ?? 0} tone="muted" hint="same UTR or line" />
        <Count label="Supplier recognised" value={s.counterpartyResolved ?? 0} hint={`of ${s.debits ?? 0} payments out`} />
        <Count label="Unreadable lines" value={s.error ?? 0} tone={s.error ? "bad" : "muted"} />
      </div>
    );
  }
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
      <Count label="New" value={s.create ?? 0} tone="good" />
      <Count label="Updated" value={s.update ?? 0} hint={s.unchanged ? `${s.unchanged} already up to date` : undefined} />
      <Count label="Already in Satya" value={s.duplicate ?? 0} tone="muted" hint="skipped" />
      <Count label="Need fixing" value={s.error ?? 0} tone={s.error ? "bad" : "muted"} hint={s.warnings ? `${s.warnings} warnings` : undefined} />
    </div>
  );
}

/* ---------- after commit ---------- */
export function RunOutcome({ runId, onAnother }: { runId: string; onAnother?: () => void }) {
  const { data: run } = useQuery({
    queryKey: ["import-run", runId],
    queryFn: () => importsApi.run(runId),
    refetchInterval: (q) => {
      const r = q.state.data;
      if (!r) return 2000;
      const allocPending = r.result?.allocation?.status === "queued";
      return r.live?.checksRunning || allocPending || !r.checks ? 2500 : false;
    },
  });
  if (!run) return <div className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  const res = run.result ?? {};
  const running = Boolean(run.live?.checksRunning || res.allocation?.status === "queued" || (!run.checks && (run.createdCount ?? run.documents?.length ?? 0) > 0));
  const created = res.created ?? res.create ?? 0;
  const review = run.documents.filter((d) => d.review === "needs_review" || d.review === "waiting_for_reference");
  const autoAllocated = run.documents.filter((d) => d.review === "auto_allocated");
  const cases = [...new Set(run.documents.map((d) => d.caseId).filter(Boolean))] as string[];
  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--confirmed-soft)]"><CheckCircle2 size={20} className="text-[var(--confirmed)]" aria-hidden="true" /></span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[var(--ink)]">Imported {created} record{created === 1 ? "" : "s"}{res.update ? `, updated ${res.update}` : ""}</p>
          <p className="text-[14px] text-[var(--muted)]">
            {running ? <span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" aria-hidden="true" /> Running checks — linking documents, matching and reconciling…</span> : "Checks finished."}
          </p>
        </div>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Count label="Cases checked" value={run.caseIds?.length ?? 0} hint={run.checks?.casesCreated ? `${run.checks.casesCreated} new` : undefined} />
        <Count label="Linked automatically" value={(run.checks?.linksCreated ?? 0) + (res.allocation?.autoAllocated ?? 0) + (run.checks?.bound ?? 0)} tone="good" hint={res.allocation?.autoAllocated ? `${res.allocation.autoAllocated} payments allocated` : undefined} />
        <Count label="Issues found" value={run.live?.openFindings ?? 0} tone={run.live?.openFindings ? "warn" : "muted"} />
        <Count label="Waiting for review" value={run.live?.waitingForReview ?? 0} tone={run.live?.waitingForReview ? "warn" : "muted"} hint={run.live?.linkSuggestions ? `${run.live.linkSuggestions} link suggestions` : undefined} />
      </div>
      {res.gstr2b ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <Pill tone="create">{res.gstr2b.matched} matched</Pill>
          {res.gstr2b.amountDiffers ? <Pill tone="warning">{res.gstr2b.amountDiffers} amount differs</Pill> : null}
          {res.gstr2b.onlyInBooks ? <Pill tone="error">{res.gstr2b.onlyInBooks} missing from 2B</Pill> : null}
          {res.gstr2b.onlyIn2b ? <Pill tone="warning">{res.gstr2b.onlyIn2b} only in 2B</Pill> : null}
          {res.gstr2b.pending2b ? <Pill tone="unchanged">{res.gstr2b.pending2b} awaiting a later 2B</Pill> : null}
        </div>
      ) : null}
      {autoAllocated.length ? (
        <div className="mb-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--ink)]"><Sparkles size={15} className="text-[var(--accent)]" aria-hidden="true" /> Allocated automatically (exact amount and invoice named in the narration)</p>
          <ul className="space-y-1">
            {(res.allocation?.details ?? []).filter((x) => x.status === "auto_allocated").map((x) => (
              <li key={x.paymentId} className="text-[14px] text-[var(--ink-2)]">₹{x.amount} → {x.invoice}{x.rule === "exact_net_of_tds" ? " (net of TDS)" : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.findings.length ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-[var(--ink)]">Issues raised</p>
          <ul className="space-y-1.5">
            {run.findings.slice(0, 8).map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="min-w-0 text-[14px] text-[var(--ink)]">{f.message || f.title || f.code}</span>
                <Link href={`/app/investigations/${f.caseId}`} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[var(--accent)] hover:underline">Open case <ArrowRight size={12} /></Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.length ? (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-[var(--ink)]">Waiting for you</p>
          <ul className="space-y-1">
            {review.slice(0, 8).map((d) => (
              <li key={d.id} className="text-[14px] text-[var(--ink-2)]">
                {TYPE_LABEL[d.type] ?? d.type} {d.number} {d.party ? `· ${d.party}` : ""} — <span className="text-[var(--muted)]">{d.review === "waiting_for_reference" ? "waiting for the document it refers to" : d.reviewReason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {review.some((d) => d.type.startsWith("PAYMENT")) || run.source === "bank_statement" ? <Link href="/app/payments"><Btn variant="secondary" icon={ArrowRight}>Review payments</Btn></Link> : null}
        {cases.length === 1 ? <Link href={`/app/investigations/${cases[0]}`}><Btn variant="secondary" icon={ArrowRight}>Open the case</Btn></Link> : null}
        {run.source === "gstr2b_json" ? <Link href="/app/compliance"><Btn variant="secondary" icon={ArrowRight}>Compliance</Btn></Link> : null}
        {onAnother ? <Btn variant="ghost" icon={RotateCcw} onClick={onAnother}>Import another file</Btn> : null}
      </div>
    </div>
  );
}

/* ---------- the flow ---------- */
export function NewImport({ entityId, canImport }: { entityId: string; canImport: boolean }) {
  const qc = useQueryClient();
  const [source, setSource] = useState<ImportSource>("tally_xml");
  const [file, setFile] = useState<File | null>(null);
  const [direction, setDirection] = useState<"both" | "debits">("both");
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [preview, setPreview] = useState<ImportRun | null>(null);
  const [committedId, setCommittedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = sourceMeta(source)!;
  const systems = useMemo(() => SOURCES.filter((s) => s.group === "systems"), []);
  const templates = useMemo(() => SOURCES.filter((s) => s.group === "templates"), []);

  const reset = useCallback(() => { setFile(null); setPreview(null); setCommittedId(null); setError(null); }, []);
  const pick = (s: ImportSource) => { setSource(s); reset(); };

  const runPreview = async () => {
    if (!file) return;
    setBusy("preview"); setError(null); setPreview(null);
    try {
      const run = await importsApi.preview({ file, source, entityId, options: source === "bank_statement" ? { direction, autoAllocate } : undefined });
      setPreview(run);
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };
  const runCommit = async () => {
    if (!preview) return;
    setBusy("commit"); setError(null);
    try {
      const run = await importsApi.commit(preview.id, source === "bank_statement" ? { autoAllocate } : undefined);
      setCommittedId(run.id);
      toast.success("Imported — checks are running in the background");
      qc.invalidateQueries({ queryKey: ["import-runs"] });
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  };

  const toImport = (preview?.summary?.create ?? 0) + (preview?.summary?.update ?? 0);

  return (
    <div className="space-y-5">
      <Section step={1} title="Where is the data from?">
        <div className="grid gap-2.5 md:grid-cols-3">
          {systems.map((s) => <SourceCard key={s.source} meta={s} active={source === s.source} onPick={() => pick(s.source)} />)}
        </div>
        <p className="mb-2.5 mt-5 text-[13px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">Spreadsheet templates (CSV or Excel)</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Template type">
          {templates.map((s) => {
            const Icon = s.icon;
            const active = source === s.source;
            return (
              <button key={s.source} type="button" aria-pressed={active} onClick={() => pick(s.source)} title={s.blurb}
                className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[14px] font-medium transition-colors",
                  active ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}>
                <Icon size={14} aria-hidden="true" /> {s.label}
              </button>
            );
          })}
        </div>
      </Section>

      {!committedId ? (
        <Section step={2} title={`Upload — ${meta.label}`}>
          {meta.group === "templates" ? <TemplateDownloads kind={source.replace("template:", "")} /> : null}
          {source === "tally_xml" ? (
            <p className="mb-4 text-[14px] leading-relaxed text-[var(--ink-2)]">
              In TallyPrime: <span className="font-medium">Day Book → Alt+E Export → XML (Data Interchange)</span>; masters via <span className="font-medium">Export → Masters → All Masters</span>. For a daily automatic sync, see the “Automatic sync (Tally)” tab.
            </p>
          ) : null}
          {source === "bank_statement" ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px] text-[var(--ink-2)]">
              <label className="inline-flex items-center gap-2">
                Import
                <select value={direction} onChange={(e) => setDirection(e.target.value as "both" | "debits")} disabled={Boolean(preview)}
                  className="h-9 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-[14px] text-[var(--ink)]">
                  <option value="both">all transactions</option>
                  <option value="debits">payments out only</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={autoAllocate} onChange={(e) => setAutoAllocate(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                Allocate automatically when the amount and invoice number match exactly
              </label>
            </div>
          ) : null}
          <DropZone accept={meta.accept} file={file} onFile={(f) => { setFile(f); setPreview(null); setError(null); }} disabled={Boolean(busy)} />
          {error ? <p role="alert" className="mt-4 rounded-[var(--radius-sm)] border border-[color-mix(in_srgb,var(--sev-critical)_35%,transparent)] bg-[var(--sev-critical-soft)] px-4 py-3 text-[14px] text-[var(--ink)]">{error}</p> : null}
          {!preview ? (
            <div className="mt-4 flex justify-end">
              <Btn size="lg" icon={busy === "preview" ? Loader2 : ScanSearch} onClick={runPreview} disabled={!file || Boolean(busy) || !canImport || !entityId}>
                {busy === "preview" ? "Checking the file…" : "Check the file"}
              </Btn>
            </div>
          ) : null}
          {!canImport ? <p className="mt-3 text-[13px] text-[var(--muted)]">Your role can view imports but not run them.</p> : null}
        </Section>
      ) : null}

      {preview && !committedId ? (
        <Section step={3} title="Check before importing">
          <Detected run={preview} />
          <PreviewCounts run={preview} />
          <Issues run={preview} />
          <RowsTable rows={preview.sample ?? []} bank={preview.source === "bank_statement"} />
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Btn variant="ghost" onClick={reset} disabled={busy === "commit"}>Start over</Btn>
            <Btn size="lg" icon={busy === "commit" ? Loader2 : CheckCircle2} onClick={runCommit} disabled={!preview.canCommit || Boolean(busy)}>
              {busy === "commit" ? "Importing…" : preview.canCommit ? `Import ${toImport} record${toImport === 1 ? "" : "s"}` : "Nothing new to import"}
            </Btn>
          </div>
        </Section>
      ) : null}

      {committedId ? (
        <Section step={3} title="Imported">
          <RunOutcome runId={committedId} onAnother={reset} />
        </Section>
      ) : null}
    </div>
  );
}
