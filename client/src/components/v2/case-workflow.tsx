"use client";

// Investigation workflow panel: who owns it, follow-up reminders, supplier
// messages (email via SMTP, WhatsApp/SMS as share links) and CSV export.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, Check, FileSpreadsheet, Mail, MessageCircle, Send, Smartphone, UserRound, RotateCcw, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Btn, Card, CardTitle, DateText } from "@/components/ui/v2";
import { useSession } from "@/components/v2/session";
import { workflow, type OutboxChannel, type OutboxMessage } from "@/lib/api/workflow";
import { isoDateIst } from "@/lib/format";
import { cn } from "@/lib/utils";

const field =
  "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]";

const STATUS_COPY: Record<OutboxMessage["status"], { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "text-[var(--muted)]" },
  scheduled: { label: "Scheduled", tone: "text-[var(--likely)]" },
  sending: { label: "Sending", tone: "text-[var(--likely)]" },
  sent: { label: "Sent", tone: "text-[var(--confirmed)]" },
  failed: { label: "Failed", tone: "text-[var(--sev-critical)]" },
  link_ready: { label: "Link ready", tone: "text-[var(--accent)]" },
  not_configured: { label: "Email not set up", tone: "text-[var(--possible)]" },
  cancelled: { label: "Cancelled", tone: "text-[var(--muted)]" },
};

