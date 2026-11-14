// Public research page (/research): the problem in Indian accounts payable,
// who it hurts, the statutory clocks, what existing tools do, the research
// gaps Satya works on, and the full bibliography. Every figure comes from
// "Satya AP automation research" (Nov 2026) with its source and date. Live
// model numbers are NOT shown here; they live on /research/model, generated
// by the evaluation service with provenance labels.

import type { Metadata } from "next";
import Link from "next/link";
import { PitchPage, PitchHero, Section, Prose, Callout, DataTable, LinkCard, Pill } from "@/components/pitch/page-shell";
import { Cites, ReferenceList } from "@/components/pitch/reference-list";
import {
  PROBLEM_STATS, GLOBAL_CONTEXT, PERSONAS, CLOCKS, COMPETITORS, CAPABILITIES, RESEARCH_GAPS, METHODS, HONESTY_NOTES,
} from "@/content/pitch/research";
import { REFERENCES } from "@/content/pitch/references";

export const metadata: Metadata = {
  title: "The problem & our research",
  description:
    "Why accounts payable in India is a statutory-clock problem, who it hurts, what existing tools cover, and the research Satya builds on. Every number is sourced.",
};

const TOC = [
  ["problem", "The problem in numbers"],
  ["who", "Who it hurts"],
  ["clocks", "The statutory clocks"],
  ["tools", "What existing tools do"],
  ["gaps", "Research gaps we work on"],
  ["methods", "How our methods map to the literature"],
  ["honesty", "What we can and can't claim yet"],
  ["references", "References"],
] as const;

