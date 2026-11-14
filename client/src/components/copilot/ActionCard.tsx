"use client";

// A proposal the assistant prepared. Nothing happens until the user presses
// Confirm — then the browser calls the named API endpoint with the user's own
// session (server RBAC, maker-checker and audit apply as usual).

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, BellRing, Check, ChevronDown, CircleSlash, ExternalLink, Gavel, Landmark, Link2, Loader2, Mail,
  MessageCircle, Pencil, ShieldCheck, UserPlus, Wallet,
} from "lucide-react";
import type { ActionCardData, Citation } from "@/lib/api/copilot";
import { executeAction } from "@/lib/api/copilot";
import { MiniTable } from "./MiniTable";
import { formatCell } from "./format";
import { cn } from "@/lib/utils";

const KIND = {
  payment_run: { icon: Wallet, label: "Payment run", consequence: "Confirming saves this run for approval. No money moves from here." },
  supplier_message: { icon: Mail, label: "Supplier message", consequence: "Confirming puts the message in your outbox — nothing reaches the supplier until it is sent from there." },
  ims_actions: { icon: Landmark, label: "GST IMS actions", consequence: "Confirming records these decisions in Satya. You still accept or reject on the GST portal." },
  decision: { icon: Gavel, label: "Case decision", consequence: "Confirming records the decision on the case, with your name, in the audit log. It doesn't pay or notify anyone." },
  allocation: { icon: Link2, label: "Payment allocation", consequence: "Confirming matches the payment to these invoices in your books." },
  assignment: { icon: UserPlus, label: "Assignment", consequence: "Confirming makes this person the owner of the case." },
  reminder: { icon: BellRing, label: "Follow-up reminder", consequence: "Confirming adds a dated follow-up to the case." },
} as const;

type Phase = "idle" | "running" | "done" | "failed" | "cancelled";

/** Where the created record lives, for the success state. */
function recordLink(card: ActionCardData, data: Record<string, unknown>): { href: string; label: string } | null {
  const path = card.execute?.path ?? "";
  const caseId = /\/cases\/([^/]+)\//.exec(path)?.[1];
  switch (card.kind) {
    case "decision":
    case "assignment":
    case "reminder":
      return caseId ? { href: `/app/investigations/${caseId}`, label: "Open the case" } : null;
    case "allocation":
      return { href: "/app/payments", label: "Open payments" };
    case "payment_run":
      return { href: "/app/payments", label: "Open payments" };
    case "ims_actions":
      return { href: "/app/compliance", label: "Open compliance" };
    case "supplier_message": {
      const sid = (card.execute?.body as { supplierId?: string } | undefined)?.supplierId;
      return sid ? { href: `/app/suppliers/${sid}`, label: "Open the supplier" } : null;
    }
    default:
      void data;
      return null;
  }
}

