"use client";

// /app/setup — first-run checklist for a new workspace. Opens automatically
// from Home while the company has no data (once per session) and can be
// hidden. Four steps, each saying why it matters and what to do:
//   1 company details & GSTIN · 2 import data · 3 invite team · 4 first check

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check, Building2, Upload, Users, ScanSearch, ChevronDown, Copy, LoaderCircle, Trash2, FileSpreadsheet, Landmark,
  ReceiptText, ArrowRight, CircleCheck,
} from "lucide-react";
import { onboarding, setupDismissKey, type OnboardingStatus } from "@/lib/api/onboarding";
import { ApiError } from "@/lib/api/client";
import { v2 } from "@/lib/api/v2";
import { checkGstin } from "@/lib/gstin";
import { useSession } from "@/components/v2/session";
import {
  Btn, BtnLink, Callout, Card, ErrorState, FieldLabel, PageHeader, Progress, Term, inputClass, ToneBadge,
} from "@/components/ui/v2";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABEL, roleLabel } from "@/content/copy/vocabulary";
import { cn } from "@/lib/utils";

type StepKey = keyof OnboardingStatus["steps"];

const STEPS: { key: StepKey; title: string; why: string; icon: typeof Building2 }[] = [
  { key: "company", title: "Add your company details", why: "Your GSTIN tells Satya which GST state you’re in, so tax on every bill is checked correctly.", icon: Building2 },
  { key: "data", title: "Bring in your data", why: "Satya works from the records you already keep — no re-typing.", icon: Upload },
  { key: "team", title: "Invite your team", why: "Give each person the right role: who can approve, who can upload, who can only view.", icon: Users },
  { key: "firstCheck", title: "Run your first check", why: "Satya matches orders, deliveries, invoices and payments and lists anything that doesn’t add up.", icon: ScanSearch },
];

const INVITE_ROLES = ["ap_manager", "ap_clerk", "buyer", "stores", "treasury", "auditor", "entity_admin", "group_admin"];

/* ---------------- step 1: company ---------------- */

