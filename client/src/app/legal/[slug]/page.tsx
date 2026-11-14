import Link from "next/link";
import { SiteHeader } from "@/components/landing/site-header";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LEGAL_PAGES, legalPage } from "@/content/legal/pages";

export function generateStaticParams() {
  return LEGAL_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = legalPage((await params).slug);
  if (!page) return {};
  return { title: `${page.title} · Satya`, description: page.summary };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = legalPage((await params).slug);
  if (!page) notFound();

  return (
    <div className="v2 min-h-screen bg-[var(--paper)]">
      <SiteHeader />
      <div className="border-b border-[var(--line)] bg-[var(--surface)]">
        <nav className="mx-auto flex max-w-3xl gap-5 overflow-x-auto px-5 py-3 text-sm text-[var(--muted)]" aria-label="Legal">
          {LEGAL_PAGES.map((item) => (
            <Link
              key={item.slug}
              href={`/legal/${item.slug}`}
              className={item.slug === page.slug ? "whitespace-nowrap font-medium text-[var(--accent-strong)]" : "whitespace-nowrap hover:text-[var(--ink)]"}
            >
              {item.title.replace(" Policy", "").replace(" of Service", "")}
            </Link>
          ))}
        </nav>
      </div>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <p className="mb-6 rounded-[var(--radius-md)] border border-[var(--possible)]/40 bg-[var(--possible-soft)] px-4 py-3 text-sm leading-relaxed text-[var(--ink-2)]">
          <span className="font-medium text-[var(--ink)]">Prototype.</span> Satya is a student project with fictional demo data — not a
          commercial service. Please don’t upload real business or personal data.
        </p>
        <p className="text-xs text-[var(--muted)]">
          Last updated: {page.updated} · {page.version}
        </p>
        <h1 className="v2-display mt-3 text-4xl text-[var(--ink)]">{page.title}</h1>
        <p className="mt-4 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--accent-soft)] p-4 text-[15px] leading-relaxed text-[var(--ink)]">
          <span className="font-medium">In plain words: </span>
          {page.summary}
        </p>

        {page.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--ink)]">{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index} className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </main>

      <footer className="border-t border-[var(--line)] bg-[var(--surface)]">
        <p className="mx-auto max-w-3xl px-5 py-6 text-xs leading-relaxed text-[var(--muted)]">
          Satya is a decision-support tool. Verify important figures with your accountant or tax adviser. Satya does not
          file returns or move money.
        </p>
      </footer>
    </div>
  );
}
