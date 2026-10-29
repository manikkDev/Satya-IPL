"use client";

// Satya public landing — dark showcase (docs/plan/06 §7). Every claim carries
// a source or is clearly labelled product capability. Motion respects
// prefers-reduced-motion via framer-motion defaults + CSS guards.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Files, PackageCheck, Wallet, FileCheck2, ShieldCheck,
  GitBranch, MessageSquare, ScanSearch, Scale, Landmark, ReceiptText, Truck,
  CircleCheck, Sun, Moon, Menu, X, Sparkles, Lock, FileText, IndianRupee,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/* ---------------- helpers ---------------- */

const EASE = [0.21, 0.65, 0.36, 1] as const;

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-70px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent)]">{children}</p>
  );
}

function CountUpText({ value, className }: { value: string; className?: string }) {
  // Parses the leading number for a count-up effect (display only).
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const match = value.match(/^([^\d]*)([\d.,]+)(.*)$/);
  const target = match ? parseFloat(match[2].replace(/,/g, "")) : 0;
  const decimals = match && match[2].includes(".") ? match[2].split(".")[1].length : 0;
  const [display, setDisplay] = useState("0");
  useEffect(() => {
    if (!inView || !match) {
      if (!match) setDisplay(value);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(match[2]);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / 1400, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay((target * eased).toFixed(decimals));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, target, decimals, match, value]);
  return (
    <span ref={ref} className={className}>
      {match ? `${match[1]}${display}${match[3]}` : value}
    </span>
  );
}

/* ---------------- animated money trail (hero) ---------------- */

function TrailNode({
  icon: Icon, title, sub, tone = "neutral", delay,
}: {
  icon: React.ElementType; title: string; sub: string;
  tone?: "neutral" | "warn" | "good"; delay: number;
}) {
  const tones = {
    neutral: "border-[var(--line-strong)] bg-[var(--surface)]",
    warn: "border-[var(--sev-high)]/60 bg-[var(--surface)] shadow-[0_0_24px_rgb(251_146_60/0.12)]",
    good: "border-[var(--accent)]/50 bg-[var(--surface)] shadow-[0_0_24px_var(--accent-glow)]",
  } as const;
  const iconTones = {
    neutral: "bg-[var(--surface-2)] text-[var(--ink-2)]",
    warn: "bg-[var(--sev-high-soft)] text-[var(--sev-high)]",
    good: "bg-[var(--accent-soft)] text-[var(--accent)]",
  } as const;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: EASE }}
      className={cn("relative flex items-center gap-3 rounded-xl border px-4 py-3", tones[tone])}
    >
      <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", iconTones[tone])}>
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{title}</span>
        <span className="block truncate text-[11px] text-[var(--muted)]">{sub}</span>
      </span>
      {tone === "warn" && (
        <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--sev-high)] text-[9px] font-bold text-[#1a0d00]">
          !
        </span>
      )}
    </motion.div>
  );
}

function TrailLink({ delay }: { delay: number }) {
  return (
    <motion.div
      initial={{ scaleX: 0 }}
      animate={{ scaleX: 1 }}
      transition={{ delay, duration: 0.4, ease: "easeOut" }}
      className="relative mx-1 h-px w-8 origin-left bg-[var(--line-strong)] sm:w-10"
      aria-hidden="true"
    >
      <motion.span
        className="absolute -top-[2px] h-[5px] w-[5px] rounded-full bg-[var(--accent)]"
        animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
        transition={{ delay: delay + 0.5, duration: 1.4, repeat: Infinity, repeatDelay: 1.8, ease: "easeInOut" }}
      />
    </motion.div>
  );
}

