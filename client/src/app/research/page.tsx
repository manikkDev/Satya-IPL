// Public research page (/research) — P3. Every figure below is from a real
// measurement in this repo (eval report + engine tests), with the method and
// date stated. Numbers are refreshed manually when suites change — no live
// telemetry is fabricated.

import Link from "next/link";
import { FlaskConical, CheckCheck, ShieldCheck, Gauge } from "lucide-react";

export const metadata = {
  title: "How we know it works — Satya research",
  description: "The evaluation data behind Satya: golden-set copilot runs, engine property tests, and what we measure before launch.",
};

const SUITES = [
  {
    icon: CheckCheck,
    title: "Copilot golden set",
    badge: "135 / 135 pass",
    lines: [
      "135 questions across status, why-amount, duplicates, unallocated payments, compliance, suppliers, graph queries, ambiguous prompts and prompt-injection attempts.",
      "10/10 clarification decisions correct — when a question could mean two records, Satya asks instead of guessing.",
      "10/10 refusals correct — out-of-scope questions get a plain refusal, not a confident wrong answer.",
      "0 fabricated figures detected in deterministic replay.",
      "Deterministic CI replay, 29 Oct 2026 (chatbot-backend/eval-report.json). Live-model runs via npm run eval:live.",
    ],
  },
  {
    icon: FlaskConical,
    title: "Reconciliation engine",
    badge: "218 / 218 tests",
    lines: [
      "Property tests with 200+ generated examples: cash and quantity conservation, order-invariance, deterministic snapshot ids, no future-data leakage.",
      "Flagship regression fixture: ₹20,000 evidence-supported / ₹90,800 recorded / ₹70,800 disputed / ₹15,000 unallocated — recomputed every run.",
      "p95 under 500 ms on 400-document cases in the current suite.",
      "Engine test suite, ml-fl-service, 29 Oct 2026.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "What we refuse to do",
    badge: "By design",
    lines: [
      "No money arithmetic in the browser — every total comes from the engine as a decimal string.",
      "Ambiguous links are never auto-guessed; they surface as \"needs your decision\" with named candidates.",
      "Statistical signals flag records worth checking — they are never shown as proof.",
      "A human confirms every extracted document before it becomes evidence.",
    ],
  },
];

export default function ResearchPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Research</p>
      <h1 className="mt-2 text-3xl font-semibold text-[var(--ink)]">How we know it works</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
        Satya checks purchase-to-payment records and explains its findings with evidence. Before any launch claim we
        measure three things: does the assistant answer correctly, does the engine compute correctly, and does the
        product refuse to guess when the evidence is unclear. Here is the current data — with the method, not just
        the headline.
      </p>

      <div className="mt-10 space-y-6">
        {SUITES.map(({ icon: Icon, title, badge, lines }) => (
          <section key={title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
                <Icon size={19} className="text-[var(--accent)]" aria-hidden="true" /> {title}
              </h2>
              <span className="rounded-full bg-[var(--confirmed-soft)] px-3 py-1 text-xs font-semibold text-[var(--confirmed)]">{badge}</span>
            </div>
            <ul className="mt-4 space-y-2">
              {lines.map((line) => (
                <li key={line} className="flex gap-2 text-sm leading-relaxed text-[var(--ink-2)]">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-8 rounded-[var(--radius-md)] border border-dashed border-[var(--line)] bg-[var(--surface)] p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--ink)]">
          <Gauge size={19} className="text-[var(--accent)]" aria-hidden="true" /> What we are still measuring
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
          Duplicate-detection recall/precision on real supplier invoices and the matching model&apos;s calibrated
          accuracy are deferred until the seeded generator produces labelled pairs — we publish numbers only when
          they mean something. The public baseline is BPI-2019-style procurement data where licences allow;
          everything we show you is reproducible from this repository.
        </p>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-[var(--muted)]">
        Method notes, fixtures and harnesses live in the repository (ml-fl-service/tests,
        chatbot-backend/test/golden). Questions: <Link href="/legal/terms" className="text-[var(--accent)] underline">read our terms</Link> or{" "}
        <Link href="/app/ask" className="text-[var(--accent)] underline">ask Satya</Link>.
      </p>
    </main>
  );
}