export function CaseWorkflow({
  caseId,
  caseTitle,
  assignee,
  priority,
  supplier,
}: {
  caseId: string;
  caseTitle: string;
  assignee?: string | null;
  priority?: string | null;
  supplier?: { id?: string; name?: string; email?: string; phone?: string } | null;
}) {
  const queryClient = useQueryClient();
  const { hasPermission } = useSession();
  const canAct = hasPermission("finding.decide");
  const canExport = hasPermission("evidence.export");

  const people = useQuery({ queryKey: ["assignees"], queryFn: workflow.assignees, staleTime: 5 * 60_000 });
  const reminders = useQuery({ queryKey: ["reminders", caseId], queryFn: () => workflow.reminders(caseId) });
  const outbox = useQuery({ queryKey: ["outbox", caseId], queryFn: () => workflow.outbox({ caseId }) });
  const config = useQuery({ queryKey: ["outbox-config"], queryFn: workflow.outboxConfig, staleTime: 10 * 60_000 });

  const [owner, setOwner] = useState(assignee ?? "");
  const [prio, setPrio] = useState(priority ?? "normal");
  const assign = useMutation({
    mutationFn: (body: { assignee: string | null; priority?: "low" | "normal" | "high" }) => workflow.assign(caseId, body),
    onSuccess: () => {
      toast.success("Owner updated");
      void queryClient.invalidateQueries({ queryKey: ["case", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn’t update the owner."),
  });

  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const addReminder = useMutation({
    mutationFn: () => workflow.addReminder(caseId, { dueDate, note: note.trim() }),
    onSuccess: () => {
      setNote("");
      setDueDate("");
      toast.success("Reminder added");
      void queryClient.invalidateQueries({ queryKey: ["reminders", caseId] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn’t add the reminder."),
  });
  const toggleReminder = useMutation({
    mutationFn: (r: { id: string; status: "open" | "done" }) => workflow.setReminder(r.id, r.status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["reminders", caseId] }),
    onError: () => toast.error("Couldn’t update the reminder."),
  });

  const [composer, setComposer] = useState<OutboxChannel | null>(null);
  const nameOf = useMemo(() => new Map((people.data?.items ?? []).map((p) => [p.id, p.name])), [people.data]);
  const today = isoDateIst();

  return (
    <Card>
      <CardTitle hint={canAct ? undefined : "Read-only for your role"}>Follow-up</CardTitle>

      {/* owner & priority */}
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <div>
          <label htmlFor="case-owner" className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
            <UserRound size={13} aria-hidden="true" /> Owner
          </label>
          <select id="case-owner" value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canAct} className={field}>
            <option value="">Unassigned</option>
            {(people.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.roles.length ? ` · ${p.roles[0].replaceAll("_", " ")}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="case-priority" className="mb-1 block text-xs font-medium text-[var(--muted)]">Priority</label>
          <select id="case-priority" value={prio} onChange={(e) => setPrio(e.target.value)} disabled={!canAct} className={field}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
        <Btn
          variant="secondary"
          size="md"
          disabled={!canAct || assign.isPending || (owner === (assignee ?? "") && prio === (priority ?? "normal"))}
          onClick={() => assign.mutate({ assignee: owner || null, priority: prio as "low" | "normal" | "high" })}
        >
          Save
        </Btn>
      </div>

      {/* reminders */}
      <div className="mt-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          <AlarmClock size={13} aria-hidden="true" /> Reminders
        </p>
        {(reminders.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No reminders yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {(reminders.data?.items ?? []).map((r) => {
              const overdue = r.status === "open" && r.dueDate < today;
              return (
                <li key={r.id} className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2">
                  <button
                    type="button"
                    aria-label={r.status === "done" ? "Mark as not done" : "Mark as done"}
                    disabled={!canAct}
                    onClick={() => toggleReminder.mutate({ id: r.id, status: r.status === "done" ? "open" : "done" })}
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border",
                      r.status === "done" ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)]",
                    )}
                  >
                    {r.status === "done" ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", r.status === "done" ? "text-[var(--muted)] line-through" : "text-[var(--ink)]")}>{r.note}</p>
                    <p className={cn("text-xs", overdue ? "font-medium text-[var(--sev-critical)]" : "text-[var(--muted)]")}>
                      Due <DateText value={r.dueDate} />{overdue ? " · overdue" : ""}
                      {r.assignee && nameOf.get(r.assignee) ? ` · ${nameOf.get(r.assignee)}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canAct ? (
          <form
            className="mt-3 grid gap-2 sm:grid-cols-[150px_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (dueDate && note.trim().length >= 3) addReminder.mutate();
            }}
          >
            <input type="date" aria-label="Due date" min={today} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} required />
            <input aria-label="Reminder" placeholder="e.g. Chase supplier for the credit note" value={note} onChange={(e) => setNote(e.target.value)} className={field} required minLength={3} />
            <Btn type="submit" variant="secondary" disabled={addReminder.isPending || !dueDate || note.trim().length < 3}>Add</Btn>
          </form>
        ) : null}
      </div>

      {/* supplier messages */}
      <div className="mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="mr-auto flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            <MessageCircle size={13} aria-hidden="true" /> Supplier messages
          </p>
          {canAct ? (
            <>
              <Btn size="sm" variant="secondary" icon={Mail} onClick={() => setComposer("email")}>Email</Btn>
              <Btn size="sm" variant="secondary" icon={MessageCircle} onClick={() => setComposer("whatsapp")}>WhatsApp</Btn>
              <Btn size="sm" variant="secondary" icon={Smartphone} onClick={() => setComposer("sms")}>SMS</Btn>
            </>
          ) : null}
          {canExport ? (
            <Btn
              size="sm"
              variant="ghost"
              icon={FileSpreadsheet}
              onClick={() => workflow.downloadCaseCsv(caseId).catch((e) => toast.error(e instanceof Error ? e.message : "Export failed"))}
            >
              CSV report
            </Btn>
          ) : null}
        </div>
        {(outbox.data?.items ?? []).length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No messages sent from this investigation.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)] rounded-[var(--radius-sm)] border border-[var(--line)]">
            {(outbox.data?.items ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="capitalize text-[var(--ink)]">{m.channel}</span>
                <span className="font-code text-xs text-[var(--muted)]">{m.to}</span>
                <span className={cn("text-xs font-medium", STATUS_COPY[m.status]?.tone)}>{STATUS_COPY[m.status]?.label ?? m.status}</span>
                {m.status === "scheduled" && m.scheduledFor ? (
                  <span className="text-xs text-[var(--muted)]">· sends <DateText value={m.scheduledFor} withTime /></span>
                ) : null}
                <span className="ml-auto flex items-center gap-2">
                  {m.link ? (
                    <a href={m.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline">
                      Open <ExternalLink size={11} aria-hidden="true" />
                    </a>
                  ) : null}
                  {canAct && m.channel === "email" && ["failed", "not_configured", "scheduled"].includes(m.status) ? (
                    <button
                      type="button"
                      onClick={() =>
                        workflow.retry(m.id)
                          .then(() => queryClient.invalidateQueries({ queryKey: ["outbox", caseId] }))
                          .catch((e) => toast.error(e instanceof Error ? e.message : "Retry failed"))
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      <RotateCcw size={11} aria-hidden="true" /> {m.status === "scheduled" ? "Send now" : "Retry"}
                    </button>
                  ) : null}
                </span>
                {m.lastError && m.status !== "sent" ? <p className="w-full text-xs text-[var(--muted)]">{m.lastError}</p> : null}
              </li>
            ))}
          </ul>
        )}
        {config.data && !config.data.email ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Email isn’t set up on this server yet — WhatsApp and SMS open on your own device with the message pre-filled.
          </p>
        ) : null}
      </div>

      <Composer
        channel={composer}
        onClose={() => setComposer(null)}
        caseId={caseId}
        supplier={supplier}
        defaultSubject={`Clarification needed: ${caseTitle}`}
        onSent={(message) => {
          void queryClient.invalidateQueries({ queryKey: ["outbox", caseId] });
          if (message.link) window.open(message.link, "_blank", "noopener,noreferrer");
        }}
      />
    </Card>
  );
}

