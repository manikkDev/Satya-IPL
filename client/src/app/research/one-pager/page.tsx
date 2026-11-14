// One-page pitch summary (/research/one-pager), designed to print on a
// single A4 sheet. Every figure is from the research report with its source;
// no model accuracy is quoted (that lives on the live model card).

import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { PrintButton } from "@/components/pitch/print-button";
import { Cites } from "@/components/pitch/reference-list";
import { CAPABILITIES } from "@/content/pitch/research";

export const metadata: Metadata = {
  title: "One-page summary",
  description: "Satya on one page: the problem in Indian accounts payable, what Satya does, how we prove it, and how a pilot works.",
};

const STATS = [
  { v: "18.4%", t: "of invoices are exceptions needing a person", r: [2] },
  { v: "0.8–2%", t: "of disbursements are duplicate or erroneous", r: [4] },
  { v: "₹7.34 lakh crore", t: "delayed receivables owed to MSMEs (Mar 2024)", r: [8] },
  { v: "45 days", t: "legal ceiling to pay micro & small suppliers; 3× bank-rate interest after", r: [14] },
];

const PILOT = [
  ["Week 0", "NDA + DPA (Satya as processor); data request"],
  ["Weeks 1–2", "Read-only connection to Tally/Zoho/BUSY, GSTR-2B, bank; vendor clean-up"],
  ["Weeks 2–4", "Backtest on 12–24 months; ₹ findings readout; per-customer calibration"],
  ["Weeks 4–6", "Shadow mode: Satya predicts, your team decides; errors measured"],
  ["Weeks 6–8", "Controlled go-live on a slice; decision memo with confidence intervals"],
];

export default function OnePager() {
  return (
    <div className="min-h-screen bg-[var(--paper)] px-4 py-8 text-[var(--ink)] print:bg-white print:p-0 print:text-black sm:px-6">
      <style>{`@media print { @page { size: A4; margin: 12mm; } html, body { background: #fff !important; } .op-sheet { box-shadow: none !important; border: 0 !important; padding: 0 !important; } .op-sheet * { color: #111 !important; } }`}</style>
      <div className="mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/research" className="text-sm text-[var(--accent)] underline underline-offset-[3px]">← Back to research</Link>
        <PrintButton />
      </div>
      <article className="op-sheet mx-auto max-w-[820px] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6 text-[14px] leading-[1.55] shadow-[var(--shadow-1)] sm:p-9">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <Logo size={26} />
            <h1 className="mt-3 text-[24px] font-semibold leading-tight tracking-[-0.02em]">Know what you really owe, and why.</h1>
            <p className="mt-1 max-w-[60ch] text-[var(--ink-2)]">
              Satya links every Indian purchase line (PO, receipt, QC, invoice, debit note, payment, GSTR-2B/IMS) and puts a rupee-denominated
              statutory clock and an evidence trail on each link.
            </p>
          </div>
          <p className="text-xs text-[var(--muted)]">Prototype · Nov 2026</p>
        </header>

        <section className="mt-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">The problem</h2>
          <ul className="mt-2 grid gap-3 sm:grid-cols-4 print:grid-cols-4">
            {STATS.map((s) => (
              <li key={s.v}>
                <p className="tnum text-[18px] font-semibold">{s.v}</p>
                <p className="text-[12.5px] text-[var(--ink-2)]">{s.t}</p>
                <p className="text-[11px]"><Cites refs={s.r} /></p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13px] text-[var(--ink-2)]">
            Matching quality now drives statutory cost: MSMED interest, s.43B(h) deduction timing, Rule 37 ITC reversal after 180 days, IMS
            deemed acceptance, the 30-day e-invoice window and 194Q TDS short payments.
          </p>
        </section>

        <div className="mt-5 grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">The gap no tool closes</h2>
            <p className="mt-2 text-[13px] text-[var(--ink-2)]">Tools we reviewed each cover one or two of these five. None covers all five:</p>
            <ol className="mt-2 list-[lower-alpha] space-y-1 pl-5 text-[13px]">
              {CAPABILITIES.map((c) => <li key={c}>{c}</li>)}
            </ol>
          </section>
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">How we prove it</h2>
            <ul className="mt-2 space-y-1.5 text-[13px]">
              <li>Exact rules and decimal arithmetic first; calibrated ML in the middle; abstain when unsure.</li>
              <li>A public model card with data provenance, sample sizes and 95% intervals. No real-customer accuracy is claimed until a pilot measures it.</li>
              <li>Every money decision needs a person; the AI never moves money; a hash-chained audit trail.</li>
              <li>Research contributions: QC-aware matching, an Indian P2P benchmark, calibrated abstention.</li>
            </ul>
          </section>
        </div>

        <section className="mt-5">
          <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">An 8-week pilot on your data</h2>
          <table className="mt-2 w-full border-collapse text-left text-[13px]">
            <tbody>
              {PILOT.map(([w, t]) => (
                <tr key={w} className="border-b border-[var(--line)] last:border-0">
                  <th scope="row" className="w-28 py-1.5 pr-3 align-top font-medium">{w}</th>
                  <td className="py-1.5 text-[var(--ink-2)]">{t}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-[var(--muted)]">Success criteria and KPIs are agreed in week 0, before anyone sees results.</p>
        </section>

        <footer className="mt-5 border-t border-[var(--line)] pt-3 text-[11.5px] text-[var(--muted)]">
          Sources: Satya AP automation research (Nov 2026), 171 references, at /research. Live model card: /research/model · Pilot guide: /guide · ROI
          calculator: /roi · Trust: /trust. Satya is a prototype decision-support tool; it does not file returns or move money.
        </footer>
      </article>
    </div>
  );
}
