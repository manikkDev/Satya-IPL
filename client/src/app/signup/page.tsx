"use client";

import Link from "next/link";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { SERVER_URL } from "@/utils/commonHelper";
import { AuthField, AuthLayout, authButtonClass } from "@/components/auth/auth-layout";

export default function SignupPage() {
  const { login } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${SERVER_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, role: "ops_analyst" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "That invitation code couldn’t be validated.");
      await login(values.email, values.password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-up failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-[28px] font-semibold tracking-[-0.025em] text-[var(--ink)]">Join your workspace</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">
        Your administrator sends an invitation code. Approval rights are granted by them — never self-assigned.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <AuthField id="name" label="Your name" required autoComplete="name" value={values.name} onChange={set("name")} />
        <AuthField id="email" label="Work email" type="email" required autoComplete="email" value={values.email} onChange={set("email")} />
        <AuthField id="password" label="Password" type="password" required minLength={12} autoComplete="new-password" hint="At least 12 characters." value={values.password} onChange={set("password")} />
        <AuthField id="inviteCode" label="Invitation code" required value={values.inviteCode} onChange={set("inviteCode")} />
        {error ? (
          <p role="alert" className="rounded-[var(--radius-sm)] bg-[var(--sev-critical-soft)] px-3 py-2 text-sm text-[var(--sev-critical)]">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={authButtonClass}>
          {busy ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : null}
          {busy ? "Checking invitation…" : "Join as operations analyst"}
        </button>
      </form>
      <p className="mt-8 text-sm text-[var(--muted)]">
        Already a member?{" "}
        <Link href="/login" className="font-medium text-[var(--accent)] hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
