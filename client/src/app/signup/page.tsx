"use client";

// /signup — "Start a pilot": creates a NEW company workspace through
// POST /api/v2/auth/signup (the signer-up becomes its admin), then opens the
// first-run setup. /signup?invite=<token> instead joins an existing
// workspace through POST /api/v2/auth/accept-invite.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, Check } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AuthCard, AuthField, AuthLayout, FormError, authButtonClass } from "@/components/auth/auth-layout";
import { onboarding, type InviteLookup } from "@/lib/api/onboarding";
import { roleLabel } from "@/content/copy/vocabulary";
import { ApiError } from "@/lib/api/client";

/** "Deccan Valve Industries Pvt Ltd" → "DVI" (2–8 letters, used in document numbers). */
function entityCodeFor(company: string): string | undefined {
  const words = company.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
    .filter((w) => !["PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "AND", "THE", "CO", "OF", "INDIA"].includes(w));
  const initials = words.map((w) => w[0]).join("").slice(0, 6);
  const code = initials.length >= 2 ? initials : (words[0] ?? "").slice(0, 4);
  return /^[A-Z0-9]{2,8}$/.test(code) ? code : undefined;
}

const NEXT_STEPS = [
  "Add your GSTIN — we fill in the state for you",
  "Import Tally exports, bank statements or GSTR-2B",
  "Invite your team with the right roles",
  "Run your first check and see what needs attention",
];

function CreateWorkspace() {
  const { signup } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", companyName: "", password: "" });
  const [error, setError] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (values.password.length < 10) {
      setFields(["password"]);
      setError("Use at least 10 characters for your password.");
      return;
    }
    setBusy(true);
    setError("");
    setFields([]);
    const result = await signup({ ...values, entityCode: entityCodeFor(values.companyName) });
    if (!result.success) {
      setError(result.error || "We couldn’t create your workspace.");
      setFields(result.fields ?? []);
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
      <AuthCard>
        <p className="type-eyebrow">Start a pilot</p>
        <h1 className="type-page-title mt-1.5">Create your company’s workspace</h1>
        <p className="mt-2 text-base text-[var(--muted)]">
          A private workspace for your finance team. You’ll be its admin and can invite colleagues next.
        </p>
        <form onSubmit={submit} className="mt-7 space-y-5" noValidate>
          <AuthField id="name" label="Your name" required autoComplete="name" value={values.name} onChange={set("name")} error={fields.includes("name") ? "Enter your name." : undefined} />
          <AuthField id="email" label="Work email" type="email" required autoComplete="email" placeholder="you@company.in" value={values.email} onChange={set("email")} error={fields.includes("email") ? "Enter a valid work email." : undefined} />
          <AuthField
            id="companyName"
            label="Company name"
            required
            autoComplete="organization"
            placeholder="e.g. Deccan Valve Industries Pvt Ltd"
            hint="Your legal name as it appears on GST invoices."
            value={values.companyName}
            onChange={set("companyName")}
            error={fields.includes("groupName") || fields.includes("entityLegalName") ? "Enter your company name." : undefined}
          />
          <AuthField
            id="password"
            label="Password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            hint="At least 10 characters. A short phrase is easier to remember."
            value={values.password}
            onChange={set("password")}
            error={fields.includes("password") ? error : undefined}
          />
          {error && !fields.includes("password") ? <FormError>{error}</FormError> : null}
          <button type="submit" disabled={busy} className={authButtonClass}>
            {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : null}
            {busy ? "Creating your workspace…" : "Create workspace"}
          </button>
          <p className="text-[14px] leading-relaxed text-[var(--muted)]">
            By continuing you agree to the <Link href="/legal/terms" className="underline underline-offset-2 hover:text-[var(--ink)]">terms</Link> and{" "}
            <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-[var(--ink)]">privacy policy</Link>. Satya is a prototype: please use sample or anonymised data.
          </p>
        </form>
      </AuthCard>

      <aside className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-2)] p-6 sm:p-8">
        <h2 className="type-section-title">What happens next</h2>
        <ol className="mt-5 space-y-4">
          {NEXT_STEPS.map((step, i) => (
            <li key={step} className="flex gap-3.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-[var(--line-strong)] bg-[var(--surface)] text-[14px] font-semibold text-[var(--ink-2)] tnum">{i + 1}</span>
              <span className="pt-0.5 text-[15px] leading-relaxed text-[var(--ink-2)]">{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-7 border-t border-[var(--line)] pt-5 text-[15px] leading-relaxed text-[var(--muted)]">
          Just looking?{" "}
          <Link href="/login?demo=1" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Try the live demo</Link>{" "}
          with a fictional company first — no sign-up needed.
        </div>
      </aside>
    </div>
  );
}

function JoinWorkspace({ token }: { token: string }) {
  const { acceptInvite } = useAuth();
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [values, setValues] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    onboarding
      .lookupInvite(token)
      .then((data) => live && setInvite(data))
      .catch((err) => live && setLookupError(err instanceof ApiError ? err.message : "We couldn’t check this invitation. Try again in a moment."));
    return () => {
      live = false;
    };
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await acceptInvite(token, invite?.hasAccount ? { password: values.password } : values);
    if (!result.success) {
      setError(result.error || "We couldn’t accept this invitation.");
      setBusy(false);
    }
  };

  if (lookupError) {
    return (
      <AuthCard>
        <h1 className="type-page-title">This invitation can’t be used</h1>
        <p className="mt-3 text-base text-[var(--muted)]">{lookupError}</p>
        <p className="mt-6 text-[15px] text-[var(--muted)]">
          Already have an account? <Link href="/login" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Sign in</Link>
        </p>
      </AuthCard>
    );
  }
  if (!invite) {
    return (
      <AuthCard>
        <p className="flex items-center gap-2 text-base text-[var(--muted)]">
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Checking your invitation…
        </p>
      </AuthCard>
    );
  }
  return (
    <AuthCard>
      <p className="type-eyebrow">You’re invited</p>
      <h1 className="type-page-title mt-1.5">Join {invite.groupName} on Satya</h1>
      <p className="mt-2 text-base text-[var(--muted)]">
        {invite.invitedByName ? `${invite.invitedByName} invited you` : "You’ve been invited"} as{" "}
        <span className="font-semibold text-[var(--ink)]">{invite.roles.map(roleLabel).join(", ")}</span>.
      </p>
      <form onSubmit={submit} className="mt-7 space-y-5">
        <AuthField id="email" label="Work email" type="email" readOnly value={invite.email} />
        {invite.hasAccount ? (
          <p className="flex items-start gap-2 text-[15px] text-[var(--ink-2)]">
            <Check size={18} className="mt-0.5 shrink-0 text-[var(--confirmed)]" aria-hidden="true" />
            You already have a Satya account. Enter its password to add this workspace.
          </p>
        ) : (
          <AuthField id="name" label="Your name" required autoComplete="name" value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
        )}
        <AuthField
          id="password"
          label={invite.hasAccount ? "Your Satya password" : "Choose a password"}
          type="password"
          required
          minLength={invite.hasAccount ? 1 : 10}
          autoComplete={invite.hasAccount ? "current-password" : "new-password"}
          hint={invite.hasAccount ? undefined : "At least 10 characters."}
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
        />
        {error ? <FormError>{error}</FormError> : null}
        <button type="submit" disabled={busy} className={authButtonClass}>
          {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : null}
          {busy ? "Joining…" : `Join ${invite.groupName}`}
        </button>
      </form>
    </AuthCard>
  );
}

function SignupInner() {
  const params = useSearchParams();
  const invite = params.get("invite");
  return (
    <AuthLayout wide={!invite} headerLink={{ prompt: "Already have an account?", label: "Sign in", href: "/login" }}>
      {invite ? <JoinWorkspace token={invite} /> : <CreateWorkspace />}
    </AuthLayout>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupInner />
    </Suspense>
  );
}
