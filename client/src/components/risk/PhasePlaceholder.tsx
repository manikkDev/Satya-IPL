"use client";

import Link from "next/link";
import { useAuth } from "@/contexts/auth-context";

export default function PhasePlaceholder({ title, description, links = [] }: { title: string; description: string; links?: { href: string; label: string }[] }) {
  const { user, logout } = useAuth();
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <div><p className="text-sm text-muted-foreground">Arth Saathi · Phase 0</p><h1 className="text-3xl font-semibold">{title}</h1></div>
          <div className="flex items-center gap-3 text-sm"><span>{user?.name || user?.email}</span><button className="rounded-md border px-3 py-2" onClick={logout}>Sign out</button></div>
        </header>
        <section className="rounded-xl border bg-card p-8 shadow-sm">
          <p className="max-w-3xl text-muted-foreground">{description}</p>
          <p className="mt-5 rounded-md bg-muted p-4 text-sm">The route and authorization boundary are ready. Functional data visualizations are implemented in their scheduled phase.</p>
        </section>
        {links.length > 0 && <nav className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{links.map((link) => <Link key={link.href} href={link.href} className="rounded-lg border p-4 hover:bg-muted">{link.label}</Link>)}</nav>}
      </div>
    </main>
  );
}
