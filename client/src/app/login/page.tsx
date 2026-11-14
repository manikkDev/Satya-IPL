"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LoaderCircle, Building2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AuthCard, AuthField, AuthLayout, FormError, authButtonClass } from "@/components/auth/auth-layout";
import { cn } from "@/lib/utils";

// The three demo people share one fictional company, so a visitor can see
// how the same records look to someone who decides, prepares or audits.
const DEMO_ACCOUNTS = [
  { role: "AP manager", sees: "Decides on flagged bills, approves orders and releases payments.", email: "manager@satya.demo" },
  { role: "Accounts executive", sees: "Uploads invoices, raises orders and imports bank statements.", email: "analyst@satya.demo" },
  { role: "Auditor", sees: "Read-only: every record, decision and its evidence.", email: "auditor@satya.demo" },
];
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "SatyaDemo@123";

/** Only same-site /app paths are accepted as a post-login destination. */
const safeNext = (value: string | null) => (value && /^\/app(\/|$|\?)/.test(value) && !value.startsWith("//") ? value : "/app");

function LoginInner() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const demoFirst = params.get("demo") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [demoError, setDemoError] = useState("");

  useEffect(() => {
    if (user && !isLoading) router.replace(next);
  }, [user, isLoading, router, next]);

  const signIn = async (address: string, secret: string, key: string) => {
    setBusy(key);
    setError("");
    setDemoError("");
    try {
      const result = await login(address, secret, next);
      if (!result.success) (key === "form" ? setError : setDemoError)(result.error || "We couldn’t sign you in.");
    } finally {
      setBusy(null);
    }
  };

  const signInCard = (
    <AuthCard className={cn(demoFirst && "order-2 lg:order-1")}>
      <h1 className="type-page-title">Sign in</h1>
      <p className="mt-2 text-base text-[var(--muted)]">Use the work email your company’s Satya workspace was set up with.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email, password, "form");
        }}
        className="mt-7 space-y-5"
      >
        <AuthField id="email" label="Work email" type="email" required autoComplete="username" placeholder="you@company.in" value={email} onChange={(e) => setEmail(e.target.value)} />
        <AuthField id="password" label="Password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? <FormError>{error}</FormError> : null}
        <button type="submit" className={authButtonClass} disabled={busy !== null || isLoading}>
          {busy === "form" ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : null}
          {busy === "form" ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-[15px] text-[var(--muted)]">
        Invited by a colleague? Open the link in your invitation email.
        <br />
        Forgot your password? Ask your workspace admin for help.
      </p>
    </AuthCard>
  );

  const demoCard = (
    <section aria-labelledby="demo-title" className={cn("rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface-2)] p-6 sm:p-8", demoFirst && "order-1 lg:order-2")}>
      <p className="type-eyebrow">Live demo · no sign-up</p>
      <h2 id="demo-title" className="mt-1.5 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--ink)]">Explore a fictional company</h2>
      <div className="mt-4 flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Building2 size={20} aria-hidden="true" />
        </span>
        <p className="text-[15px] leading-relaxed text-[var(--ink-2)]">
          <span className="font-semibold text-[var(--ink)]">Satya Equipment Distribution</span> is a made-up pump and valve
          distributor in Pune, with a year of sample orders, invoices, payments and GST records — including the duplicate
          bills and missed deadlines Satya is built to catch.
        </p>
      </div>
      <p className="mt-5 text-[15px] font-medium text-[var(--ink)]">Choose who you want to be:</p>
      <div className="mt-3 grid gap-2.5">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            disabled={busy !== null}
            onClick={() => signIn(account.email, DEMO_PASSWORD, account.email)}
            className="group flex items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3.5 text-left transition-colors hover:border-[var(--accent)] disabled:opacity-60"
          >
            <span className="min-w-0">
              <span className="block text-base font-semibold text-[var(--ink)]">{account.role}</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-[var(--muted)]">{account.sees}</span>
            </span>
            {busy === account.email ? (
              <LoaderCircle size={18} className="shrink-0 animate-spin text-[var(--accent)]" aria-hidden="true" />
            ) : (
              <ArrowRight size={18} className="shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      {demoError ? <div className="mt-4"><FormError>{demoError}</FormError></div> : null}
      <p className="mt-4 text-[14px] leading-relaxed text-[var(--muted)]">
        Sample data only — nothing here moves money or files returns. Want to try it on your own records?{" "}
        <Link href="/signup" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Start a pilot</Link>.
      </p>
    </section>
  );

  return (
    <AuthLayout wide headerLink={{ prompt: "New to Satya?", label: "Start a pilot", href: "/signup" }}>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.05fr] lg:gap-8">
        {signInCard}
        {demoCard}
      </div>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
