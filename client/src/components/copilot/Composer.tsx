"use client";

// The composer: a large rounded box with the question, attached documents,
// and the agent controls — mode (Ask · Analyse · Draft · Plan payments),
// options (calculations, screening, confirmed links, scope), attach, and a
// "/" command menu. Enter sends · Shift+Enter new line · Esc stops ·
// ↑ in an empty box recalls the last question.

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ArrowUp, Building2, Calculator, CalendarRange, Check, ChevronDown, FileText, Link2, Loader2, Paperclip, Radar, ShieldCheck, SlidersHorizontal, Square, Truck, X, AlertCircle,
} from "lucide-react";
import type { AgentMode, AgentOptions, AttachmentSummary, SupplierOption } from "@/lib/api/copilot";
import { searchSuppliers, docKindLabel } from "@/lib/api/copilot";
import { MODE_META, SLASH_COMMANDS, type SlashCommand } from "./modes";
import { Popover, SwitchRow } from "./Popover";
import { inr, shortDate } from "./format";
import { cn } from "@/lib/utils";

export type ComposerHandle = { focus: () => void; setText: (text: string) => void };

export type Attachment = {
  id: string;
  name: string;
  size: number;
  phase: "uploading" | "reading" | "ready" | "failed";
  draftId?: string | null;
  summary?: AttachmentSummary;
  error?: string;
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_MB = 10;

/* ------------------------------------------------------------ helpers */

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const PERIODS: { label: string; range: () => [string, string] }[] = [
  { label: "This month", range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(n)]; } },
  { label: "Last month", range: () => { const n = new Date(); return [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))]; } },
  { label: "This quarter", range: () => { const n = new Date(); const q = Math.floor(n.getMonth() / 3) * 3; return [ymd(new Date(n.getFullYear(), q, 1)), ymd(n)]; } },
  { label: "This FY", range: () => { const n = new Date(); const y = n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1; return [`${y}-04-01`, ymd(n)]; } },
];

