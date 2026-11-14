"use client";

// Satya public landing. Written for the person who pays suppliers at an
// Indian manufacturer or distributor: who it's for, the problem in their
// words (with sourced numbers), the three jobs Satya does, a short tour of
// the real screens (composed from the same primitives as the app), how it
// works with the data they already have, trust, and how to start.

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight, Check, Clock, FileSpreadsheet, Landmark, ReceiptText, FileText, OctagonAlert, TriangleAlert,
  CircleCheck, PauseCircle, MessageCircleQuestion, Lock, History, Eye, ShieldCheck, ScanSearch, ListChecks, QrCode,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/landing/site-header";
import { cn } from "@/lib/utils";

/* ---------------- content ---------------- */

const QUESTIONS = [
  "“Is this the same bill we already paid last month?”",
  "“Which MSME suppliers do we have to pay by Friday?”",
  "“Why doesn’t our GST credit match GSTR-2B this month?”",
  "“We were billed for 100 — how many actually arrived?”",
];

const FACTS = [
  {
    value: "69.6%",
    text: "of 2,400+ Indian businesses said bills and payables were their biggest accounting headache — ahead of bank and GST reconciliation.",
    source: "AI Accountant demo analysis, Jan–Jul 2026 (vendor sample), via CXOToday",
    href: "https://cxotoday.com/media-coverage/analysis-of-over-2400-businesses-shows-invoice-processing-remains-a-bigger-challenge-than-gst-reconciliation-as-founders-increasingly-seek-finance-automation/",
  },
  {
    value: "18.4%",
    text: "of supplier invoices need a person to fix an exception before they can be paid — roughly one in five.",
    source: "Ardent Partners, State of ePayables 2025",
    href: "https://payablesplace.ardentpartners.com/2026/01/state-of-epayables-part-nine-ap-benchmarks-and-best-in-class-performance/",
  },
  {
    value: "3× RBI rate",
    text: "compound interest is owed on payments to micro and small suppliers made after 45 days — and the expense can’t be deducted that year.",
    source: "MSMED Act s.15–16 · Income-tax Act s.43B(h)",
    href: "https://www.dcmsme.gov.in/publications/LegalFramework.pdf",
  },
];

/* ---------------- small composed UI pieces (look like the real app) ---------------- */

function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--surface)] shadow-[var(--shadow-3)]", className)}>
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface-2)] px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--line-strong)]" />
        </span>
        <span className="ml-2 truncate text-[13px] text-[var(--muted)]">{title}</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

function Pill({ tone, icon: Icon, children }: { tone: "bad" | "warn" | "good" | "info" | "neutral"; icon?: typeof Check; children: React.ReactNode }) {
  const map = {
    bad: ["var(--sev-critical)", "var(--sev-critical-soft)"],
    warn: ["var(--sev-medium)", "var(--sev-medium-soft)"],
    good: ["var(--confirmed)", "var(--confirmed-soft)"],
    info: ["var(--likely)", "var(--likely-soft)"],
    neutral: ["var(--ink-2)", "var(--surface-2)"],
  } as const;
  const [color, bg] = map[tone];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium leading-none" style={{ color, background: bg, borderColor: `color-mix(in srgb, ${color} 28%, transparent)` }}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** Hero: an issue as it appears in "To review". */
function IssueCard() {
  const trail = [
    { label: "Ordered", value: "100 impeller kits", note: "PO-1001 · ₹1,18,000", tone: "neutral" as const },
    { label: "Received", value: "60 kits accepted", note: "GRN-0417 · 40 still due", tone: "warn" as const },
    { label: "Billed", value: "₹70,800 — twice", note: "INV-041 and INV/041", tone: "bad" as const },
    { label: "Paid", value: "₹50,800", note: "2 bank transfers", tone: "neutral" as const },
  ];
  return (
    <Frame title="satya · To review · Meridian Pump Supply">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="bad" icon={OctagonAlert}>Critical</Pill>
        <Pill tone="good" icon={CircleCheck}>Confirmed</Pill>
      </div>
      <p className="mt-3 text-[17px] font-semibold leading-snug text-[var(--ink)]">The same invoice was entered twice</p>
      <p className="mt-1 text-[14px] leading-relaxed text-[var(--muted)]">
        INV-041 and INV/041 have the same supplier, date, lines and total. Only one should be paid.
      </p>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {trail.map((step) => (
          <li key={step.label} className={cn("rounded-[var(--radius-sm)] border p-2.5", step.tone === "bad" ? "border-[var(--sev-critical)]/40 bg-[var(--sev-critical-soft)]" : step.tone === "warn" ? "border-[var(--sev-medium)]/35 bg-[var(--sev-medium-soft)]" : "border-[var(--line)] bg-[var(--surface-2)]")}>
            <p className="text-[13px] font-medium text-[var(--muted)]">{step.label}</p>
            <p className="mt-0.5 text-[14px] font-semibold leading-tight text-[var(--ink)]">{step.value}</p>
            <p className="mt-0.5 text-[13px] leading-tight text-[var(--muted)]">{step.note}</p>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--line)] p-3">
        <p className="text-[14px] text-[var(--ink-2)]">
          You really owe <span className="font-semibold text-[var(--ink)] tnum">₹20,000</span> for delivered goods.
        </p>
        <span className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--sev-critical)]/50 px-3 text-[14px] font-medium text-[var(--sev-critical)]">
          <PauseCircle size={15} aria-hidden="true" /> Hold ₹70,800
        </span>
      </div>
    </Frame>
  );
}

