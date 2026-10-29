"use client";

// Settings (/app/settings) — section index per 06 §5.11. Editors land as their
// APIs do; each card states exactly what it will control.

import Link from "next/link";
import { Building2, Users, Stamp, Scale, Hash, Palette, Boxes, Sparkles, Plug, type LucideIcon } from "lucide-react";

const SECTIONS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Building2, title: "Organisation & entities", body: "Legal names, GSTINs (live checksum), addresses, PAN/CIN, turnover band, LUT entries." },
  { icon: Users, title: "Users & roles", body: "Invite people, assign roles per entity — and see why makers can't also be checkers." },
  { icon: Scale, title: "Approvals (delegation)", body: "Document type × amount band → who must approve, e.g. over ₹10 lakh needs Plant Head." },
  { icon: Hash, title: "Numbering", body: "Series patterns with live preview, e.g. VPPL/PO/26-27/000124. GST invoice numbers stay ≤ 16 characters." },
  { icon: Stamp, title: "Branding", body: "Letterhead logo, stamp and signature images, colours — previewed on a sample PO." },
  { icon: Boxes, title: "Masters", body: "Suppliers, items and HSN codes with rates and effective dates." },
  { icon: Sparkles, title: "AI & data policy", body: "Choose paid/consented AI processing for real documents, consent per entity, usage history." },
  { icon: Plug, title: "Integrations", body: "Tally export and bank CSV formats (coming soon)." },
];

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--ink)]">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Group and entity setup, people, approvals and masters.</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Icon size={16} aria-hidden="true" /> {title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--muted)]">
        These editors open as their APIs land. Meanwhile, the <Link href="/dashboard" className="text-[var(--accent)] underline">current workspace</Link> stays available.
      </p>
    </div>
  );
}
