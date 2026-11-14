// Public trust & security page (/trust). Honest about the prototype stage:
// what exists in the product today, what is planned, and how the AI
// governance maps to RBI FREE-AI and NIST AI RMF ("aligned with", never
// "certified"). Content in content/pitch/trust.ts.

import type { Metadata } from "next";
import Link from "next/link";
import { PitchPage, PitchHero, Section, Prose, Callout, DataTable, Pill, LinkCard } from "@/components/pitch/page-shell";
import { Cites } from "@/components/pitch/reference-list";
import { TODAY, CONTROLS, FREE_AI, NIST, LIMITATIONS, ROADMAP, REPO_URL, type Mapping } from "@/content/pitch/trust";

export const metadata: Metadata = {
  title: "Trust & security",
  description: "How Satya handles data today, the controls in the product, AI governance mapped to RBI FREE-AI and NIST AI RMF, DPDP posture and what is still planned.",
};

const statusTone = (s: string) => (s === "In product" ? "accent" : s === "Partial" ? "warn" : "planned") as "accent" | "warn" | "planned";

function MappingTable({ rows, caption, frameworkCol }: { rows: Mapping[]; caption: string; frameworkCol: string }) {
  return (
    <DataTable
      caption={caption}
      minWidth={720}
      head={[frameworkCol, "What it expects", "What Satya does", "Status"]}
      rows={rows.map((r) => [r.area, r.expectation, r.satya, <Pill key="s" tone={statusTone(r.status)}>{r.status}</Pill>])}
    />
  );
}

export default function TrustPage() {
  return (
    <PitchPage current="/trust">
      <PitchHero eyebrow="Trust & security" title="What we do with your data, what the AI is allowed to do, and what isn't built yet">
        <p>
          Finance teams should be able to check our claims the way they check an invoice. This page separates what is in
          the product today from what is planned, and says plainly where we stand on certification.
        </p>
      </PitchHero>

      <Section id="today" kicker="Today" title="How data is handled right now">
        <div className="grid gap-4 sm:grid-cols-2">
          {TODAY.map((t) => (
            <div key={t.title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h3 className="text-base font-semibold text-[var(--ink)]">{t.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{t.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="controls"
        kicker="Controls"
        title="Controls in the product"
        intro={<p>Each control is marked <Pill tone="accent">In product</Pill> or <Pill tone="planned">Planned</Pill>. We don&apos;t blur the two.</p>}
      >
        <ul className="grid gap-4 md:grid-cols-2">
          {CONTROLS.map((c) => (
            <li key={c.title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-[var(--ink)]">{c.title}</h3>
                <Pill tone={statusTone(c.status)}>{c.status}</Pill>
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{c.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="ai-governance"
        kicker="AI governance"
        title="Aligned with RBI FREE-AI and NIST AI RMF, not certified against them"
        intro={
          <>
            <p>
              RBI&apos;s FREE-AI framework (August 2025) sets expectations for AI used by regulated entities: an AI inventory, human
              oversight, audit trail, incident reporting and DPDP-aligned data governance <Cites refs={[33, 34]} />. It matters to
              buyers who are, or supply, RBI-regulated entities. NIST&apos;s AI Risk Management Framework organises the same work into
              Govern, Map, Measure and Manage <Cites refs={[157]} />, and its generative-AI profile names confabulation as a specific
              risk for assistants like our copilot <Cites refs={[158]} />.
            </p>
            <p>
              Neither framework certifies vendors. &ldquo;Aligned&rdquo; here means we have mapped our controls to each expectation and
              marked honestly how far along we are. We found no ICAI AI-specific audit guidance, so we claim compliance with none.
            </p>
          </>
        }
      >
        <h3 className="mb-3 text-base font-semibold text-[var(--ink)]">RBI FREE-AI expectations</h3>
        <MappingTable rows={FREE_AI} caption="RBI FREE-AI mapping" frameworkCol="Expectation" />
        <h3 className="mb-3 mt-10 text-base font-semibold text-[var(--ink)]">NIST AI RMF functions</h3>
        <MappingTable rows={NIST} caption="NIST AI RMF mapping" frameworkCol="Function" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <LinkCard href="/research/model" title="Model card">
            Live metrics per model with data provenance, intervals, calibration, limitations and intended use.
          </LinkCard>
          <LinkCard href="/research#methods" title="Methods and evidence">
            Why each method was chosen, with the literature behind it.
          </LinkCard>
        </div>
      </Section>

      <Section id="dpdp" kicker="Privacy" title="DPDP posture">
        <Prose>
          <p>
            For a pilot or customer deployment, you are the Data Fiduciary and Satya is your Data Processor under the Digital Personal
            Data Protection Act 2023. Most AP data is business data, but proprietor names, phone numbers, individual bank accounts,
            approver names and sole-proprietor PANs are personal data.
          </p>
          <p>
            The DPDP Rules were notified in November 2025, with most duties applying from about 13 May 2027 <Cites refs={[35]} />. The
            Rules require a detailed breach report to the Data Protection Board within 72 hours <Cites refs={[36]} />. CERT-In&apos;s
            6-hour incident reporting and 180-day log retention already apply <Cites refs={[37]} />. Our DPA will commit to purpose
            limitation, a named sub-processor list, encryption, access logging, customer notice within 24 hours of an incident,
            deletion on exit, and opt-in only for any model training on your data.
          </p>
          <p>
            Language-model providers&apos; free tiers can use prompts to improve their products, which is not acceptable for client
            financial data under a DPA <Cites refs={[98]} />. Pilots will run only on paid tiers with no-training terms.
          </p>
        </Prose>
        <p className="mt-4 text-sm">
          <Link href="/guide#contracts" className="text-[var(--accent)] underline underline-offset-[3px]">How contracts work in a pilot</Link>
          <span className="mx-2 text-[var(--muted)]">·</span>
          <Link href="/legal/privacy" className="text-[var(--accent)] underline underline-offset-[3px]">Privacy notice</Link>
        </p>
      </Section>

      <Section id="limits" kicker="Responsible AI" title="Known limitations">
        <ul className="max-w-[72ch] space-y-3">
          {LIMITATIONS.map((l) => (
            <li key={l} className="border-l-2 border-[var(--line-strong)] pl-4 text-[15.5px] leading-[1.7] text-[var(--ink-2)]">{l}</li>
          ))}
        </ul>
      </Section>

      <Section id="roadmap" kicker="Roadmap" title="Planned, not done">
        <DataTable caption="Security and governance roadmap" minWidth={420} head={["Item", "Status"]} rows={ROADMAP.map((r) => [r.item, <Pill key="p" tone="planned">{r.note}</Pill>])} />
      </Section>

      <Section id="contact" kicker="Contact" title="Questions or a security concern?">
        <Callout title="Reach us through the project repository">
          <p>
            Open an issue on the{" "}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-[3px]">
              Satya project repository<span className="sr-only"> (opens in a new tab)</span>
            </a>
            . For a suspected vulnerability, please don&apos;t include exploit details in a public issue. Ask for a private channel
            first.
          </p>
        </Callout>
      </Section>
    </PitchPage>
  );
}
