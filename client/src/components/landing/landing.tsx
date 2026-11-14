"use client";

// Satya public landing. Every external claim carries its source; product
// capabilities are described plainly. Motion is CSS-only (entrance on load)
// so content is never left invisible waiting for a scroll observer.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Files, PackageCheck, Wallet, FileCheck2, ShieldCheck,
  GitBranch, MessageSquare, ScanSearch, Scale, Landmark, ReceiptText, Truck,
  CircleCheck, Sun, Moon, Menu, X, Lock, FileText, IndianRupee, TriangleAlert,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/* ---------------- content ---------------- */

const STATS = [
  { value: "₹7.34 lakh crore", note: "in delayed payments owed to India’s MSMEs (Mar 2024)", source: "GAME–FISME–C2FO, Delayed Payments 3.0" },
  { value: "0.8–2%", note: "of annual disbursements are duplicate or erroneous payments", source: "APQC benchmarking, via CFO.com" },
  { value: "45 days", note: "is the legal ceiling for paying micro and small suppliers", source: "MSMED Act §15 · Income-tax §43B(h)" },
];

const STEPS = [
  { icon: Files, title: "Bring the records together", text: "Raise purchase orders with GST and HSN built in, or drop in the invoices, delivery notes and bank statements you already have." },
  { icon: ScanSearch, title: "Satya checks every link", text: "What was ordered, received, accepted, billed and paid is matched line by line — including split payments and partial deliveries." },
  { icon: GitBranch, title: "See each issue with proof", text: "Duplicate bills, short deliveries and unlinked transfers are flagged with the exact document and field behind them." },
  { icon: Scale, title: "Decide, with a record", text: "Approve, ask the supplier, or put an amount on hold. Every decision is saved with who made it and why." },
];

const STORY = [
  { n: "01", title: "100 kits ordered", text: "A purchase order for 100 pump impeller kits at ₹1,000 each — ₹1,18,000 with GST." },
  { n: "02", title: "60 arrive", text: "Stores records the receipt; quality accepts all 60. The other 40 are still due." },
  { n: "03", title: "One invoice, posted twice", text: "INV-041 for ₹70,800 is keyed as “INV-041” and again as “INV/041”. Satya flags the likely duplicate.", warn: true },
  { n: "04", title: "Payments split", text: "₹30,000 + ₹20,800 settle INV-041. A separate ₹15,000 transfer has no reference — Satya lists what it could belong to." },
  { n: "05", title: "The true position", text: "₹20,000 really owed, backed by delivered goods. The duplicate ₹70,800 stays on hold.", good: true },
];

const FEATURES = [
  { icon: FileText, title: "Purchase orders", text: "Guided creation with GST split, delivery schedules, terms and a print-ready PDF on your letterhead." },
  { icon: ScanSearch, title: "Document reading", text: "PDFs, photos, e-invoice JSON and bank CSVs — extracted fields shown with confidence for you to confirm." },
  { icon: ShieldCheck, title: "Evidence on every flag", text: "Each issue shows the document, the field and the calculation. Nothing is a black box." },
  { icon: Scale, title: "Honest about doubt", text: "When two explanations fit, Satya says so and lists the candidates instead of guessing." },
  { icon: Landmark, title: "Compliance deadlines", text: "MSME 45-day payments, GST credit timing and e-invoice checks — surfaced before they cost you." },
  { icon: MessageSquare, title: "Ask Satya", text: "Ask in plain words. Answers cite your documents and never invent a figure." },
  { icon: GitBranch, title: "Money trail", text: "An order’s full story — order, delivery, invoice, payment — on one interactive canvas." },
  { icon: Lock, title: "Tamper-evident history", text: "Decisions are hash-chained. Export an evidence pack for your auditor in one click." },
];

const INDIA_CHIPS = [
  "CGST · SGST · IGST", "e-invoice IRN & QR", "e-way bills", "MSME 45-day rule", "TDS on goods (194Q)",
  "LUT for exports", "GSTR-2B matching", "HSN rate master", "FY-wise numbering", "₹ lakh / crore grouping", "IST dates", "Udyam status",
];