function HeroTrail() {
  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-[32px] bg-[radial-gradient(70%_60%_at_50%_20%,var(--accent-glow),transparent_70%)] opacity-70" aria-hidden="true" />
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
        className="relative rounded-2xl border border-[var(--line)] bg-[var(--surface)]/80 p-5 shadow-[var(--shadow-3)] backdrop-blur"
      >
        <div className="flex items-center justify-between pb-4">
          <p className="text-xs font-semibold text-[var(--ink)]">PO VPPL/PO/26-27/000123 · Mehta Engineering</p>
          <span className="rounded-full border border-[var(--sev-medium)]/40 bg-[var(--sev-medium-soft)] px-2.5 py-1 text-[10px] font-medium text-[var(--sev-medium)]">
            Needs review
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center">
            <TrailNode icon={FileText} title="Ordered 100 pumps" sub="Purchase order · 14 Oct" delay={0.4} />
            <TrailLink delay={0.7} />
            <TrailNode icon={PackageCheck} title="60 delivered" sub="2 goods receipts" tone="good" delay={0.9} />
          </div>
          <div className="flex items-center">
            <TrailNode icon={ReceiptText} title="INV-041 · ₹70,800" sub="Supplier tax invoice" delay={1.2} />
            <TrailLink delay={1.5} />
            <TrailNode icon={ScanSearch} title="INV-041 again" sub="Same invoice, keyed twice" tone="warn" delay={1.7} />
          </div>
          <div className="flex items-center">
            <TrailNode icon={Wallet} title="₹50,800 paid" sub="Two bank transfers" delay={2.0} />
            <TrailLink delay={2.3} />
            <TrailNode icon={CircleCheck} title="₹20,000 really owed" sub="Backed by deliveries" tone="good" delay={2.5} />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.9, duration: 0.5 }}
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-[var(--sev-high)]/35 bg-[var(--sev-high-soft)] px-3.5 py-2.5"
        >
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--sev-high)]" />
          <p className="text-xs leading-relaxed text-[var(--ink-2)]">
            <span className="font-semibold text-[var(--ink)]">Put ₹70,800 on hold</span> — likely a duplicate.
            Approve the ₹20,000 backed by deliveries. One ₹15,000 transfer still needs a reference.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ---------------- sections ---------------- */

const STATS = [
  { value: "₹7.34 lakh crore", note: "in delayed payments owed to India's MSMEs (Mar 2024)", source: "GAME–FISME–C2FO, Delayed Payments 3.0" },
  { value: "0.8–2%", note: "of annual disbursements are duplicate or erroneous payments", source: "APQC benchmarking via CFO.com" },
  { value: "~16%", note: "of India's gross value added comes from manufacturing", source: "MoSPI, Lok Sabha answer (2025-26 PE)" },
];

const STEPS = [
  { icon: Files, title: "Create or import", text: "Raise a purchase order in minutes — GST, HSN codes and approval rules built in — or drop in your existing documents." },
  { icon: ScanSearch, title: "Satya reads & checks", text: "Invoices, receipts, e-invoice QR codes and bank transfers are matched against what was ordered and accepted." },
  { icon: GitBranch, title: "See issues with proof", text: "Duplicate bills, short deliveries, unlinked payments — each flagged with the exact document and field behind it." },
  { icon: Scale, title: "Decide with confidence", text: "Approve, ask for clarification or put an amount on hold. Your call is recorded with the reason." },
];

const FEATURES = [
  { icon: FileText, title: "Purchase orders & PIs", text: "Guided creation with GST, delivery schedules, terms and a print-ready PDF with your letterhead." },
  { icon: ScanSearch, title: "Document reading", text: "PDFs, photos, e-invoice JSON and bank CSVs — fields extracted with confidence scores for you to confirm." },
  { icon: ShieldCheck, title: "Evidence-backed issues", text: "Every flag shows the document, the field and the calculation — nothing is a black box." },
  { icon: Scale, title: "Honest about doubt", text: "When two explanations fit, Satya says so and lists the candidates instead of guessing." },
  { icon: Landmark, title: "Compliance deadlines", text: "MSME 45-day payments, GST credit rules and e-invoice windows — tracked before they cost you." },
  { icon: MessageSquare, title: "Ask Satya", text: "Ask in plain words; answers cite your documents and never invent a figure." },
  { icon: GitBranch, title: "Money-trail graph", text: "Watch an order's story — order to delivery to invoice to payment — on one interactive canvas." },
  { icon: Lock, title: "Audit trail", text: "Every decision is hash-chained. Export a full evidence pack for your auditor in one click." },
];

