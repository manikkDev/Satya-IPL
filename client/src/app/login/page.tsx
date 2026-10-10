"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Brand } from "@/components/BusinessShell";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (user && !isLoading) router.replace("/dashboard"); }, [user, isLoading, router]);
  const signIn = async (address = email, secret = password) => {
    setBusy(true); setError("");
    try { const result = await login(address, secret); if (!result.success) setError(result.error || "Sign in failed"); }
    finally { setBusy(false); }
  };
  return <main className="satya-login"><div className="satya-login-story"><Brand /><div><p className="satya-eyebrow">THE TRUTH IS IN THE TRAIL.</p><h1>Know what you<br />actually owe.<br /><em>And why.</em></h1><p>Orders, deliveries, invoices and payments.<br />One explainable picture for your team.</p></div><span className="text-xs text-muted-foreground">Built for Indian business operations · INR / IST</span></div><section className="satya-login-form"><span className="satya-tag">COMPANY WORKSPACE</span><h2>Welcome to Satya.</h2><p className="text-muted-foreground text-sm">Sign in to review your company’s orders, invoices and payments.</p><form onSubmit={(event) => { event.preventDefault(); signIn(); }} className="space-y-5 mt-8"><div><label htmlFor="email" className="text-sm">Work email</label><Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2" autoComplete="username" /></div><div><label htmlFor="password" className="text-sm">Password</label><Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2" autoComplete="current-password" /></div>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<button className="satya-button w-full" disabled={busy || isLoading}>{busy ? "Signing in…" : "Enter workspace"}</button></form><div className="satya-demo-logins"><p>Local demonstration accounts</p>{[["Finance manager", "manager@satya.demo"], ["Operations analyst", "analyst@satya.demo"], ["Auditor", "auditor@satya.demo"]].map(([label, address]) => <button key={address} disabled={busy} onClick={() => signIn(address, "SatyaDemo@123")}>{label}<span>{address}</span></button>)}<small>These accounts exist only when the server&apos;s DEMO_MODE=1. Custom demo passwords require manual sign-in.</small></div><p className="text-xs text-muted-foreground mt-6">Have a company invitation? <Link href="/signup" className="text-primary underline">Join your workspace</Link></p></section></main>;
}