export default function ResearchPage() {
  const notReverified = REFERENCES.filter((r) => r.notReverified).length;
  return (
    <PitchPage current="/research">
      <PitchHero eyebrow="The problem & our research" title="Indian payables run on statutory clocks. Most tools still treat them as data entry.">
        <p>
          A purchase line in India passes through a PO, a goods receipt, a quality check, an invoice, perhaps a debit
          note, a payment and the GST portal. At several of those steps a legal deadline starts running, and each one
          has a rupee cost if it is missed. This page sets out the problem, with a source for every figure, and the
          research behind how Satya approaches it.
        </p>
        <p className="text-[15px] text-[var(--muted)]">
          Source: Satya AP automation research (Nov 2026), 171 references. Live model results are on{" "}
          <Link href="/research/model" className="text-[var(--accent)] underline underline-offset-[3px]">Model performance</Link>. A printable{" "}
          <Link href="/research/one-pager" className="text-[var(--accent)] underline underline-offset-[3px]">one-page summary</Link> is available.
        </p>
      </PitchHero>

      <nav aria-label="On this page" className="mt-10 max-w-[72ch] rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">On this page</p>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[15px] sm:grid-cols-2">
          {TOC.map(([id, label], i) => (
            <li key={id}>
              <a href={`#${id}`} className="text-[var(--ink-2)] hover:text-[var(--accent)]">
                <span className="tnum mr-2 text-[var(--muted)]">{i + 1}.</span>{label}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* 1 — problem */}
      <Section
        id="problem"
        kicker="1 · The problem"
        title="One invoice in five needs a person, and in India each delay has a legal price"
        intro={
          <>
            <p>
              {GLOBAL_CONTEXT.text} <Cites refs={GLOBAL_CONTEXT.refs} />
            </p>
            <p className="text-[15px] text-[var(--muted)]">{GLOBAL_CONTEXT.note}</p>
          </>
        }
      >
        <ul className="grid gap-4 sm:grid-cols-2">
          {PROBLEM_STATS.map((s) => (
            <li key={s.value} className="flex flex-col rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <p className="tnum text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[var(--ink)]">{s.value}</p>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{s.label}</p>
              {s.caveat ? <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.caveat}</p> : null}
              <p className="mt-auto pt-4 text-[13px] leading-relaxed text-[var(--muted)]">
                {s.asOf} · <Cites refs={s.refs} />
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-6">
          <Callout tone="honest" title="A claim we deliberately don't make">
            <p>
              Some commentary says buyers dropped MSME suppliers after 43B(h). A parliamentary answer did not confirm
              this and put Udyam deregistrations at just 0.60% <Cites refs={[10]} />. We don&apos;t pitch on that story.
            </p>
          </Callout>
        </div>
      </Section>

      {/* 2 — personas */}
      <Section id="who" kicker="2 · Who it hurts" title="Four people pay for the same broken chain">
        <div className="grid gap-4 md:grid-cols-2">
          {PERSONAS.map((p) => (
            <article key={p.role} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h3 className="text-lg font-semibold text-[var(--ink)]">{p.role}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{p.who}</p>
              <ul className="mt-4 space-y-2.5">
                {p.pain.map((line) => (
                  <li key={line} className="flex gap-2.5 text-[15px] leading-relaxed text-[var(--ink-2)]">
                    <span className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-[var(--ink-2)]" aria-hidden="true" />
                    {line}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[13px] text-[var(--muted)]">Sources: <Cites refs={p.refs} /></p>
            </article>
          ))}
        </div>
      </Section>

      {/* 3 — clocks */}
      <Section
        id="clocks"
        kicker="3 · The statutory clocks"
        title="Six deadlines that turn matching errors into cash and tax costs"
        intro={<p>Plain-language summaries, not legal advice. Each links to the source we relied on. Rates and thresholds change, so confirm current values with your adviser.</p>}
      >
        <ol className="space-y-4">
          {CLOCKS.map((c, i) => (
            <li key={c.name} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tnum text-sm text-[var(--muted)]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-semibold text-[var(--ink)]">{c.short}</h3>
                <Pill>{c.name}</Pill>
              </div>
              <div className="mt-3 grid gap-5 md:grid-cols-[1.4fr_1fr]">
                <div className="max-w-[72ch] space-y-2 text-[15.5px] leading-[1.7] text-[var(--ink-2)]">
                  <p>{c.plain}</p>
                  <p className="text-[var(--muted)]">{c.rule}</p>
                  {c.caveat ? <p className="text-[var(--ink)]">{c.caveat}</p> : null}
                </div>
                <div className="rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-4 text-sm leading-relaxed text-[var(--ink-2)]">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Data needed per invoice</p>
                  <p className="mt-1.5">{c.satyaNeeds}</p>
                </div>
              </div>
              <p className="mt-4 text-[13px] text-[var(--muted)]">Sources: <Cites refs={c.refs} /></p>
            </li>
          ))}
        </ol>
        <Prose className="mt-6 text-[15px]">
          <p>
            Two related rules: under Rule 37A, ITC must be reversed by 30 November if the supplier hasn&apos;t paid the
            tax by 30 September <Cites refs={[23]} />, and GSTR-3B claims above GSTR-2B trigger DRC-01C with a 7-day
            response window <Cites refs={[24]} />.
          </p>
        </Prose>
      </Section>

      {/* 4 — tools */}
      <Section
        id="tools"
        kicker="4 · What existing tools do"
        title="Each tool covers one or two of five capabilities. None covers all five."
        intro={
          <p>
            In India, &ldquo;reconciliation&rdquo; usually means GST or bank reconciliation, not goods. The table is
            based on each vendor&apos;s own public pages as reviewed in November 2026. Vendor claims are{" "}
            <strong className="font-semibold text-[var(--ink)]">unverified</strong>, and &ldquo;not found&rdquo; means
            we didn&apos;t see it in the material reviewed, not that the product can&apos;t do it.
          </p>
        }
      >
        <DataTable
          caption="Existing tools and gaps"
          minWidth={760}
          head={["Player", "What it does (vendor description)", "Not found in public material", "Sources"]}
          rows={COMPETITORS.map((c) => [c.player, c.does, c.notFound, <Cites key="c" refs={c.refs} />])}
        />
        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1fr]">
          <div>
            <h3 className="text-base font-semibold text-[var(--ink)]">The five capabilities</h3>
            <ol className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--ink-2)]">
              {CAPABILITIES.map((c, i) => (
                <li key={c} className="flex gap-3"><span className="tnum text-[var(--muted)]">{String.fromCharCode(97 + i)}.</span>{c}</li>
              ))}
            </ol>
          </div>
          <Callout title="Where we think the moat is">
            <p>
              Calibrated confidence and evidence bundles can be copied quickly. The defensible part is the data model:
              QC and acceptance events, statutory clocks and an allocation ledger, plus accuracy that is measured and
              published. RazorpayX and Cygnet.One are the nearest threats.
            </p>
            <p className="text-sm text-[var(--muted)]">
              Pricing anchors: TallyPrime Silver ₹22,500 one-time <Cites refs={[65]} />; Zoho Books ₹749–9,999 per org per
              month <Cites refs={[66]} />; BILL $49–89 per user per month <Cites refs={[54]} />.
            </p>
          </Callout>
        </div>
      </Section>

      {/* 5 — gaps */}
      <Section
        id="gaps"
        kicker="5 · Research gaps"
        title="Eight questions the literature hasn't answered, which a pilot can"
        intro={<p>The research team searched for each of these and did not find it. Each is both a product difference and a candidate paper or dataset release.</p>}
      >
        <DataTable
          caption="Research gaps Satya addresses"
          minWidth={720}
          head={["#", "Gap (not found)", "What Satya can contribute", "Anchor"]}
          rows={RESEARCH_GAPS.map((g, i) => [String(i + 1), g.gap, g.contribution, <Cites key="g" refs={g.anchors} />])}
        />
        <Prose className="mt-5 text-[15px]">
          <p>
            Gaps 4 and 7 are the quickest to publish. Gap 5, QC-aware matching, is the strongest commercial claim: no
            competitor page we reviewed mentions QC-accepted quantity or rejection debit notes.
          </p>
        </Prose>
      </Section>

      {/* 6 — methods */}
      <Section
        id="methods"
        kicker="6 · Methods"
        title="Cheap determinism first, calibrated ML in the middle, language models at the edges"
        intro={
          <p>
            Across matching, allocation, anomaly detection, extraction and copilots, the literature points to one
            architecture. Use exact identifiers and arithmetic wherever they exist, a well-featured probabilistic scorer
            for the structured middle, and an optimiser for allocation. Reserve deep and language models for messy
            text. Wrap every probabilistic decision in calibration and abstention. Which of these are running today, and
            how well, is reported on the model page, not here.
          </p>
        }
      >
        <DataTable
          caption="Satya methods mapped to literature"
          minWidth={760}
          head={["Question", "Satya's method", "Why (evidence)", "Sources"]}
          rows={METHODS.map((m) => [m.problem, m.method, m.why, <Cites key="m" refs={m.refs} />])}
        />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <LinkCard href="/research/model" title="Model performance">
            Live metrics with provenance labels, intervals, reliability and coverage curves. Also in the workspace at /app/model.
          </LinkCard>
          <LinkCard href="/guide" title="How a pilot works">
            The 8-week plan for running Satya on your own data: paperwork, data request, backtest, shadow mode, go-live.
          </LinkCard>
        </div>
      </Section>

      {/* 7 — honesty */}
      <Section id="honesty" kicker="7 · Honesty" title="What we can and can't claim yet">
        <div className="max-w-[72ch] space-y-3">
          {HONESTY_NOTES.map((n) => (
            <p key={n} className="border-l-2 border-[var(--line-strong)] pl-4 text-[15.5px] leading-[1.7] text-[var(--ink-2)]">{n}</p>
          ))}
          <p className="pt-2 text-[15px] leading-relaxed text-[var(--muted)]">
            Why this matters: vendors claim &ldquo;97 to 99 percent accuracy&rdquo; without a dataset, sample size or
            interval <Cites refs={[70, 71]} />, and &ldquo;touchless&rdquo; is defined differently by each vendor
            <Cites refs={[72, 73]} />. We would rather publish a smaller number with its denominator.
          </p>
        </div>
      </Section>

      {/* 8 — references */}
      <Section
        id="references"
        kicker="8 · References"
        title="References"
        intro={
          <p className="text-[15px]">
            All {REFERENCES.length} sources from the research report, grouped by type. {notReverified} items are marked{" "}
            <span className="rounded-full border border-dashed border-[var(--line-strong)] px-2 py-px text-[12.5px] text-[var(--muted)]">not re-verified</span>:
            canonical papers whose identifiers came from bibliographic records and were not re-opened during the
            research. Vendor sources are commercial claims unless stated otherwise.
          </p>
        }
      >
        <ReferenceList />
      </Section>
    </PitchPage>
  );
}
