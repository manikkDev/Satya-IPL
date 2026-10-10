"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";

export function MetricCard({ label, value, detail, tone = "indigo" }) {
  const tones = { indigo: "from-indigo-500/20 to-indigo-500/5", emerald: "from-emerald-500/20 to-emerald-500/5", amber: "from-amber-500/20 to-amber-500/5", rose: "from-rose-500/20 to-rose-500/5" };
  return <article className={`rounded-2xl border bg-gradient-to-br ${tones[tone] || tones.indigo} p-5`}><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p>{detail && <p className="mt-2 text-sm text-muted-foreground">{detail}</p>}</article>;
}

export function LoadingPanel({ text = "Loading privacy-preserving intelligence…" }) {
  return <div className="rounded-2xl border bg-card p-10 text-center text-muted-foreground">{text}</div>;
}

export function ErrorPanel({ message }) {
  return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-sm text-rose-700 dark:text-rose-300">{message}</div>;
}

export default function RiskShell({ title, subtitle, role = "analyst", children }) {
  const { user, logout } = useAuth();
  const analystLinks = [["/analyst", "Overview"], ["/analyst/fl", "Federated learning"], ["/analyst/graph", "Risk graph"], ["/analyst/fairness", "Fairness"], ["/analyst/audit", "Audit"], ["/chat?mode=risk_analyst", "Copilot"]];
  const citizenLinks = [["/citizen", "Risk profile"], ["/citizen/consent", "Consent"], ["/chat?mode=risk_citizen", "Copilot"]];
  const links = role === "citizen" ? citizenLinks : analystLinks;
  return <main className="min-h-screen bg-background text-foreground"><header className="border-b bg-card/80 backdrop-blur"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4"><div><Link href="/" className="text-lg font-semibold">Arth Saathi</Link><p className="text-xs text-muted-foreground">Privacy-preserving financial risk control</p></div><nav className="flex flex-wrap gap-1">{links.map(([href, label]) => <Link key={href} href={href} className="rounded-lg px-3 py-2 text-sm hover:bg-muted">{label}</Link>)}</nav><div className="flex items-center gap-3 text-sm"><span className="hidden text-muted-foreground sm:inline">{user?.name || user?.email}</span><button onClick={logout} className="rounded-lg border px-3 py-2 hover:bg-muted">Sign out</button></div></div></header><div className="mx-auto max-w-7xl space-y-7 px-6 py-8"><div><p className="text-xs font-medium uppercase tracking-[0.2em] text-indigo-600">{role === "citizen" ? "Citizen portal" : `Bank ${user?.institutionId ?? "admin"} analyst`}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 max-w-3xl text-muted-foreground">{subtitle}</p></div>{children}</div></main>;
}