function FlagListCard() {
  const rows = [
    { title: "Same invoice entered twice", note: "INV-041 and INV/041 · Meridian", amount: "₹70,800", tone: "good" as const, word: "Confirmed", icon: CircleCheck },
    { title: "Billed for 100, only 60 accepted", note: "PO-1001 · line 1", amount: "₹47,200", tone: "good" as const, word: "Confirmed", icon: CircleCheck },
    { title: "Rate ₹1,050 against PO rate ₹1,000", note: "INV-052 · Kaveri Pumps", amount: "₹2,950", tone: "info" as const, word: "Likely", icon: ScanSearch },
    { title: "18% GST charged; HSN 8413 is 12%", note: "INV-088 · Rathod Engineering", amount: "₹4,800", tone: "warn" as const, word: "Possible", icon: TriangleAlert },
  ];
  return (
    <Frame title="satya · To review">
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.title} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block text-[15px] font-medium leading-snug text-[var(--ink)]">{r.title}</span>
              <span className="mt-0.5 block text-[13px] text-[var(--muted)]">{r.note} · at stake <span className="tnum">{r.amount}</span></span>
            </span>
            <Pill tone={r.tone} icon={r.icon}>{r.word}</Pill>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function DeadlinesCard() {
  const rows = [
    { who: "Deccan Valve Industries", what: "MSME 45-day limit", amount: "₹68,676", left: "4 days left", tone: "var(--sev-medium)" },
    { who: "Kaveri Pumps & Motors", what: "180-day GST credit rule", amount: "₹1,24,960", left: "2 days overdue", tone: "var(--sev-critical)" },
    { who: "Shakti Industrial Suppliers", what: "MSME 45-day limit", amount: "₹17,700", left: "23 days left", tone: "var(--muted)" },
  ];
  return (
    <Frame title="satya · Home · Upcoming deadlines">
      <ul className="divide-y divide-[var(--line)]">
        {rows.map((r) => (
          <li key={r.who} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium text-[var(--ink)]">{r.who}</span>
              <span className="block text-[13px] text-[var(--muted)]">{r.what} · <span className="tnum">{r.amount}</span></span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[14px] font-medium" style={{ color: r.tone }}>
              <Clock size={14} aria-hidden="true" /> {r.left}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

function AssistantCard() {
  return (
    <Frame title="satya · Assistant">
      <p className="ml-auto w-fit max-w-[85%] rounded-[var(--radius-md)] bg-[var(--accent)] px-3.5 py-2.5 text-[14px] text-[var(--on-accent)]">
        How much do we really owe Meridian Pump Supply?
      </p>
      <div className="mt-3 max-w-[92%] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3 text-[14px] leading-relaxed text-[var(--ink-2)]">
        <p>
          <span className="font-semibold text-[var(--ink)] tnum">₹20,000</span>. They delivered 60 of 100 kits (₹70,800 with GST) and
          you’ve paid ₹50,800. The second ₹70,800 invoice is a duplicate and is on hold.
        </p>
        <p className="mt-2 flex flex-wrap gap-1.5">
          {["PO-1001", "GRN-0417", "INV-041", "UTR …4471"].map((ref) => (
            <span key={ref} className="rounded border border-[var(--line-strong)] bg-[var(--surface)] px-1.5 py-0.5 font-code text-[13px] text-[var(--ink-2)]">{ref}</span>
          ))}
        </p>
      </div>
    </Frame>
  );
}

const JOBS = [
  {
    id: "catch",
    icon: ScanSearch,
    title: "Catch errors before you pay",
    body: "Satya matches each line of the order, the goods receipt, the quality check, the invoice and the payment. Duplicate bills, short deliveries, price and GST differences are flagged with the exact document behind them — and how sure Satya is.",
    points: ["Duplicate and near-duplicate invoices", "Billed more than received or accepted", "Rate, HSN and GST mismatches against the PO"],
    visual: <FlagListCard />,
  },
  {
    id: "deadlines",
    icon: Clock,
    title: "Never miss MSME or GST deadlines",
    body: "Every unpaid bill carries its legal clock: the MSME 45-day limit, the 180-day GST credit rule and e-invoice checks. Home shows what is due this week and what it costs to miss it.",
    points: ["MSME 45-day limit from the date goods were accepted", "180-day GST credit reversal (Rule 37)", "Invoices missing from GSTR-2B"],
    visual: <DeadlinesCard />,
  },
  {
    id: "answer",
    icon: MessageCircleQuestion,
    title: "Answer any payable question with proof",
    body: "Ask in plain words — “what do we owe Meridian?” — and get a number with the documents that prove it. Every decision your team makes is saved with who, when and why, ready for your auditor.",
    points: ["Answers cite your own documents", "Never invents a figure; says when it isn’t sure", "One-click evidence pack for audits"],
    visual: <AssistantCard />,
  },
];

/* ---------------- product tour ---------------- */

const TOUR = [
  {
    key: "home",
    label: "Home",
    caption: "Start the day with one list: what’s overdue, what’s due this week and which issues have the most money at stake.",
    body: (
      <div className="space-y-3">
        {[
          { icon: OctagonAlert, color: "var(--sev-critical)", title: "Hold the duplicate Meridian invoice", meta: "At stake ₹70,800" },
          { icon: TriangleAlert, color: "var(--sev-high)", title: "Pay Deccan Valve before the MSME 45-day limit", meta: "₹68,676 · 4 days left" },
          { icon: TriangleAlert, color: "var(--sev-high)", title: "₹15,000 bank transfer has no matching bill", meta: "Received 3 Nov" },
        ].map((row) => (
          <div key={row.title} className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--line)] p-3">
            <row.icon size={18} className="mt-0.5 shrink-0" style={{ color: row.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-[var(--ink)]">{row.title}</span>
              <span className="block text-[13px] text-[var(--muted)] tnum">{row.meta}</span>
            </span>
            <span className="hidden shrink-0 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-2.5 py-1 text-[13px] font-medium text-[var(--ink)] sm:inline">Review</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    key: "review",
    label: "Review an issue",
    caption: "Each issue shows the calculation and the source document for every number. You approve, hold or ask the supplier — with a reason.",
    body: (
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="rounded-[var(--radius-md)] border border-[var(--line)] p-3">
          <p className="text-[13px] font-medium text-[var(--muted)]">How Satya worked it out</p>
          <table className="mt-2 w-full text-[14px]">
            <tbody className="tnum">
              {[["Accepted at the PO price", "₹70,800"], ["Less payments", "− ₹50,800"], ["Duplicate held", "₹70,800"], ["You really owe", "₹20,000"]].map(([k, v], i) => (
                <tr key={k} className={cn("border-b border-[var(--line)] last:border-0", i === 3 && "font-semibold text-[var(--ink)]")}>
                  <td className="py-1.5 text-[var(--ink-2)]">{k}</td>
                  <td className="py-1.5 text-right">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-row flex-wrap gap-2 sm:flex-col">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] px-3 text-[14px] font-medium text-[var(--on-accent)]"><Check size={15} aria-hidden="true" /> Approve ₹20,000</span>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--sev-critical)]/50 px-3 text-[14px] font-medium text-[var(--sev-critical)]"><PauseCircle size={15} aria-hidden="true" /> Hold ₹70,800</span>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-3 text-[14px] font-medium text-[var(--ink)]"><MessageCircleQuestion size={15} aria-hidden="true" /> Ask supplier</span>
        </div>
      </div>
    ),
  },
  {
    key: "payments",
    label: "Match a payment",
    caption: "Bank lines are matched to the bills they settle — including split and part payments. When it’s unclear, Satya lists the candidates instead of guessing.",
    body: (
      <div className="space-y-2.5">
        <div className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
          <span>
            <span className="block text-[15px] font-medium text-[var(--ink)]">NEFT · Meridian Pump Supply</span>
            <span className="block text-[13px] text-[var(--muted)]">3 Nov · no invoice reference</span>
          </span>
          <span className="text-[15px] font-semibold text-[var(--ink)] tnum">₹15,000</span>
        </div>
        <p className="text-[13px] font-medium text-[var(--muted)]">Could belong to</p>
        {[["INV-052 · ₹15,000 open", "Likely", "info"], ["Advance against PO-1007", "Possible", "warn"]].map(([label, word, tone]) => (
          <div key={label} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--line)] p-3">
            <span className="text-[14px] text-[var(--ink)]">{label}</span>
            <Pill tone={tone as "info" | "warn"}>{word}</Pill>
          </div>
        ))}
      </div>
    ),
  },
];

function ProductTour() {
  const [active, setActive] = useState(TOUR[0].key);
  const current = TOUR.find((t) => t.key === active) ?? TOUR[0];
  return (
    <div>
      <div role="tablist" aria-label="Product tour" className="flex flex-wrap gap-2">
        {TOUR.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`tour-tab-${t.key}`}
            aria-selected={t.key === active}
            aria-controls={`tour-panel-${t.key}`}
            onClick={() => setActive(t.key)}
            className={cn(
              "h-10 rounded-full border px-4 text-[15px] font-medium transition-colors",
              t.key === active ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]" : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-2)] hover:text-[var(--ink)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tour-panel-${current.key}`} aria-labelledby={`tour-tab-${current.key}`} className="mt-6 grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
        <p className="text-lg leading-relaxed text-[var(--ink-2)]">{current.caption}</p>
        <Frame title={`satya · ${current.label}`}>{current.body}</Frame>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

function SectionHead({ eyebrow, title, body, id }: { eyebrow?: string; title: string; body?: React.ReactNode; id?: string }) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
      <h2 id={id} className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.022em] text-[var(--ink)] sm:text-[36px]">{title}</h2>
      {body ? <p className="mt-4 text-lg leading-relaxed text-[var(--muted)]">{body}</p> : null}
    </div>
  );
}

export function Landing() {
  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--on-accent)]">
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* ---------- hero ---------- */}
        <section className="border-b border-[var(--line)]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.05fr] lg:gap-14 lg:py-24">
            <div className="rise">
              <p className="text-[15px] font-semibold text-[var(--accent-strong)] dark:text-[var(--accent)]">
                For finance teams at Indian manufacturers and distributors
              </p>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--ink)] sm:text-[52px]">
                Check every supplier bill before you pay it.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--ink-2)] sm:text-xl sm:leading-relaxed">
                Satya lines up your purchase orders, goods receipts, invoices, payments and GST records. It tells you what’s
                wrong, what’s due, and shows the document that proves it.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login?demo=1" className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-6 text-base font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)]">
                  Try the live demo <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link href="/signup" className="inline-flex h-12 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-6 text-base font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]">
                  Start a pilot
                </Link>
              </div>
              <p className="mt-4 text-[15px] text-[var(--muted)]">
                The demo is a fictional company — no sign-up needed. Works with Tally, bank statements and GSTR-2B.
              </p>
            </div>
            <div className="rise" style={{ animationDelay: "80ms" }}>
              <IssueCard />
            </div>
          </div>
        </section>

        {/* ---------- problem ---------- */}
        <section aria-labelledby="problem-title" className="border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHead
              id="problem-title"
              eyebrow="The problem"
              title="Paying suppliers shouldn’t take detective work"
              body="Orders, deliveries, invoices and payments live in different places — Tally, email, the bank portal, the GST portal. So the questions that matter take hours to answer:"
            />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {QUESTIONS.map((q) => (
                <li key={q} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)] px-5 py-4 text-[17px] leading-snug text-[var(--ink)]">{q}</li>
              ))}
            </ul>
            <div className="mt-12 grid gap-8 border-t border-[var(--line)] pt-10 md:grid-cols-3">
              {FACTS.map((fact) => (
                <figure key={fact.value}>
                  <p className="text-[34px] font-semibold leading-none tracking-[-0.02em] text-[var(--ink)] tnum">{fact.value}</p>
                  <p className="mt-3 text-base leading-relaxed text-[var(--ink-2)]">{fact.text}</p>
                  <figcaption className="mt-2 text-[14px] text-[var(--muted)]">
                    Source:{" "}
                    <a href={fact.href} target="_blank" rel="noreferrer" className="underline decoration-[var(--line-strong)] underline-offset-2 hover:text-[var(--ink)]">
                      {fact.source}
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- three jobs ---------- */}
        <section id="product" aria-labelledby="product-title" className="border-b border-[var(--line)]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHead id="product-title" eyebrow="What Satya does" title="Three jobs, done every day, for every bill" />
            <div className="mt-12 space-y-16 sm:space-y-20">
              {JOBS.map((job, i) => (
                <article key={job.id} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
                  <div className={cn(i % 2 === 1 && "lg:order-2")}>
                    <span className="grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--accent-soft)] text-[var(--accent)]">
                      <job.icon size={22} aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">{job.title}</h3>
                    <p className="mt-3 text-[17px] leading-relaxed text-[var(--ink-2)]">{job.body}</p>
                    <ul className="mt-5 space-y-2.5">
                      {job.points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-base text-[var(--ink-2)]">
                          <Check size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className={cn(i % 2 === 1 && "lg:order-1")}>{job.visual}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- tour ---------- */}
        <section aria-labelledby="tour-title" className="border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHead id="tour-title" eyebrow="A quick tour" title="What your team sees" body="The three screens your team uses most, shown with the demo company’s data. Open the live demo to click through them." />
            <div className="mt-10">
              <ProductTour />
            </div>
          </div>
        </section>

        {/* ---------- how it works with your data ---------- */}
        <section id="how-it-works" aria-labelledby="how-title" className="border-b border-[var(--line)]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <SectionHead
              id="how-title"
              eyebrow="How it works"
              title="Works with the records you already keep"
              body="No new ERP and no re-typing. Keep using Tally and your bank — Satya reads what they export."
            />
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              <div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6">
                <p className="text-[14px] font-semibold text-[var(--muted)]">1 · You bring</p>
                <ul className="mt-4 space-y-3.5">
                  {[
                    [FileSpreadsheet, "Tally exports", "Purchase vouchers, supplier ledgers, stock receipts"],
                    [Landmark, "Bank statements", "CSV from any Indian bank"],
                    [ReceiptText, "GSTR-2B", "Monthly JSON from the GST portal"],
                    [QrCode, "Invoices", "PDFs, photos, e-invoice QR codes"],
                  ].map(([Icon, title, note]) => {
                    const I = Icon as typeof FileText;
                    return (
                      <li key={title as string} className="flex gap-3">
                        <I size={20} className="mt-0.5 shrink-0 text-[var(--ink-2)]" aria-hidden="true" />
                        <span>
                          <span className="block text-base font-medium text-[var(--ink)]">{title as string}</span>
                          <span className="block text-[14px] text-[var(--muted)]">{note as string}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6">
                <p className="text-[14px] font-semibold text-[var(--muted)]">2 · Satya checks</p>
                <ul className="mt-4 space-y-3 text-base leading-relaxed text-[var(--ink-2)]">
                  <li>Reads each document and shows what it extracted, for you to confirm.</li>
                  <li>Links order → receipt → quality check → invoice → payment, line by line.</li>
                  <li>Applies Indian rules: GST rates, MSME limits, the 180-day credit rule, e-invoice checks.</li>
                  <li>Says how sure it is — and asks you when two explanations fit.</li>
                </ul>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--surface)] p-6">
                <p className="text-[14px] font-semibold text-[var(--muted)]">3 · You decide</p>
                <ul className="mt-4 space-y-3.5">
                  {[
                    [ListChecks, "A to-do list", "Ranked by money at stake and deadline"],
                    [PauseCircle, "Approve or hold", "Every decision saved with a reason"],
                    [FileText, "Evidence pack", "Ready for your CA or auditor"],
                  ].map(([Icon, title, note]) => {
                    const I = Icon as typeof FileText;
                    return (
                      <li key={title as string} className="flex gap-3">
                        <I size={20} className="mt-0.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                        <span>
                          <span className="block text-base font-medium text-[var(--ink)]">{title as string}</span>
                          <span className="block text-[14px] text-[var(--muted)]">{note as string}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- trust ---------- */}
        <section aria-labelledby="trust-title" className="border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr]">
            <SectionHead
              id="trust-title"
              eyebrow="Trust"
              title="Satya checks. Your team decides."
              body={
                <>
                  Satya never moves money or files returns, and every number links back to a document.{" "}
                  <Link href="/trust" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">How we protect your data</Link>
                </>
              }
            />
            <ul className="grid gap-4 sm:grid-cols-2">
              {[
                [Eye, "Read-only by design", "No bank or GST portal write access. Payments and filings stay with you."],
                [Lock, "Role-based access", "Admins choose who can approve, upload or only view."],
                [History, "Tamper-evident history", "Each decision is chained to the one before, so edits show."],
                [ShieldCheck, "No guessing", "When information is missing, Satya says so instead of filling it in."],
              ].map(([Icon, title, body]) => {
                const I = Icon as typeof FileText;
                return (
                  <li key={title as string} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--paper)] p-5">
                    <I size={20} className="text-[var(--accent)]" aria-hidden="true" />
                    <p className="mt-3 text-base font-semibold text-[var(--ink)]">{title as string}</p>
                    <p className="mt-1 text-[15px] leading-relaxed text-[var(--muted)]">{body as string}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ---------- start ---------- */}
        <section aria-labelledby="start-title">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid gap-8 rounded-[var(--radius-lg)] border border-[var(--line-strong)] bg-[var(--surface)] p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
              <div>
                <h2 id="start-title" className="text-[30px] font-semibold leading-tight tracking-[-0.022em] text-[var(--ink)] sm:text-[34px]">
                  Set up your own pilot workspace
                </h2>
                <p className="mt-3 text-lg leading-relaxed text-[var(--ink-2)]">
                  Create a workspace, add your company’s GSTIN, import a month of records and invite your team. No card needed.
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
                  Satya is a working prototype — for now, please use sample or anonymised records rather than live business data.
                </p>
                <p className="mt-3 text-[15px] text-[var(--muted)]">
                  Want numbers first?{" "}
                  <Link href="/roi" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">Estimate what it saves you</Link>
                  {" "}or read the{" "}
                  <Link href="/research" className="font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]">research behind it</Link>.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--accent)] px-6 text-base font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-strong)]">
                  Start a pilot <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link href="/login?demo=1" className="inline-flex h-12 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] px-6 text-base font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-2)]">
                  Try the live demo
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