function Composer({
  channel,
  onClose,
  caseId,
  supplier,
  defaultSubject,
  onSent,
}: {
  channel: OutboxChannel | null;
  onClose: () => void;
  caseId: string;
  supplier?: { id?: string; name?: string; email?: string; phone?: string } | null;
  defaultSubject: string;
  onSent: (m: OutboxMessage) => void;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  const open = channel !== null;
  const reset = () => {
    setTo(channel === "email" ? supplier?.email ?? "" : supplier?.phone ?? "");
    setSubject(defaultSubject);
    setBody(
      `Dear ${supplier?.name ?? "Sir/Madam"},\n\nWe are reconciling ${defaultSubject.replace("Clarification needed: ", "")} and need your confirmation on the open points before we release payment.\n\nPlease reply with the relevant documents.\n\nThank you.`,
    );
    setKey(crypto.randomUUID());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        else if (!busy) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={() => reset()}>
        <DialogHeader>
          <DialogTitle>
            {channel === "email" ? "Email the supplier" : channel === "whatsapp" ? "WhatsApp the supplier" : "Text the supplier"}
          </DialogTitle>
          <DialogDescription>
            {channel === "email"
              ? "Sent from the server when email is configured. Emails written after 10 pm wait until 8 am IST."
              : "Opens on your device with the message filled in — you press send. Satya keeps a record that you prepared it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="msg-to" className="mb-1 block text-xs font-medium text-[var(--muted)]">{channel === "email" ? "Email address" : "Mobile number"}</label>
            <input id="msg-to" value={to} onChange={(e) => setTo(e.target.value)} className={field} inputMode={channel === "email" ? "email" : "tel"} placeholder={channel === "email" ? "accounts@supplier.in" : "98220 41105"} />
          </div>
          {channel === "email" ? (
            <div>
              <label htmlFor="msg-subject" className="mb-1 block text-xs font-medium text-[var(--muted)]">Subject</label>
              <input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
            </div>
          ) : null}
          <div>
            <label htmlFor="msg-body" className="mb-1 block text-xs font-medium text-[var(--muted)]">Message</label>
            <textarea id="msg-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} className={cn(field, "h-auto resize-none py-2 leading-relaxed")} />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Btn variant="secondary" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn
            icon={Send}
            disabled={busy || to.trim().length < 3 || body.trim().length < 5}
            onClick={async () => {
              if (!channel) return;
              setBusy(true);
              try {
                const message = await workflow.send({
                  channel, to: to.trim(), body: body.trim(), caseId, idempotencyKey: key,
                  ...(channel === "email" ? { subject: subject.trim() } : {}),
                  ...(supplier?.id ? { supplierId: supplier.id } : {}),
                });
                toast.success(
                  message.status === "sent" ? "Email sent"
                    : message.status === "scheduled" ? "Email scheduled for 8 am IST"
                    : message.status === "not_configured" ? "Saved — email isn’t set up on this server"
                    : message.status === "link_ready" ? "Opening on your device…"
                    : "Message saved",
                );
                onSent(message);
                onClose();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "The message couldn’t be prepared.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {channel === "email" ? "Send email" : "Open and send"}
          </Btn>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
