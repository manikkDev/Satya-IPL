"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { AuthField, AuthLayout, authButtonClass } from "@/components/auth/auth-layout";

const DEMO_ACCOUNTS = [
  { role: "AP manager", note: "Approves & decides", email: "manager@satya.demo" },
  { role: "Operations analyst", note: "Investigates", email: "analyst@satya.demo" },
  { role: "Auditor", note: "Read-only", email: "auditor@satya.demo" },
];
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD || "SatyaDemo@123";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && !isLoading) router.replace("/app");
  }, [user, isLoading, router]);

  const signIn = async (address: string, secret: string, key: string) => {
    setBusy(key);
    setError("");
    try {
      const result = await login(address, secret);
      if (!result.success) setError(result.error || "We couldn’t sign you in. Check the email and password.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[28px] font-semibold tracking-[-0.025em] text-[var(--ink)]">Sign in</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
        Review your company’s orders, invoices and payments.
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn(email, password, "form");
        }}
        className="mt-8 space-y-4"
      >
        <AuthField id="email" label="Work email" type="email" required autoComplete="username" placeholder="you@company.in" value={email} onChange={(e) => setEmail(e.target.value)} />
        <AuthField id="password" label="Password" type="password" required autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error ? (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--sev-critical-soft)] px-3 py-2 text-sm text-[var(--sev-critical)]">
            {error}
          </p>
        ) : null}
        <button type="submit" className={authButtonClass} disabled={busy !== null || isLoading}>
          {busy === "form" ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          {busy === "form" ? "Signing in…" : <>Continue <ArrowRight size={16} aria-hidden="true" /></>}
        </button>
      </form>

      <div className="mt-9">
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span className="h-px flex-1 bg-[var(--line)]" />
          or explore the demo company
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>
        <div className="mt-4 grid gap-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              disabled={busy !== null}
              onClick={() => signIn(account.email, DEMO_PASSWORD, account.email)}
              className="group flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-left transition-colors hover:border-[var(--accent)]/45 hover:bg-[var(--accent-soft)] disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-medium text-[var(--ink)]">{account.role}</span>
                <span className="block text-xs text-[var(--muted)]">{account.note}</span>
              </span>
              {busy === account.email ? (
                <LoaderCircle size={16} className="animate-spin text-[var(--accent)]" aria-hidden="true" />
              ) : (
                <ArrowRight size={16} className="text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">
          Fictional demo company. Nothing here moves money or files returns.
        </p>
      </div>

      <p className="mt-8 text-sm text-[var(--muted)]">
        Have a company invitation?{" "}
        <Link href="/signup" className="font-medium text-[var(--accent)] hover:underline">
          Join your workspace
        </Link>
      </p>
    </AuthLayout>
  );
}
