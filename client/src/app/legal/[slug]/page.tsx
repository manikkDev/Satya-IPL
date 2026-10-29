import Link from "next/link";
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
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link href="/" className="text-lg font-semibold tracking-tight text-[var(--ink)]">
            satya<span className="text-[var(--accent)]">.</span>
          </Link>
          <nav className="flex gap-4 text-sm text-[var(--muted)]" aria-label="Legal">
            {LEGAL_PAGES.map((item) => (
              <Link
                key={item.slug}
                href={`/legal/${item.slug}`}
                className={item.slug === page.slug ? "font-medium text-[var(--accent-strong)]" : "hover:text-[var(--ink)]"}
              >
                {item.title.replace(" Policy", "").replace(" of Service", "")}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <p className="text-xs text-[var(--muted)]">
          Last updated: {page.updated} · Version {page.version}
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
