"use client";

import Link from "next/link";
import { ArrowUpRight, Files, GitBranch, ShieldCheck, MessageSquare, ArrowRight, FileCheck2, Wallet, PackageCheck } from "lucide-react";
import { Brand } from "@/components/BusinessShell";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const features = [
  { icon:Files, title:"Keep your records together", text:"See purchase orders, delivery receipts, supplier invoices and payments in one place. Original values stay visible." },
  { icon:GitBranch, title:"See what doesn’t match", text:"Follow split deliveries and payments. Check possible duplicates and missing references without losing the original records." },
  { icon:ShieldCheck, title:"Decide what happens next", text:"Ask for more information, put an order on hold or send it for review. Record your reason so the team can follow the decision." },
  { icon:MessageSquare, title:"Get an explanation", text:"Ask Satya about an order or payment. Get an answer backed by your company’s records, with links to the sources." },
];

export default function Home() {
  return <div className="min-h-screen bg-background">
    <header className="satya-landing-nav"><Brand /><nav aria-label="Website navigation"><a href="#how-it-works">How it works</a><Link href="/cases">Investigations</Link><Link href="/chat">Ask Satya</Link></nav><div className="flex items-center gap-4"><ThemeToggle /><Link href="/login" className="satya-button secondary">Open workspace <ArrowUpRight size={16} /></Link></div></header>
    <section className="satya-home-hero"><div><p className="satya-eyebrow">A clearer picture of your business</p><h1>Understand what you owe.<br /><span>Know why.</span></h1><p>Bring orders, deliveries, invoices and payments together. Spot what doesn’t match, check the records and decide what to do next.</p><div className="satya-case-card-actions"><Link href="/login" className="satya-button">Open your workspace <ArrowUpRight size={18} /></Link><a href="#how-it-works" className="satya-button secondary">See how it works</a></div><small>Demo data only. No live payments are made.</small></div><div className="satya-home-preview"><div className="satya-case-card-top"><strong>An order, explained</strong><span className="satya-status review">Needs review</span></div><p>Example · PO-1001</p><div className="satya-home-record"><Files size={22} /><span>Ordered<strong>100 pumps</strong></span><span className="satya-tag">Purchase order</span></div><div className="satya-home-record"><PackageCheck size={22} /><span>Delivered<strong>60 pumps</strong></span><span className="satya-tag">Delivery receipts</span></div><div className="satya-home-record"><Wallet size={22} /><span>Paid<strong>₹50,800</strong></span><span className="satya-tag">Referenced payments</span></div><div className="satya-notice warning"><FileCheck2 size={20} /><strong>Check before paying</strong><p>A second invoice may be a duplicate. Another ₹15,000 transfer still needs an invoice reference.</p></div></div></section>
    <section className="satya-landing-section satya-stat-strip" aria-label="The problem in numbers">
      <dl>
        <div><dt><strong>₹7.34 lakh crore</strong> in delayed payments owed to India’s MSMEs (March 2024)</dt><dd>GAME–FISME–C2FO, “Delayed Payments 3.0”</dd></div>
        <div><dt><strong>0.8–2%</strong> of annual disbursements are duplicate or erroneous payments</dt><dd>APQC Open Standards Benchmarking, via CFO.com</dd></div>
        <div><dt><strong>~16%</strong> of India’s gross value added comes from manufacturing</dt><dd>MoSPI data, Lok Sabha answer (2025-26 PE)</dd></div>
      </dl>
      <p className="satya-stat-note">Document mismatches — short deliveries, duplicate invoices, unadjusted advances — sit behind many of these disputes. Faster, evidence-backed checking shortens dispute cycles.</p>
    </section>
    <section id="how-it-works" className="satya-landing-section"><p className="satya-eyebrow">From scattered records to a clear next step</p><h2>Less time searching.<br /><em>More time understanding.</em></h2><div className="satya-feature-grid">{features.map(({ icon:Icon, title, text }, index) => <article className="satya-panel" key={title}><div className="flex items-center justify-between"><Icon className="text-primary" size={25} /><span className="satya-step-number">0{index + 1}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <section className="satya-landing-section satya-landing-demo"><div><p className="satya-eyebrow">Try a sample investigation</p><h2>100 pumps ordered.<br />60 delivered.<br /><em>One possible duplicate invoice.</em></h2><p>Some payments were split across transfers. Another payment is missing an invoice reference. See the amounts, check the records and find out what information is still needed.</p><Link href="/login" className="satya-button">Explore the demo <ArrowRight size={17} /></Link></div><div className="satya-demo-chain">{["Purchase order", "Delivery receipts", "Supplier invoices", "Payment records", "Review and next steps"].map((step, index) => <div key={step}><span>0{index + 1}</span><strong>{step}</strong><ShieldCheck size={19} /></div>)}<p>Fictional equipment-company records.<br />No live banking or government tax verification.</p></div></section>
    <footer className="satya-landing-footer"><Brand /><p>Know what you actually owe, and why.</p><span>Built for teams that check before they act.</span></footer>
  </div>;
}
