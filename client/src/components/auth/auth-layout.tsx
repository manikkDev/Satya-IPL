// Shared split layout for sign-in / sign-up. Left: a calm product story with
// a miniature evidence trail (the thing Satya actually does). Right: the form.

import Link from "next/link";
import { Check, FileText, PackageCheck, ReceiptText, Landmark } from "lucide-react";
import { Logo } from "@/components/brand/logo";

const TRAIL = [
  { icon: FileText, label: "Purchase order", detail: "100 pumps · ₹70,800", tone: "ok" },
  { icon: PackageCheck, label: "Goods received", detail: "60 of 100 accepted", tone: "warn" },
  { icon: ReceiptText, label: "Supplier invoice", detail: "Billed for 100 · posted twice", tone: "bad" },
  { icon: Landmark, label: "Payments", detail: "₹50,800 settled · ₹15,000 unlinked", tone: "warn" },
] as const;

const TONE: Record<(typeof TRAIL)[number]["tone"], string> = {
  ok: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25",
  warn: "bg-amber-300/15 text-amber-100 ring-amber-200/25",
  bad: "bg-rose-400/15 text-rose-100 ring-rose-300/25",
};

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[var(--paper)]">
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-[#0a3d31] p-12 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            backgroundImage:
              "radial-gradient(800px 460px at 110% -10%, rgb(60 203 156 / 0.28), transparent 60%), radial-gradient(520px 380px at -10% 110%, rgb(240 164 75 / 0.14), transparent 60%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(rgb(255 255 255) 1px, transparent 1px)", backgroundSize: "100% 44px" }}
        />
        <Link href="/" className="relative inline-flex w-fit" aria-label="Satya home">
          <Logo size={30} wordClassName="text-white" />
        </Link>

        <div className="relative">
          <h1 className="font-display text-[52px] leading-[1.02] tracking-[-0.01em]">
            Know what you really owe.
            <br />
            <span className="italic text-[#9be8cd]">And why.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-white/72">
            Satya lines up every order, delivery, invoice and payment — then shows you the gaps, with the documents to prove
            each one.
          </p>

          <ol className="mt-10 max-w-md space-y-0">
            {TRAIL.map((step, i) => (
              <li key={step.label} className="relative flex gap-4 pb-5 last:pb-0">
                {i < TRAIL.length - 1 ? (
                  <span aria-hidden="true" className="absolute left-[17px] top-9 h-[calc(100%-26px)] w-px bg-white/15" />
                ) : null}
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ${TONE[step.tone]}`}>
                  <step.icon size={16} aria-hidden="true" />
                </span>
                <div className="pt-1">
                  <p className="text-sm font-medium text-white">{step.label}</p>
                  <p className="text-[13px] text-white/60">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex max-w-md items-start gap-3 rounded-xl bg-white/[0.06] p-4 ring-1 ring-white/10">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#F0A44B] text-[#3b2208]">
              <Check size={12} strokeWidth={3} aria-hidden="true" />
            </span>
            <p className="text-[13.5px] leading-relaxed text-white/80">
              Pay <span className="font-semibold text-white">₹20,000</span> on delivered goods. Hold the duplicate posting until
              the supplier confirms — every figure links to its source.
            </p>
          </div>
        </div>

        <p className="relative text-xs text-white/50">Built for Indian businesses · INR · GST · IST</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8">
        <div className="rise w-full max-w-[400px]">
          <Link href="/" className="mb-10 inline-flex lg:hidden" aria-label="Satya home">
            <Logo size={30} />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}

export function AuthField({
  id,
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="text-[13px] font-medium text-[var(--ink-2)]">
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="mt-1.5 block h-11 w-full rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3.5 text-[15px] text-[var(--ink)] shadow-[var(--shadow-1)] outline-none transition-colors placeholder:text-[var(--muted)]/70 focus:border-[var(--accent)] focus:ring-3 focus:ring-[var(--accent-glow)]"
      />
      {hint ? <p className="mt-1.5 text-xs text-[var(--muted)]">{hint}</p> : null}
    </div>
  );
}

export const authButtonClass =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[15px] font-medium text-[var(--on-accent)] shadow-[0_1px_0_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.14)] transition-colors hover:bg-[var(--accent-strong)] disabled:opacity-60";
