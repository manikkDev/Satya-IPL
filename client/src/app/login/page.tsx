"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck, FileCheck2, GitBranch } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/auth-context";

const EASE = [0.21, 0.65, 0.36, 1] as const;

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (user && !isLoading) router.replace("/app"); }, [user, isLoading, router]);
  const signIn = async (address = email, secret = password) => {
    setBusy(true); setError("");
    try { const result = await login(address, secret); if (!result.success) setError(result.error || "Sign in failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="v2 flex min-h-screen bg-[var(--paper)]">
      {/* left — story */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden p-10 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{ backgroundImage: "radial-gradient(700px 420px at 80% -10%, var(--accent-glow), transparent 60%), radial-gradient(600px 400px at 0% 110%, var(--accent-glow), transparent 60%)" }}
        />
        <Link href="/" className="relative text-[19px] font-bold tracking-tight text-[var(--ink)]">
          satya<span className="text-[var(--accent)]">.</span>
        </Link>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">The truth is in the trail</p>
          <h1 className="v2-display mt-4 text-[44px] font-medium leading-[1.08] tracking-tight text-[var(--ink)]">
            Know what you<br />actually owe.<br /><span className="text-[var(--accent)]">And why.</span>
          </h1>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[var(--muted)]">
            Orders, deliveries, invoices and payments — one explainable picture for your team.
          </p>
          <div className="mt-8 space-y-3">
            {[
              { icon: FileCheck2, text: "Every figure links back to a document field" },
              { icon: GitBranch, text: "Duplicates and gaps flagged with proof" },
              { icon: ShieldCheck, text: "Missing information is never guessed" },
            ].map((item, i) => (
              <motion.p
                key={item.text}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12, duration: 0.5, ease: EASE }}
                className="flex items-center gap-3 text-sm text-[var(--ink-2)]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                  <item.icon size={14} />
                </span>
                {item.text}
              </motion.p>
            ))}
          </div>
        </motion.div>
        <p className="relative text-xs text-[var(--muted)]">Built for Indian business operations · INR / IST</p>
      </div>

      {/* right — form */}
      <div className="flex w-full items-center justify-center border-l border-[var(--line)] bg-[var(--surface)]/60 px-6 py-12 lg:w-[480px] lg:shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
          className="w-full max-w-sm"
        >
          <Link href="/" className="text-[19px] font-bold tracking-tight text-[var(--ink)] lg:hidden">
            satya<span className="text-[var(--accent)]">.</span>
          </Link>
          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] lg:mt-0">Company workspace</p>
          <h2 className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--ink)]">Welcome to Satya.</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
            Sign in to review your company’s orders, invoices and payments.
          </p>
          <form onSubmit={(event) => { event.preventDefault(); signIn(); }} className="mt-7 space-y-5">
            <div>
              <label htmlFor="email" className="text-[13px] font-medium text-[var(--ink-2)]">Work email</label>
              <Input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-10 border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]" autoComplete="username" placeholder="you@company.in" />
            </div>
            <div>
              <label htmlFor="password" className="text-[13px] font-medium text-[var(--ink-2)]">Password</label>
              <Input id="password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-10 border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]" autoComplete="current-password" placeholder="••••••••" />
            </div>
            {error && <p role="alert" className="text-sm text-[var(--sev-critical)]">{error}</p>}
            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[15px] font-semibold text-white shadow-[0_1px_0_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.15)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-[var(--shadow-2)] disabled:opacity-50 dark:text-[#06231c]"
              disabled={busy || isLoading}
            >
              {busy ? "Signing in…" : <>Enter workspace <ArrowRight size={16} /></>}
            </button>
          </form>
          <div className="mt-7 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Local demonstration accounts</p>
            <div className="mt-3 space-y-1.5">
              {[["Finance manager", "manager@satya.demo"], ["Operations analyst", "analyst@satya.demo"], ["Auditor", "auditor@satya.demo"]].map(([label, address]) => (
                <button
                  key={address}
                  type="button"
                  disabled={busy}
                  onClick={() => signIn(address, "SatyaDemo@123")}
                  className="flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] px-3 py-2 text-left text-[13px] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 hover:bg-[var(--accent-soft)] hover:text-[var(--ink)]"
                >
                  {label}
                  <span className="font-code text-[11px] text-[var(--muted)]">{address}</span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
              These accounts exist only when the server’s DEMO_MODE=1. Custom demo passwords require manual sign-in.
            </p>
          </div>
          <p className="mt-6 text-xs text-[var(--muted)]">
            Have a company invitation? <Link href="/signup" className="font-medium text-[var(--accent)] hover:underline">Create your workspace</Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