function CompanyStep({ status, onSaved }: { status: OnboardingStatus; onSaved: () => void }) {
  const entity = status.steps.company.entity;
  const [legalName, setLegalName] = useState(entity?.legalName ?? "");
  const [tradeName, setTradeName] = useState(entity?.tradeName ?? "");
  const [gstin, setGstin] = useState(entity?.gstin ?? "");
  const [line1, setLine1] = useState(entity?.address?.line1 ?? "");
  const [city, setCity] = useState(entity?.address?.city ?? "");
  const [pin, setPin] = useState(entity?.address?.pin ?? "");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState("");
  const check = useMemo(() => checkGstin(gstin), [gstin]);
  const showGstinError = !check.ok && (touched || gstin.replace(/\s/g, "").length >= 15);
  const pinValid = !pin || /^[1-9][0-9]{5}$/.test(pin);
  const addressComplete = Boolean(line1.trim() && city.trim() && pin);

  const save = useMutation({
    mutationFn: async () => {
      if (!check.ok) throw new Error(check.message);
      const address = addressComplete ? { line1: line1.trim(), city: city.trim(), pin: pin.trim() } : undefined;
      try {
        return await onboarding.saveCompany({ entityId: entity?.id, legalName: legalName.trim(), tradeName: tradeName.trim(), gstin: check.gstin, address });
      } catch (err) {
        // Older servers without /onboarding: fall back to the entities API.
        if (err instanceof ApiError && err.status === 404 && entity?.id) {
          await v2.updateEntity(entity.id, {
            legalName: legalName.trim(), gstin: check.gstin, pan: check.pan, stateCode: check.stateCode,
            ...(tradeName.trim() ? { tradeName: tradeName.trim() } : {}),
            ...(address ? { addresses: { billing: { ...address, state: check.stateName, stateCode: check.stateCode } } } : {}),
          });
          return null;
        }
        throw err;
      }
    },
    onSuccess: () => {
      toast.success("Company details saved");
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn’t save the company details."),
  });

  if (!status.canManage) {
    return <Callout tone="info">Only a workspace admin can change company details. {entity?.gstin ? `GSTIN on file: ${entity.gstin}.` : "Ask your admin to add the GSTIN."}</Callout>;
  }

  return (
    <form
      className="grid gap-5 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        setError("");
        if (check.ok && legalName.trim().length >= 2 && pinValid) save.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <FieldLabel htmlFor="legalName" hint="Exactly as on your GST registration certificate.">Legal name</FieldLabel>
        <input id="legalName" className={inputClass} required minLength={2} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
      </div>
      <div>
        <FieldLabel htmlFor="gstin" hint={<>Your 15-character <Term of="GSTIN">GST number</Term>.</>}>GSTIN</FieldLabel>
        <input
          id="gstin"
          className={cn(inputClass, "font-code uppercase tracking-wide")}
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          onBlur={() => setTouched(true)}
          maxLength={18}
          autoComplete="off"
          spellCheck={false}
          placeholder="27AAPFU0939F1ZV"
          aria-invalid={showGstinError || undefined}
          aria-describedby="gstin-result"
        />
        <p id="gstin-result" className="mt-1.5 min-h-5 text-[14px]" aria-live="polite">
          {check.ok ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--confirmed)]">
              <CircleCheck size={15} aria-hidden="true" /> Valid format · {check.stateName} · PAN {check.pan}
            </span>
          ) : showGstinError ? (
            <span className="text-[var(--sev-critical)]">{check.message}</span>
          ) : (
            <span className="text-[var(--muted)]">We check the format and check-digit as you type.</span>
          )}
        </p>
      </div>
      <div>
        <FieldLabel htmlFor="tradeName" optional hint="The name customers know you by, if different.">Trade name</FieldLabel>
        <input id="tradeName" className={inputClass} value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <FieldLabel htmlFor="line1" optional hint="Used on purchase orders you send to suppliers.">Registered address</FieldLabel>
        <input id="line1" className={inputClass} value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Plot, street, area" autoComplete="street-address" />
      </div>
      <div>
        <FieldLabel htmlFor="city">City</FieldLabel>
        <input id="city" className={inputClass} value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="pin">PIN code</FieldLabel>
          <input id="pin" className={cn(inputClass, "tnum")} inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} aria-invalid={!pinValid || undefined} autoComplete="postal-code" />
        </div>
        <div>
          <FieldLabel htmlFor="state">State</FieldLabel>
          <input id="state" className={cn(inputClass, "bg-[var(--surface-2)]")} readOnly value={check.ok ? check.stateName : ""} placeholder="From GSTIN" tabIndex={-1} />
        </div>
      </div>
      {!pinValid ? <p className="text-[14px] text-[var(--sev-critical)] sm:col-span-2">A PIN code has 6 digits and doesn’t start with 0.</p> : null}
      {error ? <div className="sm:col-span-2"><Callout tone="danger">{error}</Callout></div> : null}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Btn type="submit" disabled={save.isPending}>
          {save.isPending ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          {status.steps.company.done ? "Save changes" : "Save company details"}
        </Btn>
        <span className="text-[14px] text-[var(--muted)]">You can change these later in Settings.</span>
      </div>
    </form>
  );
}

/* ---------------- step 2: data ---------------- */

const SOURCES = [
  { icon: FileSpreadsheet, title: "Tally or your ERP", body: "Purchase vouchers, supplier ledgers and stock receipts (Excel/XML export)." },
  { icon: Landmark, title: "Bank statements", body: "CSV from your bank — Satya matches each payment to the bills it settles." },
  { icon: ReceiptText, title: "GSTR-2B", body: "The monthly JSON from the GST portal — shows which supplier invoices count for credit." },
];