export function ActionCard({
  card,
  sources = [],
  onResult,
}: {
  card: ActionCardData;
  sources?: Citation[];
  onResult?: (card: ActionCardData, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) => void;
}) {
  const initial: Phase = card.result?.status === "confirmed" || card.status === "confirmed" ? "done" : card.result?.status === "cancelled" || card.status === "cancelled" ? "cancelled" : "idle";
  const [phase, setPhase] = useState<Phase>(initial);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((card.fields ?? []).map((f) => [f.key, f.value ?? ""])));
  const [message, setMessage] = useState<string | null>(card.result?.detail ?? null);
  const [reference, setReference] = useState<string | null>(card.result?.reference ?? null);
  const [extLink, setExtLink] = useState<string | null>(null);
  const [created, setCreated] = useState<{ href: string; label: string } | null>(() => (initial === "done" ? recordLink(card, {}) : null));
  const [showExcluded, setShowExcluded] = useState(false);
  const meta = KIND[card.kind] ?? KIND.decision;
  const Icon = values.channel === "whatsapp" ? MessageCircle : meta.icon;
  const missing = (card.fields ?? []).filter((f) => f.required && !String(values[f.key] ?? "").trim());
  const locked = phase === "running" || phase === "done" || phase === "cancelled";

  const confirm = async () => {
    setPhase("running");
    setMessage(null);
    const out = await executeAction(card, values);
    if (out.ok) {
      const data = (out.data ?? {}) as Record<string, unknown>;
      const decisionId = (data.decision as { id?: string } | undefined)?.id;
      const ref = String(data.id ?? data.paymentId ?? decisionId ?? "");
      if (typeof data.link === "string") setExtLink(data.link);
      const detail = `${card.execute?.successText ?? "Done"}${data.status ? ` — ${String(data.status).replaceAll("_", " ")}` : ""}`;
      setMessage(detail);
      setReference(ref || null);
      setCreated(recordLink(card, data));
      setPhase("done");
      setEditing(false);
      onResult?.(card, { status: "confirmed", detail, reference: ref });
    } else {
      setMessage(out.message);
      setPhase("failed");
      onResult?.(card, { status: "failed", detail: out.message });
    }
  };

  const dismiss = () => {
    setPhase("cancelled");
    setMessage("Dismissed — nothing was changed.");
    onResult?.(card, { status: "cancelled" });
  };

  const inputCls = "w-full rounded-[10px] border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[14.5px] text-[var(--ink)] transition-shadow focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-soft)] disabled:opacity-70";

  return (
    <section
      aria-label={`${meta.label}: ${card.title}`}
      className={cn(
        "sx-rise overflow-hidden rounded-[16px] border bg-[var(--surface)] shadow-[var(--shadow-2)] transition-colors duration-300",
        phase === "done" ? "border-[var(--confirmed)]/45" : phase === "failed" ? "border-[var(--sev-critical)]/50" : phase === "cancelled" ? "border-[var(--line)] opacity-80" : "border-[var(--line-strong)]",
      )}
    >
      <header className="flex items-start gap-3 px-5 pb-3 pt-4">
        <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px]", phase === "done" ? "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" : "bg-[var(--accent-soft)] text-[var(--accent-strong)]")}>
          {phase === "done" ? <Check size={17} className="sx-pop" strokeWidth={2.5} aria-hidden="true" /> : <Icon size={17} aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-[var(--muted)]">{meta.label} · {phase === "done" ? "confirmed" : phase === "cancelled" ? "dismissed" : "needs your OK"}</p>
          <h3 className="mt-0.5 text-[16px] font-semibold leading-snug text-[var(--ink)]">{card.title}</h3>
          {card.summary ? <p className="mt-1 text-[14.5px] leading-relaxed text-[var(--ink-2)]">{card.summary}</p> : null}
        </div>
      </header>

      <div className="space-y-4 px-5 pb-4">
        {card.facts?.length ? (
          <dl
            style={{ "--cols": Math.min(card.facts.length, 4) } as CSSProperties}
            className={cn("grid gap-px overflow-hidden rounded-[12px] border border-[var(--line)] bg-[var(--line)] sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]", card.facts.length === 1 ? "grid-cols-1" : "grid-cols-2")}
          >
            {card.facts.map((f) => (
              <div key={f.label} className="bg-[var(--surface)] px-3 py-2.5">
                <dt className="text-[12px] text-[var(--muted)]">{f.label}</dt>
                <dd className="tnum mt-0.5 text-[16px] font-semibold text-[var(--ink)]">{formatCell(f.value, f.format)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {card.table?.rows?.length ? <MiniTable table={card.table} sources={sources} maxRows={6} /> : null}

        {card.excluded?.length ? (
          <div>
            <button type="button" onClick={() => setShowExcluded((v) => !v)} className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--muted)] hover:text-[var(--ink)]" aria-expanded={showExcluded}>
              <ChevronDown size={14} className={cn("transition-transform duration-200", showExcluded && "rotate-180")} aria-hidden="true" />
              {card.excluded.length} left out — and why
            </button>
            {showExcluded && (
              <ul className="sx-fade mt-2 divide-y divide-[var(--line)] rounded-[10px] border border-[var(--line)] text-[13.5px]">
                {card.excluded.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                    <span className="font-medium text-[var(--ink)]">{e.invoice}</span>
                    <span className="text-[var(--muted)]">{e.supplier}</span>
                    <span className="tnum ml-auto text-[var(--ink)]">{formatCell(e.amount, "inr")}</span>
                    <span className="w-full text-[var(--ink-2)]">{e.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {card.fields?.length ? (
          editing ? (
            <div className="sx-fade grid gap-3 sm:grid-cols-2">
              {card.fields.map((f) => {
                const id = `${card.id}-${f.key}`;
                return (
                  <label key={f.key} htmlFor={id} className={cn("block", f.type === "textarea" && "sm:col-span-2")}>
                    <span className="mb-1 block text-[12.5px] font-medium text-[var(--muted)]">
                      {f.label}
                      {f.required ? <span className="text-[var(--sev-critical)]"> *</span> : null}
                    </span>
                    {f.type === "textarea" ? (
                      <textarea id={id} value={values[f.key] ?? ""} disabled={locked} rows={Math.min(14, Math.max(4, (values[f.key] ?? "").split("\n").length + 1))} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(inputCls, "py-2 leading-relaxed")} />
                    ) : f.type === "select" ? (
                      <select id={id} value={values[f.key] ?? ""} disabled={locked} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(inputCls, "h-10")}>
                        {(f.options ?? []).map((o) => {
                          const opt = typeof o === "string" ? { value: o, label: o } : o;
                          return <option key={opt.value} value={opt.value}>{opt.label}</option>;
                        })}
                      </select>
                    ) : (
                      <input id={id} type={f.type === "date" ? "date" : "text"} value={values[f.key] ?? ""} disabled={locked} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(inputCls, "h-10")} />
                    )}
                  </label>
                );
              })}
            </div>
          ) : (
            <dl className="space-y-2.5 rounded-[12px] bg-[var(--surface-2)]/55 px-4 py-3">
              {card.fields.map((f) => {
                const v = values[f.key] ?? "";
                const shown = f.type === "select" ? (f.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o)).find((o) => o.value === v)?.label ?? v : v;
                return (
                  <div key={f.key} className={cn(f.type === "textarea" ? "block" : "flex items-baseline gap-3")}>
                    <dt className={cn("shrink-0 text-[12.5px] text-[var(--muted)]", f.type !== "textarea" && "sm:w-28")}>{f.label}</dt>
                    <dd className={cn("min-w-0 text-[14.5px] text-[var(--ink)]", f.type === "textarea" && "mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed text-[var(--ink-2)] sx-scroll")}>
                      {shown ? String(shown).replaceAll("_", " ") : <span className="text-[var(--sev-critical)]">Missing — press Edit to add it</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )
        ) : null}

        {card.warnings?.length ? (
          <ul className="space-y-1.5">
            {card.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-snug text-[var(--ink-2)]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--possible)]" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}

        {phase !== "done" && phase !== "cancelled" && !(card.warnings ?? []).some((w) => /^confirming\b/i.test(w)) ? <p className="text-[13px] leading-relaxed text-[var(--muted)]">{meta.consequence}</p> : null}
      </div>

      <footer className={cn("flex flex-wrap items-center gap-2 border-t px-5 py-3", phase === "done" ? "border-[var(--confirmed)]/25 bg-[var(--confirmed-soft)]/40" : "border-[var(--line)]")}>
        {phase === "done" ? (
          <p role="status" className="sx-fade flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-medium text-[var(--confirmed)]">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck size={16} aria-hidden="true" /> {message ?? "Confirmed"}</span>
            {reference ? <span className="font-code text-[12px] font-normal text-[var(--muted)]">Ref {reference}</span> : null}
            {created ? (
              <Link href={created.href} className="inline-flex items-center gap-1 text-[var(--accent-strong)] hover:underline">
                {created.label} <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            ) : null}
            {extLink ? (
              <a href={extLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-strong)] hover:underline">
                Open WhatsApp <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </p>
        ) : phase === "cancelled" ? (
          <p className="flex items-center gap-2 text-[14px] text-[var(--muted)]"><CircleSlash size={15} aria-hidden="true" /> {message ?? "Dismissed"}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={confirm}
              disabled={!card.execute || phase === "running" || missing.length > 0}
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[var(--accent)] px-4 text-[14.5px] font-semibold text-[var(--on-accent)] shadow-[var(--shadow-1)] transition-all hover:bg-[var(--accent-strong)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {phase === "running" ? <Loader2 size={16} className="sx-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
              {phase === "running" ? "Working…" : phase === "failed" ? "Try again" : card.confirmLabel ?? "Confirm"}
            </button>
            {card.fields?.length ? (
              <button type="button" onClick={() => setEditing((v) => !v)} disabled={phase === "running"} aria-pressed={editing} className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[14.5px] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50">
                <Pencil size={14} aria-hidden="true" /> {editing ? "Done editing" : "Edit"}
              </button>
            ) : null}
            <button type="button" onClick={dismiss} disabled={phase === "running"} className="inline-flex h-10 items-center rounded-[10px] px-3 text-[14.5px] font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-50">
              Dismiss
            </button>
            {missing.length > 0 && <span className="text-[12.5px] text-[var(--muted)]">Add {missing.map((f) => f.label.toLowerCase()).join(", ")} first</span>}
            {!card.execute && <span className="text-[12.5px] text-[var(--muted)]">Nothing to confirm yet — see the notes above.</span>}
            {phase === "failed" && message && <p role="alert" className="w-full text-[13.5px] text-[var(--sev-critical)]">{message}</p>}
          </>
        )}
      </footer>
    </section>
  );
}
