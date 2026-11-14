// Public pilot guide (/guide): "Bring your data: how a pilot works".
// Content lives in content/pitch/guide.ts (from the research report's
// onboarding playbook). Server component except for the checklist download.

import type { Metadata } from "next";
import Link from "next/link";
import { PitchPage, PitchHero, Section, Prose, Callout, DataTable, Pill } from "@/components/pitch/page-shell";
import { Cites } from "@/components/pitch/reference-list";
import { ChecklistDownload } from "@/components/pitch/checklist-download";
import { PILOT_STEPS, STEADY_STATE, DATA_CHECKLIST, HOW_TOS, PILOT_KPIS, FAQS } from "@/content/pitch/guide";

export const metadata: Metadata = {
  title: "How a pilot works",
  description:
    "The 8-week Satya pilot: contracts and DPA, data request, connecting Tally/Zoho/BUSY, clean-up, historical backtest, calibration, shadow mode and controlled go-live.",
};

const WEEKS = Array.from({ length: 9 }, (_, i) => i);

function Timeline() {
  return (
    <figure>
      <figcaption className="sr-only">Pilot timeline, weeks 0 to 8</figcaption>
      <div className="relative overflow-x-auto rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5" tabIndex={0} role="region" aria-label="Pilot timeline">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[16rem_repeat(9,minmax(0,1fr))] gap-y-2 text-[13px]">
            <span />
            {WEEKS.map((w) => (
              <span key={w} className="tnum border-l border-[var(--line)] pl-1.5 text-[var(--muted)]">W{w}</span>
            ))}
            {PILOT_STEPS.map((s) => (
              <div key={s.n} className="contents">
                <span className="truncate pr-3 text-[14px] text-[var(--ink-2)]" title={s.title}>{s.n}. {s.title}</span>
                <div className="relative col-span-9 h-6">
                  <div className="absolute inset-0 grid grid-cols-9" aria-hidden="true">
                    {WEEKS.map((w) => <span key={w} className="border-l border-[var(--line)]" />)}
                  </div>
                  <div
                    className="absolute inset-y-1 rounded-[4px] bg-[var(--accent)]"
                    style={{ left: `calc(${(s.weeks[0] / 9) * 100}% + 2px)`, width: `calc(${((s.weeks[1] - s.weeks[0] + 1) / 9) * 100}% - 4px)` }}
                    title={`${s.title}: ${s.weekLabel}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function GuidePage() {
  return (
    <PitchPage current="/guide">
      <PitchHero eyebrow="Bring your data" title="How a pilot works: eight weeks from paperwork to a measured go-live">
        <p>
          A pilot runs Satya on your real records, not a curated sample. First we measure it on your history, then run it
          in the shadows next to your team, and only then switch on the parts that earned it. Everything here is agreed
          in writing before any data moves.
        </p>
        <p className="text-[15px] text-[var(--muted)]">
          The 6–8 week window is a reasoned proposal. Our research found no standard pilot length or pass/fail threshold
          in the sources, so we agree both with you up front.
        </p>
      </PitchHero>

      <Section id="timeline" kicker="Overview" title="The timeline">
        <Timeline />
        <p className="mt-3 max-w-[72ch] text-sm text-[var(--muted)]">{STEADY_STATE}</p>
      </Section>

      <Section id="contracts" kicker="Step 0" title="Contracts and data protection come first">
        <div className="grid gap-4 md:grid-cols-2">
          <Prose className="text-[15.5px]">
            <p>
              Under India&apos;s Digital Personal Data Protection Act 2023, <strong className="font-semibold text-[var(--ink)]">you are the Data Fiduciary</strong>{" "}
              and <strong className="font-semibold text-[var(--ink)]">Satya is your Data Processor</strong>. Most AP records are business data, but
              proprietor names, phone numbers, individual bank accounts, approver names and sole-proprietor PANs are personal data, so the Act
              applies to those fields.
            </p>
            <p>
              The DPDP Rules were notified in November 2025, and most duties apply from about 13 May 2027 <Cites refs={[35]} />. Under them, a
              breach must be reported to the Data Protection Board with a detailed report within 72 hours <Cites refs={[36]} />. CERT-In&apos;s
              6-hour incident reporting and 180-day log retention apply already <Cites refs={[37]} />.
            </p>
          </Prose>
          <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)]">What the DPA covers</h3>
            <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--ink-2)]">
              {[
                "Purpose limitation: reconciliation for you, nothing else",
                "Full sub-processor list (cloud, GSP, OCR/LLM providers), with notice of changes",
                "Hosting region, encryption in transit and at rest, access logging",
                "Incident notice to you within 24 hours (proposed term)",
                "Deletion or return on exit, confirmed in writing",
                "Training shared models on your data: opt-in only",
                "Audit rights",
              ].map((x) => (
                <li key={x} className="flex gap-2.5"><span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-2)]" aria-hidden="true" />{x}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section id="steps" kicker="Step by step" title="What happens each week">
        <ol className="space-y-4">
          {PILOT_STEPS.map((s) => (
            <li key={s.n} id={`step-${s.n}`} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tnum text-sm text-[var(--muted)]">Step {s.n}</span>
                <h3 className="text-lg font-semibold text-[var(--ink)]">{s.title}</h3>
                <Pill>{s.weekLabel}</Pill>
              </div>
              <p className="mt-2 max-w-[72ch] text-[15.5px] leading-relaxed text-[var(--ink-2)]">{s.summary}</p>
              <ul className="mt-3 max-w-[72ch] space-y-2">
                {s.activities.map((a) => (
                  <li key={a} className="flex gap-2.5 text-[15px] leading-relaxed text-[var(--ink-2)]">
                    <span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-2)]" aria-hidden="true" />{a}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-[var(--ink)]">
                <span className="font-medium">Output:</span> {s.output}
                {s.refs.length ? <span className="ml-2 text-[13px]"><Cites refs={s.refs} /></span> : null}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="checklist"
        kicker="Step 1"
        title="Data request checklist"
        intro={<p>The same period (12–24 months) for every item. Missing something is normal. We adapt, and the inventory says what changes as a result.</p>}
      >
        <div className="mb-5"><ChecklistDownload /></div>
        <DataTable
          caption="Data request checklist"
          minWidth={720}
          head={["Item", "What exactly", "Where from", "Format", "Need"]}
          rows={DATA_CHECKLIST.map((c) => [c.item, c.detail, c.from, c.format, <Pill key="n" tone={c.need === "Required" ? "accent" : "neutral"}>{c.need}</Pill>])}
        />
      </Section>

      <Section id="export" kicker="How to export" title="Getting the data out of each system">
        <div className="grid gap-4 md:grid-cols-2">
          {HOW_TOS.map((h) => (
            <article key={h.system} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--ink)]">{h.system}</h3>
              <ol className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--ink-2)]">
                {h.steps.map((st, i) => (
                  <li key={st} className="flex gap-2.5"><span className="tnum text-[var(--muted)]">{i + 1}.</span><span>{st}</span></li>
                ))}
              </ol>
              {h.note ? <p className="mt-3 text-sm text-[var(--ink)]">{h.note}</p> : null}
              {h.refs.length ? <p className="mt-3 text-[13px]"><Cites refs={h.refs} /></p> : null}
            </article>
          ))}
        </div>
        <p className="mt-4 max-w-[72ch] text-sm text-[var(--muted)]">Menus differ between releases. We do the first export with you on a call.</p>
      </Section>

      <Section
        id="calibration"
        kicker="Steps 4–7"
        title="Backtest, calibration and shadow mode, in plain words"
        intro={
          <>
            <p>
              <strong className="font-semibold text-[var(--ink)]">Backtest.</strong> We replay your past 12–24 months and compare what Satya would have
              said with what your team actually did: booked, paid, raised a debit note or rejected in IMS. That gives precision and recall per
              exception type on your own data, before anyone relies on it.
            </p>
            <p>
              <strong className="font-semibold text-[var(--ink)]">Calibration.</strong> A model&apos;s &ldquo;95% sure&rdquo; is only meaningful if 95 out of
              100 such calls turn out right on <em>your</em> invoices. We fit that mapping per customer <Cites refs={[138]} />, then set the
              auto-accept line from costs <Cites refs={[141]} />. For example, if a review costs about ₹40 <Cites refs={[7]} /> and a wrong auto-match
              costs an illustrative ₹10,000, auto-accepting only makes sense above about 99.6% calibrated confidence.
            </p>
            <p>
              <strong className="font-semibold text-[var(--ink)]">Shadow mode.</strong> For two weeks or more Satya runs on live documents while your team
              decides exactly as today. We measure agreement and the mistakes it would have made, and hand-check a random 2–5% of would-be
              auto-matches.
            </p>
          </>
        }
      >
        <Callout tone="honest" title="Why we don't quote accuracy before this">
          <p>
            A threshold calibrated on synthetic data guarantees nothing on your invoices <Cites refs={[145]} />. That is why the first real accuracy figure
            for your business comes from your backtest, labelled as such on your model card.{" "}
            <Link href="/research/model" className="text-[var(--accent)] underline underline-offset-[3px]">See today&apos;s model card</Link>.
          </p>
        </Callout>
      </Section>

      <Section
        id="kpis"
        kicker="Success criteria"
        title="KPIs agreed before anyone sees results"
        intro={<p>Pre-registered in week 0 so the go-live decision can&apos;t be argued after the fact. Benchmarks are context, not targets we promise.</p>}
      >
        <DataTable
          caption="Pilot KPIs"
          minWidth={700}
          head={["KPI", "Definition", "Benchmark beside it"]}
          rows={PILOT_KPIS.map((k) => [k.kpi, k.definition, <span key="b">{k.benchmark}{k.refs.length ? <> <Cites refs={k.refs} /></> : null}</span>])}
        />
        <p className="mt-4 text-sm text-[var(--muted)]">
          Want to estimate value first? Try the <Link href="/roi" className="text-[var(--accent)] underline underline-offset-[3px]">ROI calculator</Link>.
        </p>
      </Section>

      <Section id="faq" kicker="Questions" title="Frequently asked questions">
        <div className="max-w-[72ch] divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {FAQS.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-[var(--ink)]">
                {f.q}
                <span className="text-xl leading-none text-[var(--muted)] transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <div className="mt-3 space-y-2.5 text-[15.5px] leading-[1.7] text-[var(--ink-2)]">
                {f.a.map((p) => <p key={p}>{p}</p>)}
              </div>
            </details>
          ))}
        </div>
        <p className="mt-6 text-sm text-[var(--muted)]">
          More on controls and AI governance: <Link href="/trust" className="text-[var(--accent)] underline underline-offset-[3px]">Trust & security</Link>.
        </p>
      </Section>
    </PitchPage>
  );
}