function DataStep({ status }: { status: OnboardingStatus }) {
  const d = status.steps.data;
  return (
    <div>
      {d.done ? (
        <Callout tone="success" className="mb-5">
          {d.documents} document{d.documents === 1 ? "" : "s"}{d.files ? ` and ${d.files} uploaded file${d.files === 1 ? "" : "s"}` : ""} in your workspace so far. You can add more any time.
        </Callout>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-3">
        {SOURCES.map((s) => (
          <li key={s.title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-2)] p-4">
            <s.icon size={20} className="text-[var(--accent)]" aria-hidden="true" />
            <p className="mt-2.5 text-[15px] font-semibold text-[var(--ink)]">{s.title}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--muted)]">{s.body}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <BtnLink href="/app/imports" icon={Upload}>Go to Import data</BtnLink>
        <BtnLink href="/app/documents" variant="secondary">Or upload a single invoice</BtnLink>
      </div>
    </div>
  );
}

/* ---------------- step 3: team ---------------- */

function TeamStep({ status }: { status: OnboardingStatus }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("ap_manager");
  const [lastLink, setLastLink] = useState<{ email: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const team = useQuery({ queryKey: ["onboarding-team"], queryFn: () => onboarding.team(), enabled: status.canInvite && !status.derived });

  const invite = useMutation({
    mutationFn: () => onboarding.invite({ email: email.trim(), role }),
    onSuccess: (data) => {
      setLastLink({ email: data.invite.email, url: `${window.location.origin}${data.joinPath}` });
      setEmail("");
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["onboarding-team"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn’t create the invitation."),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => onboarding.revokeInvite(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["onboarding-team"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
  });

  if (!status.canInvite) return <Callout tone="info">Only a workspace admin can invite people. Ask your admin to add your colleagues.</Callout>;
  if (status.derived) return <Callout tone="warn">Team invitations aren’t switched on for this server yet. You can still finish the other steps.</Callout>;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invitation link copied");
    } catch {
      toast.error("Couldn’t copy — select the link and copy it manually.");
    }
  };

  return (
    <div className="space-y-6">
      <form
        className="grid gap-4 sm:grid-cols-[1fr_220px_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) invite.mutate();
        }}
      >
        <div>
          <FieldLabel htmlFor="invite-email">Work email</FieldLabel>
          <input id="invite-email" type="email" required className={inputClass} placeholder="colleague@company.in" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="invite-role">Role</FieldLabel>
          <select id="invite-role" className={cn(inputClass, "pr-8")} value={role} onChange={(e) => setRole(e.target.value)}>
            {INVITE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]?.label ?? r}</option>)}
          </select>
        </div>
        <Btn type="submit" disabled={invite.isPending} icon={invite.isPending ? undefined : Users}>
          {invite.isPending ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          Invite
        </Btn>
        <p className="text-[14px] text-[var(--muted)] sm:col-span-3">{ROLE_LABEL[role]?.hint}</p>
      </form>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {lastLink ? (
        <Callout tone="success" title={`Invitation ready for ${lastLink.email}`}>
          <p className="mt-1">Send them this link (it works once and expires in 14 days):</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 max-w-full flex-1 truncate rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-code text-[13px]">{lastLink.url}</code>
            <Btn variant="secondary" size="sm" icon={Copy} onClick={() => copy(lastLink.url)}>Copy link</Btn>
          </div>
        </Callout>
      ) : null}

      <div>
        <h3 className="text-[15px] font-semibold text-[var(--ink)]">People in this workspace</h3>
        {team.isLoading ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : (
          <ul className="mt-2 divide-y divide-[var(--line)] rounded-[var(--radius-md)] border border-[var(--line)]">
            {(team.data?.members ?? []).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-[var(--ink)]">{m.name}</span>
                  <span className="block truncate text-[14px] text-[var(--muted)]">{m.email}</span>
                </span>
                <span className="text-[14px] text-[var(--ink-2)]">{m.roles.map(roleLabel).join(", ")}</span>
              </li>
            ))}
            {(team.data?.invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-[var(--ink)]">{i.email}</span>
                  <span className="block text-[14px] text-[var(--muted)]">{i.roles.map(roleLabel).join(", ")}</span>
                </span>
                <span className="flex items-center gap-2">
                  <ToneBadge tone="warn">Invited</ToneBadge>
                  <Btn variant="ghost" size="sm" icon={Trash2} onClick={() => revoke.mutate(i.id)} disabled={revoke.isPending} aria-label={`Cancel invitation for ${i.email}`}>
                    Cancel
                  </Btn>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------------- step 4: first check ---------------- */

function CheckStep({ status }: { status: OnboardingStatus }) {
  if (status.steps.firstCheck.done) {
    return (
      <div className="space-y-4">
        <Callout tone="success">Your first check has run. Anything that didn’t add up is waiting in To review.</Callout>
        <BtnLink href="/app/investigations" icon={ArrowRight}>Open To review</BtnLink>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ol className="space-y-2 text-[15px] leading-relaxed text-[var(--ink-2)]">
        <li>1. Open an order that has at least one invoice or delivery recorded against it.</li>
        <li>2. Choose <span className="font-semibold text-[var(--ink)]">Run check</span>. Satya lines up what was ordered, received, billed and paid.</li>
        <li>3. Anything that doesn’t match appears in <span className="font-semibold text-[var(--ink)]">To review</span>, with the documents that prove it.</li>
      </ol>
      <div className="flex flex-wrap gap-3">
        <BtnLink href="/app/orders" icon={ArrowRight}>Go to Orders</BtnLink>
        {!status.steps.data.done ? <span className="self-center text-[14px] text-[var(--muted)]">Tip: bring in your data first (step 2).</span> : null}
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { group } = useSession();
  const { data: status, isLoading, error, refetch } = useQuery({ queryKey: ["onboarding-status"], queryFn: () => onboarding.status() });
  const [open, setOpen] = useState<StepKey | null>(null);

  // Open the first unfinished step (or #team when linked from the palette).
  useEffect(() => {
    if (!status || open) return;
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    const fromHash = STEPS.find((s) => s.key === hash || (hash === "team" && s.key === "team"));
    setOpen(fromHash?.key ?? STEPS.find((s) => !status.steps[s.key].done)?.key ?? "company");
  }, [status, open]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    void queryClient.invalidateQueries();
  };

  const hide = async () => {
    try {
      if (group?.id) localStorage.setItem(setupDismissKey(group.id), "1");
    } catch {
      /* storage unavailable */
    }
    try {
      await onboarding.dismiss(true);
    } catch {
      /* older server: the local flag is enough */
    }
    void queryClient.invalidateQueries({ queryKey: ["onboarding-status"] });
    toast("Setup hidden", { description: "You can reopen it any time from Settings." });
    router.push("/app");
  };

  if (error) return <ErrorState message={error instanceof Error ? error.message : "Couldn’t load setup."} onRetry={() => refetch()} />;

  const allDone = status && status.completed >= status.total;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={status?.groupName ?? undefined}
        title="Set up your workspace"
        description="Four steps, about 15 minutes. Your progress is saved — leave and come back whenever you like."
        actions={<Btn variant="ghost" onClick={hide}>Hide setup</Btn>}
      />

      {isLoading || !status ? (
        <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex items-center justify-between gap-4">
              <p className="text-[15px] font-medium text-[var(--ink)]">
                {allDone ? "All done — your workspace is ready." : `${status.completed} of ${status.total} steps done`}
              </p>
              {allDone ? <BtnLink href="/app" size="sm">Go to Home</BtnLink> : null}
            </div>
            <Progress value={(status.completed / status.total) * 100} className="mt-3 h-2" label="Setup progress" />
          </Card>

          <ol className="space-y-3">
            {STEPS.map((step, index) => {
              const done = status.steps[step.key].done;
              const expanded = open === step.key;
              return (
                <li key={step.key} id={step.key === "team" ? "team" : undefined}>
                  <Card pad={false} className={cn(expanded && "border-[var(--line-strong)]")}>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : step.key)}
                      aria-expanded={expanded}
                      aria-controls={`step-${step.key}`}
                      className="flex w-full items-start gap-4 px-5 py-4 text-left sm:px-6"
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[14px] font-semibold tnum",
                          done ? "border-transparent bg-[var(--confirmed)] text-[var(--surface)]" : "border-[var(--line-strong)] text-[var(--ink-2)]",
                        )}
                        aria-hidden="true"
                      >
                        {done ? <Check size={16} strokeWidth={3} /> : index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-semibold text-[var(--ink)]">{step.title}</span>
                          {done ? <ToneBadge tone="good">Done</ToneBadge> : null}
                        </span>
                        <span className="mt-0.5 block text-[15px] leading-relaxed text-[var(--muted)]">{step.why}</span>
                      </span>
                      <ChevronDown size={20} className={cn("mt-1 shrink-0 text-[var(--muted)] transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                    </button>
                    {expanded ? (
                      <div id={`step-${step.key}`} className="border-t border-[var(--line)] px-5 py-5 sm:px-6">
                        {step.key === "company" ? <CompanyStep status={status} onSaved={() => { refresh(); setOpen("data"); }} /> : null}
                        {step.key === "data" ? <DataStep status={status} /> : null}
                        {step.key === "team" ? <TeamStep status={status} /> : null}
                        {step.key === "firstCheck" ? <CheckStep status={status} /> : null}
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ol>

          <p className="mt-8 text-[15px] text-[var(--muted)]">
            Need a hand? The <Link href="/guide" className="font-medium text-[var(--accent-strong)] underline-offset-2 hover:underline dark:text-[var(--accent)]">user guide</Link> walks through each step with screenshots.
          </p>
        </>
      )}
    </div>
  );
}