/* ---------------- hero visual ---------------- */

type Tone = "neutral" | "warn" | "good";

function TrailNode({ icon: Icon, title, sub, tone = "neutral" }: { icon: React.ElementType; title: string; sub: string; tone?: Tone }) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-center gap-3 rounded-xl border bg-[var(--surface)] px-3.5 py-3",
        tone === "neutral" && "border-[var(--line)]",
        tone === "warn" && "border-[var(--sev-high)]/45",
        tone === "good" && "border-[var(--accent)]/45",
      )}
    >
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          tone === "neutral" && "bg-[var(--surface-2)] text-[var(--ink-2)]",
          tone === "warn" && "bg-[var(--sev-high-soft)] text-[var(--sev-high)]",
          tone === "good" && "bg-[var(--accent-soft)] text-[var(--accent)]",
        )}
      >
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{title}</span>
        <span className="block truncate text-xs text-[var(--muted)]">{sub}</span>
      </span>
    </div>
  );
}

function HeroTrail() {
  const rows: [Parameters<typeof TrailNode>[0], Parameters<typeof TrailNode>[0]][] = [
    [
      { icon: FileText, title: "100 kits ordered", sub: "PO value ₹1,18,000" },
      { icon: PackageCheck, title: "60 delivered", sub: "Received & accepted", tone: "good" },
    ],
    [
      { icon: ReceiptText, title: "INV-041 · ₹70,800", sub: "Supplier tax invoice" },
      { icon: TriangleAlert, title: "INV/041 again", sub: "Same bill, keyed twice", tone: "warn" },
    ],
    [
      { icon: Wallet, title: "₹50,800 paid", sub: "Two bank transfers" },
      { icon: CircleCheck, title: "₹20,000 owed", sub: "Backed by deliveries", tone: "good" },
    ],
  ];
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute -inset-6 rounded-[32px] bg-[radial-gradient(60%_60%_at_60%_30%,var(--accent-glow),transparent_70%)]" />
      <div className="rise relative rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-3)] sm:p-5" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center justify-between gap-3 pb-4">
          <p className="truncate text-[13px] font-medium text-[var(--ink)]">
            <span className="font-code text-[var(--muted)]">PO-1001</span> · Meridian Pump Supply
          </p>
          <span className="shrink-0 rounded-full bg-[var(--possible-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--possible)]">Needs review</span>
        </div>
        <div className="rise-stagger space-y-2.5">
          {rows.map(([a, b]) => (
            <div key={a.title} className="grid grid-cols-1 items-center gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
              <TrailNode {...a} />
              <span aria-hidden="true" className="hidden h-px w-6 bg-[var(--line-strong)] sm:block" />
              <TrailNode {...b} />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-[var(--sev-high-soft)] px-3.5 py-3">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--sev-high)]" aria-hidden="true" />
          <p className="text-[13px] leading-relaxed text-[var(--ink-2)]">
            <span className="font-medium text-[var(--ink)]">Hold the second ₹70,800</span> — likely a duplicate. Pay the ₹20,000 backed by
            deliveries. One ₹15,000 transfer still needs a reference.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--accent)]">{eyebrow}</p>
      <h2 className="font-display mt-3 text-[34px] leading-[1.08] text-[var(--ink)] sm:text-[44px]">{title}</h2>
      {children ? <p className="mt-4 text-[16px] leading-relaxed text-[var(--muted)]">{children}</p> : null}
    </div>
  );
}

const primaryCta =
  "inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[15px] font-medium text-[var(--on-accent)] shadow-[0_1px_0_rgb(0_0_0/0.12),inset_0_1px_0_rgb(255_255_255/0.14)] transition-colors hover:bg-[var(--accent-strong)]";

