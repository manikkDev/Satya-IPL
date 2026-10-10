"use client";

import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/BusinessShell";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";
import { SERVER_URL } from "@/utils/commonHelper";

export default function SignupPage() {
  const { login } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <main className="satya-login"><div className="satya-login-story"><Brand /><div><p className="satya-eyebrow">COMPANY ACCESS, BY INVITATION.</p><h1>Shared evidence.<br /><em>Clear permissions.</em></h1><p>Your administrator provisions company membership. You cannot self-assign financial approval authority.</p></div><Link href="/login" className="text-sm text-primary">Already a member? Sign in</Link></div><section className="satya-login-form"><h2>Join your workspace.</h2><form className="space-y-5 mt-8" onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const response = await fetch(`${SERVER_URL}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...values, role: "ops_analyst" }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message || "Invitation could not be validated"); await login(values.email, values.password); }
    catch (error) { setError(error instanceof Error ? error.message : "Signup failed"); }
    finally { setBusy(false); }
  }}>{Object.entries(values).map(([key, value]) => <div key={key}><label htmlFor={key} className="text-sm">{({ name: "Your name", email: "Work email", password: "Password · at least 12 characters", inviteCode: "Company invitation code" } as Record<string, string>)[key]}</label><Input id={key} type={key === "password" ? "password" : key === "email" ? "email" : "text"} required minLength={key === "password" ? 12 : 1} className="mt-2" value={value} onChange={(event) => setValues((previous) => ({ ...previous, [key]: event.target.value }))} /></div>)}{error && <p role="alert" className="text-red-400 text-sm">{error}</p>}<button disabled={busy} className="satya-button w-full">{busy ? "Checking invitation…" : "Join as operations analyst"}</button></form><p className="text-xs text-muted-foreground mt-5">If your administrator has not configured invitations, use a provisioned account. Public privileged signup is disabled.</p></section></main>;
}
