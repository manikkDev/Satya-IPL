"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, Wallet, Mail, MessageCircle, Landmark, Gavel, Link2, UserPlus, BellRing, ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import type { ActionCardData, Citation } from "@/lib/api/copilot";
import { executeAction } from "@/lib/api/copilot";
import { Btn } from "@/components/ui/v2";
import { MiniTable } from "./MiniTable";
import { formatCell } from "./format";
import { cn } from "@/lib/utils";

const KIND = {
  payment_run: { icon: Wallet, label: "Payment run proposal" },
  supplier_message: { icon: Mail, label: "Supplier message" },
  ims_actions: { icon: Landmark, label: "GST IMS actions" },
  decision: { icon: Gavel, label: "Case decision" },
  allocation: { icon: Link2, label: "Payment allocation" },
  assignment: { icon: UserPlus, label: "Assignment" },
  reminder: { icon: BellRing, label: "Follow-up reminder" },
} as const;

type Phase = "idle" | "running" | "done" | "failed" | "cancelled";

/**
 * A proposal the assistant prepared. Nothing happens until the user presses
 * Confirm — then the browser calls the named API endpoint with the user's own
 * session (server RBAC, maker-checker and audit apply as usual).
 */
export function ActionCard({
  card,
  sources = [],
  onResult,
}: {
  card: ActionCardData;
  sources?: Citation[];
  onResult?: (card: ActionCardData, result: { status: "confirmed" | "cancelled" | "failed"; detail?: string; reference?: string }) => void;
}) {
  const initial: Phase = card.result?.status === "confirmed" ? "done" : card.result?.status === "cancelled" ? "cancelled" : "idle";
  const [phase, setPhase] = useState<Phase>(initial);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((card.fields ?? []).map((f) => [f.key, f.value ?? ""])));
  const [message, setMessage] = useState<string | null>(card.result?.detail ?? null);
  const [link, setLink] = useState<string | null>(null);
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
      const reference = String(data.id ?? data.paymentId ?? decisionId ?? "");
      if (typeof data.link === "string") setLink(data.link);
      const detail = `${card.execute?.successText ?? "Done"}${data.status ? ` — ${String(data.status).replaceAll("_", " ")}` : ""}`;
      setMessage(detail);
      setPhase("done");
      onResult?.(card, { status: "confirmed", detail, reference });
    } else {
      setMessage(out.message);
      setPhase("failed");
      onResult?.(card, { status: "failed", detail: out.message });
    }
  };

  const cancel = () => {
    setPhase("cancelled");
    setMessage("Cancelled — nothing was changed.");
    onResult?.(card, { status: "cancelled" });
  };

  return (
    <section
      aria-label={`${meta.label}: ${card.title}`}
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--surface)] shadow-[var(--shadow-1)]",
        phase === "done" ? "border-[var(--confirmed)]/40" : phase === "failed" ? "border-[var(--sev-critical)]/50" : "border-[var(--accent)]/35",
      )}
    >
      <header className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{meta.label} · needs your confirmation</p>
          <h3 className="text-[15px] font-semibold leading-snug text-[var(--ink)]">{card.title}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink-2)]">{card.summary}</p>
        </div>
      </header>

      <div className="space-y-3 px-4 py-3">
        {card.facts?.length ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {card.facts.map((f) => (
              <div key={f.label} className="rounded-[var(--radius-sm)] bg-[var(--surface-2)]/70 px-3 py-2">
                <dt className="text-[11px] text-[var(--muted)]">{f.label}</dt>
                <dd className="tnum text-[15px] font-semibold text-[var(--ink)]">{formatCell(f.value, f.format)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {card.table?.rows?.length ? <MiniTable table={card.table} sources={sources} maxRows={12} /> : null}

        {card.excluded?.length ? (
          <div>
            <button type="button" onClick={() => setShowExcluded((v) => !v)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]" aria-expanded={showExcluded}>
              <ChevronDown size={13} className={cn("transition-transform", showExcluded && "rotate-180")} aria-hidden="true" />
              {card.excluded.length} left out and why
            </button>
            {showExcluded && (
              <ul className="mt-2 space-y-1 text-[13px] text-[var(--ink-2)]">
                {card.excluded.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="font-medium text-[var(--ink)]">{e.invoice}</span>
                    <span className="text-[var(--muted)]">{e.supplier}</span>
                    <span className="tnum">{formatCell(e.amount, "inr")}</span>
                    <span>— {e.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {card.fields?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {card.fields.map((f) => {
              const id = `${card.id}-${f.key}`;
              const common = "w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--paper)] px-3 text-[14px] text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-70";
              return (
                <label key={f.key} htmlFor={id} className={cn("block", f.type === "textarea" && "sm:col-span-2")}>
                  <span className="mb-1 block text-xs font-medium text-[var(--muted)]">
                    {f.label}
                    {f.required ? <span className="text-[var(--sev-critical)]"> *</span> : null}
                  </span>
                  {f.type === "textarea" ? (
                    <textarea id={id} value={values[f.key] ?? ""} disabled={locked} rows={Math.min(14, Math.max(4, (values[f.key] ?? "").split("\n").length + 1))} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(common, "py-2 font-[inherit] leading-relaxed")} />
                  ) : f.type === "select" ? (
                    <select id={id} value={values[f.key] ?? ""} disabled={locked} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(common, "h-10")}>
                      {(f.options ?? []).map((o) => {
                        const opt = typeof o === "string" ? { value: o, label: o } : o;
                        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
                      })}
                    </select>
                  ) : (
                    <input id={id} type={f.type === "date" ? "date" : "text"} value={values[f.key] ?? ""} disabled={locked} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className={cn(common, "h-10")} />
                  )}
                </label>
              );
            })}
          </div>
        ) : null}

        {card.warnings?.length ? (
          <ul className="space-y-1">
            {card.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[13px] leading-snug text-[var(--ink-2)]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--possible)]" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-4 py-3">
        {phase === "done" ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-[var(--confirmed)]">
            <CheckCircle2 size={16} aria-hidden="true" /> {message}
            {link ? (
              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-strong)] underline">
                Open WhatsApp <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : null}
          </p>
        ) : phase === "cancelled" ? (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]"><CircleSlash size={15} aria-hidden="true" /> {message ?? "Cancelled"}</p>
        ) : (
          <>
            <Btn onClick={confirm} disabled={!card.execute || phase === "running" || missing.length > 0} icon={phase === "running" ? Loader2 : ShieldCheck} className={phase === "running" ? "[&_svg]:animate-spin" : undefined}>
              {phase === "running" ? "Working…" : phase === "failed" ? "Try again" : card.confirmLabel ?? "Confirm"}
            </Btn>
            <Btn variant="ghost" onClick={cancel} disabled={phase === "running"}>Cancel</Btn>
            {missing.length > 0 && <span className="text-xs text-[var(--muted)]">Fill in {missing.map((f) => f.label.toLowerCase()).join(", ")} first</span>}
            {!card.execute && <span className="text-xs text-[var(--muted)]">Nothing to confirm yet — see the notes above.</span>}
            {phase === "failed" && message && <p role="alert" className="w-full text-[13px] text-[var(--sev-critical)]">{message}</p>}
          </>
        )}
      </footer>
    </section>
  );
}