const INDIA_CHIPS = [
  "GST — CGST · SGST · IGST", "e-invoice QR verification", "e-way bill checks", "MSME 45-day rule",
  "TDS on goods (194Q)", "Letter of Undertaking", "GSTR-2B & IMS", "HSN rate master",
  "FY-wise numbering", "₹ Indian grouping", "IST dates", "Udyam / MSME status",
];

const STORY = [
  { n: "01", title: "100 pumps ordered", text: "Your team issues a purchase order — two delivery batches, clear terms, correct GST." },
  { n: "02", title: "60 pumps arrive", text: "Stores records two goods receipts. The remaining 40 are still on the way — not a problem yet." },
  { n: "03", title: "The same invoice appears twice", text: "INV-041 for ₹70,800 is entered once as “INV-041” and once as “INV/041”. Satya flags it as a likely duplicate." },
  { n: "04", title: "Payments split across transfers", text: "₹30,000 + ₹20,800 settle the invoice. Another ₹15,000 transfer has no reference — Satya shows the invoices it could be." },
  { n: "05", title: "The true position", text: "₹20,000 really owed — backed by deliveries. ₹70,800 on hold pending supplier confirmation." },
];

export function Landing() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || theme === "dark";

  return (
    <div className="v2 min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--topbar-bg)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Link href="/" className="text-[19px] font-bold tracking-tight">
            satya<span className="text-[var(--accent)]">.</span>
          </Link>
          <nav className="ml-8 hidden items-center gap-6 text-sm text-[var(--ink-2)] md:flex" aria-label="Site">
            <a href="#how" className="transition-colors hover:text-[var(--ink)]">How it works</a>
            <a href="#story" className="transition-colors hover:text-[var(--ink)]">A real case</a>
            <a href="#features" className="transition-colors hover:text-[var(--ink)]">Features</a>
            <Link href="/research" className="transition-colors hover:text-[var(--ink)]">Research</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setTheme(dark ? "light" : "dark")}
              aria-label="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-2)] transition-colors hover:text-[var(--ink)]"
            >
              {dark ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <Link
              href="/app"
              className="hidden h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white shadow-[0_1px_0_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.15)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-[var(--shadow-2)] sm:inline-flex dark:text-[#06231c]"
            >
              Open workspace <ArrowUpRight size={15} />
            </Link>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] md:hidden"
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-[var(--line)] px-5 py-4 md:hidden" aria-label="Site mobile">
            <div className="flex flex-col gap-3 text-sm text-[var(--ink-2)]">
              <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
              <a href="#story" onClick={() => setMenuOpen(false)}>A real case</a>
              <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
              <Link href="/research">Research</Link>
              <Link href="/app" className="font-semibold text-[var(--accent)]">Open workspace →</Link>
            </div>
          </nav>
        )}
      </header>

      {/* ---------- hero ---------- */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(900px 420px at 70% -10%, var(--accent-glow), transparent 60%), radial-gradient(700px 380px at 10% 110%, var(--accent-glow), transparent 65%)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <div>
            <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE }}>
              <Eyebrow>Evidence-led procure-to-pay · built for India</Eyebrow>
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.08, ease: EASE }}
              className="v2-display mt-4 text-[42px] font-medium leading-[1.06] tracking-tight sm:text-[56px]"
            >
              Know what you<br />
              really owe.{" "}
              <span className="text-[var(--accent)]">Know why.</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.16, ease: EASE }}
              className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-[var(--muted)]"
            >
              Satya matches your purchase orders, deliveries, invoices, payments and GST records —
              flags the costly errors with proof, and tells your team what to do next. When the
              evidence is unclear, it says so instead of guessing.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.65, delay: 0.24, ease: EASE }}
              className="mt-8 flex flex-wrap items-center gap-3"
            >
              <Link
                href="/app"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[15px] font-semibold text-white shadow-[0_1px_0_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.15)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-[var(--shadow-2)] dark:text-[#06231c]"
              >
                Open the live workspace <ArrowRight size={16} />
              </Link>
              <a
                href="#how"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--line-strong)] px-5 text-[15px] font-medium text-[var(--ink-2)] transition-colors hover:border-[var(--ink-2)]/50 hover:text-[var(--ink)]"
              >
                See how it works
              </a>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="mt-5 text-xs text-[var(--muted)]"
            >
              Demo data only — Satya never moves money or files returns.
            </motion.p>
          </div>
          <HeroTrail />
        </div>
      </section>

      {/* ---------- stats ---------- */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]/60">
        <div className="mx-auto grid max-w-6xl gap-px px-5 py-10 sm:grid-cols-3 sm:gap-8">
          {STATS.map((stat, i) => (
            <Reveal key={stat.value} delay={i * 0.08} className="py-4 sm:py-0">
              <p className="v2-display text-[30px] font-medium tracking-tight text-[var(--accent)]">
                <CountUpText value={stat.value} />
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">{stat.note}</p>
              <p className="mt-1.5 text-[11px] text-[var(--muted)]">{stat.source}</p>
            </Reveal>
          ))}
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-8 text-xs leading-relaxed text-[var(--muted)]">
          Document mismatches — short deliveries, duplicate invoices, unadjusted advances — sit behind many of these
          disputes. Faster, evidence-backed checking shortens dispute cycles and prevents leakage.
        </p>
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="v2-display mt-3 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
            From scattered records to a clear next step.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08}>
              <article className="group relative h-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)] transition-all duration-200 hover:-translate-y-1 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]">
                <div className="flex items-center justify-between">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                    <step.icon size={19} />
                  </span>
                  <span className="font-code text-xs text-[var(--muted)]">0{i + 1}</span>
                </div>
                <h3 className="mt-4 text-[15px] font-semibold">{step.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{step.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- flagship story ---------- */}
      <section id="story" className="border-y border-[var(--line)] bg-[var(--surface)]/60">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Reveal>
            <Eyebrow>A real case, end to end</Eyebrow>
            <h2 className="v2-display mt-3 max-w-2xl text-3xl font-medium tracking-tight sm:text-4xl">
              100 pumps ordered. 60 delivered. One invoice recorded twice.
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
              This is the kind of mess every accounts team meets. Watch how Satya separates the
              harmless from the costly.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 lg:grid-cols-5">
            {STORY.map((step, i) => (
              <Reveal key={step.n} delay={i * 0.07} className="relative">
                <article
                  className={cn(
                    "h-full rounded-2xl border p-5 transition-colors",
                    i === 4
                      ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]"
                      : i === 2
                        ? "border-[var(--sev-high)]/40 bg-[var(--surface)]"
                        : "border-[var(--line)] bg-[var(--surface)]",
                  )}
                >
                  <span className={cn("font-code text-xs", i === 4 ? "text-[var(--accent-strong)]" : "text-[var(--muted)]")}>
                    {step.n}
                  </span>
                  <h3 className="mt-2.5 text-[14.5px] font-semibold leading-snug">{step.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">{step.text}</p>
                </article>
                {i < STORY.length - 1 && (
                  <ArrowRight size={15} className="absolute -right-4 top-1/2 hidden -translate-y-1/2 text-[var(--muted)] lg:block" aria-hidden="true" />
                )}
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.2}>
            <div className="mt-8 flex flex-wrap items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-6 py-5">
              <IndianRupee size={20} className="text-[var(--accent)]" />
              <p className="text-sm text-[var(--ink-2)]">
                <span className="font-semibold text-[var(--ink)]">The verdict:</span> hold ₹70,800 as a likely
                duplicate, approve ₹20,000 backed by deliveries, and ask the supplier which invoice the
                unexplained ₹15,000 belongs to.
              </p>
              <Link href="/app" className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)] hover:underline">
                Open this case in the workspace <ArrowRight size={14} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <Eyebrow>The product</Eyebrow>
          <h2 className="v2-display mt-3 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
            Everything between the order and the payment.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature, i) => (
            <Reveal key={feature.title} delay={(i % 4) * 0.06}>
              <article className="h-full rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-all duration-200 hover:-translate-y-1 hover:border-[var(--line-strong)] hover:shadow-[var(--shadow-2)]">
                <feature.icon size={19} className="text-[var(--accent)]" />
                <h3 className="mt-3.5 text-[14.5px] font-semibold">{feature.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">{feature.text}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ---------- built for india ---------- */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]/60">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal>
            <Eyebrow>Built for India</Eyebrow>
            <h2 className="v2-display mt-3 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
              The rules your accountant already worries about.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {INDIA_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3.5 py-1.5 text-[12.5px] text-[var(--ink-2)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--ink)]"
                >
                  {chip}
                </span>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { icon: Lock, title: "Humans decide money", text: "Satya suggests and shows proof — only your authorised roles can approve, hold or allocate." },
                { icon: FileCheck2, title: "No invented numbers", text: "Every figure traces to a document field. Missing evidence is flagged, never guessed." },
                { icon: Truck, title: "Made for real supply chains", text: "Partial deliveries, quality checks, advances against proforma invoices, split payments — all first-class." },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
                  <item.icon size={18} className="text-[var(--accent)]" />
                  <h3 className="mt-3 text-[14.5px] font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--muted)]">{item.text}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <div className="glow-accent relative overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] px-8 py-14 text-center shadow-[var(--shadow-2)]">
            <Sparkles size={22} className="mx-auto text-[var(--accent)]" />
            <h2 className="v2-display mx-auto mt-4 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
              Check before you pay.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[var(--muted)]">
              Open the demo workspace — a fully worked example with orders, deliveries, invoices and
              payments already loaded.
            </p>
            <Link
              href="/app"
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--accent)] px-6 text-[15px] font-semibold text-white shadow-[0_1px_0_rgb(0_0_0/0.2),inset_0_1px_0_rgb(255_255_255/0.15)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-[var(--shadow-2)] dark:text-[#06231c]"
            >
              Open the live workspace <ArrowRight size={16} />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[17px] font-bold tracking-tight">satya<span className="text-[var(--accent)]">.</span></p>
            <p className="mt-2 max-w-xs text-xs leading-relaxed text-[var(--muted)]">
              Know what you actually owe, and why. Built for teams that check before they act.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3 text-xs text-[var(--muted)]">
            <div className="flex flex-col gap-2">
              <span className="font-semibold uppercase tracking-wider text-[var(--ink-2)]">Product</span>
              <Link href="/app" className="hover:text-[var(--ink)]">Workspace</Link>
              <Link href="/research" className="hover:text-[var(--ink)]">Research</Link>
              <Link href="/verify/demo" className="hover:text-[var(--ink)]">Verify a document</Link>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-semibold uppercase tracking-wider text-[var(--ink-2)]">Legal</span>
              <Link href="/legal/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-[var(--ink)]">Terms</Link>
              <Link href="/legal/ai" className="hover:text-[var(--ink)]">AI transparency</Link>
              <Link href="/legal/grievance" className="hover:text-[var(--ink)]">Grievance</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--line)] px-5 py-4 text-center text-[11px] leading-relaxed text-[var(--muted)]">
          Satya is a decision-support tool. Verify important figures with your accountant or tax adviser —
          Satya does not file returns or move money.
        </div>
      </footer>
    </div>
  );
}