export function Landing() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && theme === "dark";

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--paper)] text-[var(--ink)]">
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--topbar-bg)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
          <Link href="/" aria-label="Satya home" className="inline-flex">
            <Logo size={28} />
          </Link>
          <nav className="ml-8 hidden items-center gap-7 text-sm text-[var(--ink-2)] md:flex" aria-label="Site">
            <a href="#how" className="transition-colors hover:text-[var(--ink)]">How it works</a>
            <a href="#story" className="transition-colors hover:text-[var(--ink)]">A worked case</a>
            <a href="#features" className="transition-colors hover:text-[var(--ink)]">Product</a>
            <Link href="/research" className="transition-colors hover:text-[var(--ink)]">Research</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTheme(dark ? "light" : "dark")}
              aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="grid h-9 w-9 place-items-center rounded-[10px] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <Link href="/login" className="hidden h-9 items-center rounded-[10px] px-3.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:text-[var(--ink)] sm:inline-flex">
              Sign in
            </Link>
            <Link href="/app" className={cn(primaryCta, "hidden h-9 px-4 text-sm sm:inline-flex")}>
              Open workspace <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--line)] md:hidden"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-[var(--line)] px-5 py-4 md:hidden" aria-label="Site (mobile)">
            <div className="flex flex-col gap-3.5 text-[15px] text-[var(--ink-2)]">
              <a href="#how" onClick={() => setMenuOpen(false)}>How it works</a>
              <a href="#story" onClick={() => setMenuOpen(false)}>A worked case</a>
              <a href="#features" onClick={() => setMenuOpen(false)}>Product</a>
              <Link href="/research">Research</Link>
              <Link href="/login">Sign in</Link>
              <Link href="/app" className="font-medium text-[var(--accent)]">Open workspace →</Link>
            </div>
          </nav>
        )}
      </header>

      {/* ---------- hero ---------- */}
      <section className="relative">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "radial-gradient(900px 420px at 75% -10%, var(--accent-glow), transparent 60%)" }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-14 sm:pt-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-14 lg:pb-28">
          <div className="rise min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--ink-2)] shadow-[var(--shadow-1)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--saffron)]" aria-hidden="true" />
              Procure-to-pay checks, built for India
            </p>
            <h1 className="font-display mt-6 text-[46px] leading-[1.02] tracking-[-0.015em] sm:text-[64px]">
              Know what you really owe.{" "}
              <span className="italic text-[var(--accent)]">Know why.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-[var(--muted)]">
              Satya matches your purchase orders, deliveries, invoices, payments and GST records — flags the costly errors with
              proof, and tells your team what to do next. When the evidence is unclear, it says so.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/app" className={primaryCta}>
                Open the demo workspace <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a
                href="#story"
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-5 text-[15px] font-medium text-[var(--ink)] shadow-[var(--shadow-1)] transition-colors hover:bg-[var(--surface-2)]"
              >
                See a worked case
              </a>
            </div>
            <p className="mt-5 text-[13px] text-[var(--muted)]">Fictional demo company · Satya never moves money or files returns.</p>
          </div>
          <HeroTrail />
        </div>
      </section>

      {/* ---------- stats ---------- */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.value}>
              <p className="font-display text-[36px] leading-none text-[var(--ink)]">{stat.value}</p>
              <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--ink-2)]">{stat.note}</p>
              <p className="mt-2 text-xs text-[var(--muted)]">{stat.source}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="How it works" title="From scattered records to a clear next step." />
        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="bg-[var(--surface)] p-6">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                  <step.icon size={19} aria-hidden="true" />
                </span>
                <span className="font-code text-xs text-[var(--muted)]">0{i + 1}</span>
              </div>
              <h3 className="mt-5 text-[16px] font-semibold tracking-[-0.01em]">{step.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- worked case ---------- */}
      <section id="story" className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <SectionHead eyebrow="A worked case" title="100 ordered. 60 delivered. One invoice posted twice.">
            The kind of mess every accounts team meets. Here is how Satya separates the harmless from the costly.
          </SectionHead>
          <ol className="mt-12 grid gap-3 lg:grid-cols-5">
            {STORY.map((step) => (
              <li
                key={step.n}
                className={cn(
                  "rounded-2xl border p-5",
                  step.good ? "border-[var(--accent)]/40 bg-[var(--accent-soft)]" : step.warn ? "border-[var(--sev-high)]/35 bg-[var(--sev-high-soft)]" : "border-[var(--line)] bg-[var(--paper)]",
                )}
              >
                <span className="font-code text-xs text-[var(--muted)]">{step.n}</span>
                <h3 className="mt-3 text-[15px] font-semibold leading-snug">{step.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">{step.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-6 py-5 sm:flex-row sm:items-center">
            <IndianRupee size={20} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
            <p className="text-[14.5px] text-[var(--ink-2)]">
              <span className="font-medium text-[var(--ink)]">The verdict:</span> pay ₹20,000 backed by deliveries, hold the duplicate
              ₹70,800, and ask the supplier which invoice the ₹15,000 transfer belongs to.
            </p>
            <Link href="/app/investigations" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--accent)] hover:underline sm:ml-auto">
              Open it in the workspace <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- features ---------- */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-24">
        <SectionHead eyebrow="The product" title="Everything between the order and the payment." />
        <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--accent)] shadow-[var(--shadow-1)]">
                <feature.icon size={17} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[15.5px] font-semibold tracking-[-0.01em]">{feature.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{feature.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- built for india ---------- */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead eyebrow="Built for India" title="The rules your accountant already worries about." />
          <div className="mt-8 flex flex-wrap gap-2">
            {INDIA_CHIPS.map((chip) => (
              <span key={chip} className="rounded-full border border-[var(--line)] bg-[var(--paper)] px-3.5 py-1.5 text-[13px] text-[var(--ink-2)]">
                {chip}
              </span>
            ))}
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-3">
            {[
              { icon: Lock, title: "People decide money", text: "Satya suggests and shows proof — only authorised roles can approve, hold or allocate a payment." },
              { icon: FileCheck2, title: "No invented numbers", text: "Every figure traces to a document field. Missing evidence is flagged, never guessed." },
              { icon: Truck, title: "Made for real supply chains", text: "Partial deliveries, quality rejections, advances and split payments are all first-class." },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6">
                <item.icon size={18} className="text-[var(--accent)]" aria-hidden="true" />
                <h3 className="mt-4 text-[15.5px] font-semibold">{item.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--muted)]">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="relative overflow-hidden rounded-3xl bg-[#0a3d31] px-6 py-16 text-center text-white sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: "radial-gradient(600px 300px at 50% -20%, rgb(60 203 156 / 0.35), transparent 70%)" }}
          />
          <h2 className="font-display relative mx-auto max-w-xl text-[38px] leading-[1.05] sm:text-[48px]">
            Check before you pay.
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-white/75">
            Open the demo workspace — a worked example company with orders, deliveries, invoices and payments already loaded.
          </p>
          <Link
            href="/app"
            className="relative mt-8 inline-flex h-11 items-center gap-2 rounded-[10px] bg-white px-6 text-[15px] font-medium text-[#0a3d31] transition-colors hover:bg-white/90"
          >
            Open the demo workspace <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo size={26} />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
              Know what you really owe, and why. For teams that check before they act.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-6 text-sm text-[var(--muted)]">
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-2)]">Product</span>
              <Link href="/app" className="hover:text-[var(--ink)]">Workspace</Link>
              <Link href="/research" className="hover:text-[var(--ink)]">Research</Link>
              <Link href="/login" className="hover:text-[var(--ink)]">Sign in</Link>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--ink-2)]">Legal</span>
              <Link href="/legal/privacy" className="hover:text-[var(--ink)]">Privacy</Link>
              <Link href="/legal/terms" className="hover:text-[var(--ink)]">Terms</Link>
              <Link href="/legal/ai" className="hover:text-[var(--ink)]">AI transparency</Link>
              <Link href="/legal/grievance" className="hover:text-[var(--ink)]">Grievance</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--line)] px-5 py-5 text-center text-xs leading-relaxed text-[var(--muted)]">
          Satya is a decision-support tool. Verify important figures with your accountant or tax adviser — Satya does not file returns
          or move money.
        </div>
      </footer>
    </div>
  );
}