function activeOptionCount(o: AgentOptions) {
  return [o.showWorking, o.includeScreening, o.confirmedOnly, o.scope.supplierId, o.scope.from || o.scope.to, o.scope.entityId].filter(Boolean).length;
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove?: () => void; label: string }) {
  return (
    <span className="sx-fade inline-flex h-7 max-w-[220px] items-center gap-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] pl-2.5 pr-1 text-[12.5px] font-medium text-[var(--accent-strong)]">
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-[var(--accent)]/15">
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------- supplier pick */

function SupplierPicker({ value, onChange }: { value: { id?: string | null; name?: string | null }; onChange: (s: SupplierOption | null) => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setItems([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchSuppliers(term).then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value.id) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2 text-[14px]">
        <Truck size={14} className="text-[var(--muted)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">{value.name || "Selected supplier"}</span>
        <button type="button" onClick={() => onChange(null)} className="text-[12.5px] font-medium text-[var(--accent-strong)] hover:underline">Change</button>
      </div>
    );
  }
  return (
    <div>
      <label className="sr-only" htmlFor="sx-sup-q">Search suppliers</label>
      <input
        id="sx-sup-q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a supplier by name or GSTIN"
        autoComplete="off"
        className="h-10 w-full rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[14px] text-[var(--ink)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-soft)]"
      />
      {(loading || items.length > 0 || q.trim().length >= 2) && (
        <ul className="mt-1 max-h-44 overflow-y-auto rounded-[10px] border border-[var(--line)] sx-scroll" role="listbox" aria-label="Suppliers">
          {loading && <li className="px-3 py-2 text-[13px] text-[var(--muted)]">Searching…</li>}
          {!loading && !items.length && <li className="px-3 py-2 text-[13px] text-[var(--muted)]">No supplier matches “{q.trim()}”</li>}
          {items.map((s) => (
            <li key={s.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => onChange(s)} className="flex w-full flex-col px-3 py-2 text-left hover:bg-[var(--surface-2)]">
                <span className="text-[14px] text-[var(--ink)]">{s.name}</span>
                {s.gstin ? <span className="font-code text-[11.5px] text-[var(--muted)]">{s.gstin}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ composer */

export const Composer = forwardRef<ComposerHandle, {
  value: string;
  onChange: (v: string) => void;
  onSend: (text?: string) => void;
  onStop: () => void;
  busy: boolean;
  lastQuestion?: string;
  placeholder?: string;
  options: AgentOptions;
  onOptionsChange: (o: AgentOptions) => void;
  attachments: Attachment[];
  onAttach: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  entities?: { id: string; name: string }[];
}>(function Composer({ value, onChange, onSend, onStop, busy, lastQuestion, placeholder, options, onOptionsChange, attachments, onAttach, onRemoveAttachment, entities = [] }, ref) {
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeBtn = useRef<HTMLButtonElement>(null);
  const optBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"mode" | "options" | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (text: string) => {
      onChange(text);
      requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(text.length, text.length);
      });
    },
  }), [onChange]);

  // auto-grow up to ~9 lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    el.style.overflowY = el.scrollHeight > 240 ? "auto" : "hidden";
  }, [value]);

  const slashQuery = /^\/[\w-]*$/.test(value) ? value.slice(1).toLowerCase() : null;
  const slashItems = useMemo(
    () => (slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashQuery) || c.label.toLowerCase().includes(slashQuery))),
    [slashQuery],
  );
  useEffect(() => setSlashIndex(0), [slashQuery]);

  const runCommand = (c: SlashCommand) => {
    if (c.mode && c.mode !== options.mode) onOptionsChange({ ...options, mode: c.mode });
    if (c.send) {
      onChange("");
      onSend(c.send);
      return;
    }
    const text = c.text ?? "";
    onChange(text);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(text.length, text.length);
    });
  };

  const setMode = (mode: AgentMode) => {
    onOptionsChange({ ...options, mode });
    setMenu(null);
    area.current?.focus();
  };
  const setScope = (patch: Partial<AgentOptions["scope"]>) => onOptionsChange({ ...options, scope: { ...options.scope, ...patch } });
  const ready = attachments.filter((a) => a.phase === "ready");
  const pending = attachments.some((a) => a.phase === "uploading" || a.phase === "reading");
  const canSend = !busy && !pending && (value.trim().length > 0 || ready.length > 0);
  const meta = MODE_META[options.mode];
  const count = activeOptionCount(options);
  const entityName = entities.find((e) => e.id === options.scope.entityId)?.name;

  const pickFiles = (list: FileList | null) => {
    const files = [...(list ?? [])].slice(0, 3);
    if (files.length) onAttach(files);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pickFiles(e.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-[24px] border bg-[var(--surface)] shadow-[var(--shadow-2)] transition-[border-color,box-shadow] duration-200",
        dragging ? "border-[var(--accent)] shadow-[0_0_0_4px_var(--accent-soft)]" : "border-[var(--line-strong)] focus-within:border-[var(--accent)]/55 focus-within:shadow-[0_0_0_4px_var(--accent-soft),var(--shadow-2)]",
      )}
    >
      {/* "/" commands */}
      {slashQuery !== null && slashItems.length > 0 && (
        <div role="listbox" id="sx-slash" aria-label="Commands" className="sx-rise absolute bottom-[calc(100%+10px)] left-0 right-0 z-40 overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-3)] sm:right-auto sm:w-[420px]">
          <p className="px-3 pb-1 pt-1.5 text-[12px] font-medium text-[var(--muted)]">Commands</p>
          {slashItems.map((c, i) => (
            <button
              key={c.cmd}
              type="button"
              role="option"
              id={`sx-slash-${i}`}
              aria-selected={i === slashIndex}
              onMouseEnter={() => setSlashIndex(i)}
              onClick={() => runCommand(c)}
              className={cn("flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left", i === slashIndex ? "bg-[var(--surface-2)]" : "")}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[var(--accent-soft)] text-[var(--accent-strong)]"><c.icon size={15} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="font-code text-[13px] text-[var(--ink)]">{c.cmd}</span>
                  <span className="truncate text-[13.5px] font-medium text-[var(--ink-2)]">{c.label}</span>
                </span>
                <span className="block truncate text-[12px] text-[var(--muted)]">{c.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((a) => (
            <div key={a.id} className={cn("sx-rise flex max-w-full items-center gap-2.5 rounded-[12px] border px-3 py-2", a.phase === "failed" ? "border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)]" : "border-[var(--line)] bg-[var(--surface-2)]/60")}>
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[8px]", a.phase === "ready" ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--surface)] text-[var(--muted)]")}>
                {a.phase === "uploading" || a.phase === "reading" ? <Loader2 size={15} className="sx-spin" aria-hidden="true" /> : a.phase === "failed" ? <AlertCircle size={15} className="text-[var(--sev-critical)]" aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="block max-w-[220px] truncate text-[13.5px] font-medium text-[var(--ink)]">
                  {a.summary?.number ? `${docKindLabel(a.summary.type)} ${a.summary.number}` : a.name}
                </span>
                <span className="block max-w-[260px] truncate text-[12px] text-[var(--muted)]" aria-live="polite">
                  {a.phase === "uploading" ? "Uploading…" : a.phase === "reading" ? "Reading the document…" : a.phase === "failed" ? a.error || "Couldn't read this file" : [a.summary?.supplier, a.summary?.total ? inr(a.summary.total) : null, a.summary?.date ? shortDate(a.summary.date) : null].filter(Boolean).join(" · ") || "Ready — ask about it"}
                </span>
              </span>
              <button type="button" onClick={() => onRemoveAttachment(a.id)} aria-label={`Remove ${a.name}`} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]">
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <label htmlFor="ask-input" className="sr-only">Ask Satya</label>
      <textarea
        id="ask-input"
        ref={area}
        value={value}
        rows={1}
        maxLength={2000}
        aria-autocomplete="list"
        aria-controls={slashQuery !== null && slashItems.length ? "sx-slash" : undefined}
        aria-activedescendant={slashQuery !== null && slashItems.length ? `sx-slash-${slashIndex}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.files].filter((f) => ACCEPT.includes(f.type));
          if (files.length) {
            e.preventDefault();
            onAttach(files.slice(0, 3));
          }
        }}
        onKeyDown={(e) => {
          if (slashQuery !== null && slashItems.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashItems.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); runCommand(slashItems[slashIndex]); return; }
            if (e.key === "Escape") { e.preventDefault(); onChange(""); return; }
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          } else if (e.key === "Escape" && busy) {
            e.preventDefault();
            onStop();
          } else if (e.key === "ArrowUp" && !value && lastQuestion) {
            e.preventDefault();
            onChange(lastQuestion);
          }
        }}
        placeholder={ready.length ? "Ask about this document — e.g. “Is this invoice OK to pay?”" : placeholder ?? meta.placeholder}
        className="block max-h-[240px] min-h-[56px] w-full resize-none bg-transparent px-5 pb-1 pt-4 text-[16px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none"
      />

      {/* toolbar */}
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ""; }} />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busy || attachments.length >= 3}
          aria-label={`Attach a document (PDF or image, up to ${MAX_MB} MB)`}
          title="Attach an invoice, PO or receipt"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-40"
        >
          <Paperclip size={17} aria-hidden="true" />
        </button>

        <div className="relative">
          <button
            ref={modeBtn}
            type="button"
            onClick={() => setMenu((m) => (m === "mode" ? null : "mode"))}
            aria-haspopup="dialog"
            aria-expanded={menu === "mode"}
            className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium transition-colors", options.mode === "ask" ? "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]" : "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent-strong)]")}
          >
            <meta.icon size={15} aria-hidden="true" />
            <span className="hidden min-[400px]:inline">{meta.short}</span>
            <ChevronDown size={13} className={cn("opacity-70 transition-transform duration-200", menu === "mode" && "rotate-180")} aria-hidden="true" />
          </button>
        </div>

        <div className="relative">
          <button
            ref={optBtn}
            type="button"
            onClick={() => setMenu((m) => (m === "options" ? null : "options"))}
            aria-haspopup="dialog"
            aria-expanded={menu === "options"}
            aria-label={`Agent options${count ? ` (${count} on)` : ""}`}
            title="Options"
            className={cn("relative grid h-9 w-9 place-items-center rounded-full transition-colors", count ? "text-[var(--accent-strong)] hover:bg-[var(--accent-soft)]" : "text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            {count ? <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-[var(--on-accent)]">{count}</span> : null}
          </button>
        </div>

        {/* active option chips (desktop) */}
        <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sx-scroll md:flex">
          {options.scope.supplierId ? <Chip label="supplier scope" onRemove={() => setScope({ supplierId: null, supplierName: null })}>{options.scope.supplierName || "Supplier"}</Chip> : null}
          {options.scope.from || options.scope.to ? <Chip label="period" onRemove={() => setScope({ from: null, to: null })}>{options.scope.from ? shortDate(options.scope.from) : "Start"} – {options.scope.to ? shortDate(options.scope.to) : "today"}</Chip> : null}
          {options.scope.entityId ? <Chip label="entity" onRemove={() => setScope({ entityId: null })}>{entityName || "Entity"}</Chip> : null}
          {options.showWorking ? <Chip label="show calculations" onRemove={() => onOptionsChange({ ...options, showWorking: false })}>Calculations</Chip> : null}
          {options.includeScreening ? <Chip label="screening signals" onRemove={() => onOptionsChange({ ...options, includeScreening: false })}>Screening</Chip> : null}
          {options.confirmedOnly ? <Chip label="confirmed links only" onRemove={() => onOptionsChange({ ...options, confirmedOnly: false })}>Confirmed links</Chip> : null}
        </div>
        <div className="flex-1 md:hidden" />

        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop generating (Esc)" title="Stop generating (Esc)" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[var(--paper)] transition-transform active:scale-95">
            <span className="sx-spin absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--accent)]" aria-hidden="true" />
            <Square size={13} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send (Enter)"
            title="Send (Enter)"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-1)] transition-all hover:bg-[var(--accent-strong)] active:scale-95 disabled:bg-[var(--line-strong)] disabled:text-[var(--surface)] disabled:shadow-none"
          >
            <ArrowUp size={19} strokeWidth={2.4} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* mode menu */}
      <Popover open={menu === "mode"} onClose={() => setMenu(null)} label="Choose a mode" anchor={modeBtn}>
        <p className="px-3 pb-1 pt-1.5 text-[12px] font-medium text-[var(--muted)]">How should Satya work?</p>
        {(Object.keys(MODE_META) as AgentMode[]).map((m) => {
          const mm = MODE_META[m];
          const on = options.mode === m;
          return (
            <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={on} className={cn("flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors", on ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]")}>
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-[8px]", on ? "bg-[var(--accent)] text-[var(--on-accent)]" : "bg-[var(--surface-2)] text-[var(--ink-2)]")}><mm.icon size={16} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-[var(--ink)]">{mm.label}</span>
                <span className="block text-[12.5px] leading-snug text-[var(--muted)]">{mm.description}</span>
              </span>
              {on ? <Check size={16} className="mt-1 text-[var(--accent-strong)]" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </Popover>

      {/* options */}
      <Popover open={menu === "options"} onClose={() => setMenu(null)} label="Agent options" anchor={optBtn} className="sm:left-12">
        <p className="px-3 pb-1 pt-1.5 text-[12px] font-medium text-[var(--muted)]">Answer</p>
        <SwitchRow icon={<Calculator size={16} />} label="Show my calculations" hint="Adds “How we calculated” — exact arithmetic on your figures" checked={options.showWorking} onChange={(v) => onOptionsChange({ ...options, showWorking: v })} />
        <SwitchRow icon={<Radar size={16} />} label="Include screening signals" hint="Statistical red flags (unusual prices, amounts just under limits)" checked={options.includeScreening} onChange={(v) => onOptionsChange({ ...options, includeScreening: v })} />
        <SwitchRow icon={<Link2 size={16} />} label="Use only confirmed links" hint="Ignore document links a model suggested but nobody confirmed" checked={options.confirmedOnly} onChange={(v) => onOptionsChange({ ...options, confirmedOnly: v })} />
        <SwitchRow icon={<ShieldCheck size={16} />} label="Cite every figure" hint="Always on — every number is checked against your records" checked disabled />
        <div className="my-2 border-t border-[var(--line)]" />
        <p className="px-3 pb-1.5 text-[12px] font-medium text-[var(--muted)]">Scope — only look at</p>
        <div className="space-y-3 px-3 pb-2">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-2)]"><Truck size={14} aria-hidden="true" /> Supplier</p>
            <SupplierPicker value={{ id: options.scope.supplierId, name: options.scope.supplierName }} onChange={(s) => setScope({ supplierId: s?.id ?? null, supplierName: s?.name ?? null })} />
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-2)]"><CalendarRange size={14} aria-hidden="true" /> Period</p>
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {PERIODS.map((p) => {
                const [from, to] = p.range();
                const on = options.scope.from === from && options.scope.to === to;
                return (
                  <button key={p.label} type="button" onClick={() => setScope(on ? { from: null, to: null } : { from, to })} aria-pressed={on} className={cn("rounded-full border px-2.5 py-1 text-[12.5px]", on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]")}>
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="sx-from">From</label>
              <input id="sx-from" type="date" value={options.scope.from ?? ""} onChange={(e) => setScope({ from: e.target.value || null })} className="h-9 min-w-0 flex-1 rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-2 text-[13.5px] text-[var(--ink)]" />
              <span className="text-[12px] text-[var(--muted)]">to</span>
              <label className="sr-only" htmlFor="sx-to">To</label>
              <input id="sx-to" type="date" value={options.scope.to ?? ""} onChange={(e) => setScope({ to: e.target.value || null })} className="h-9 min-w-0 flex-1 rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-2 text-[13.5px] text-[var(--ink)]" />
            </div>
          </div>
          {entities.length > 1 && (
            <div>
              <label htmlFor="sx-entity" className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink-2)]"><Building2 size={14} aria-hidden="true" /> Entity</label>
              <select id="sx-entity" value={options.scope.entityId ?? ""} onChange={(e) => setScope({ entityId: e.target.value || null })} className="h-9 w-full rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-2 text-[13.5px] text-[var(--ink)]">
                <option value="">The entity selected at the top</option>
                {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
          )}
        </div>
        {count > 0 && (
          <div className="border-t border-[var(--line)] px-3 pb-1 pt-2">
            <button type="button" onClick={() => onOptionsChange({ ...options, showWorking: false, includeScreening: false, confirmedOnly: false, scope: {} })} className="text-[13px] font-medium text-[var(--accent-strong)] hover:underline">Reset options</button>
          </div>
        )}
      </Popover>
    </form>
  );
});
