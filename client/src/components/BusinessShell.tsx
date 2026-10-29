"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import ProtectedRoute from "@/components/auth/protected-route";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LayoutDashboard, Files, GitBranch, MessageSquare, Upload, ShieldCheck, FlaskConical, LogOut, Menu, X, LoaderCircle, ClipboardList, Bell, FileSignature, TrendingUp, Radio } from "lucide-react";
import { businessApi } from "@/lib/business-api";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/purchase-orders", label: "Purchase orders", icon: ClipboardList },
  { href: "/cases", label: "Investigations", icon: GitBranch },
  { href: "/contracts", label: "Contract obligations", icon: FileSignature },
  { href: "/predictive-risk", label: "Predictive risk", icon: TrendingUp },
  { href: "/outbox", label: "Communications & outbox", icon: Radio },
  { href: "/records", label: "Records", icon: Files },
  { href: "/inbox", label: "Import records", icon: Upload },
  { href: "/chat", label: "Ask Satya", icon: MessageSquare },
  { href: "/audit", label: "Review history", icon: ShieldCheck },
  { href: "/evaluation", label: "Model performance", icon: FlaskConical },
];

export function Brand() {
  return <Link href="/" className="satya-brand" aria-label="Satya home"><span className="satya-mark" aria-hidden="true">S</span><span>satya<span className="satya-brand-dot">.</span></span></Link>;
}

export default function BusinessShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    businessApi.alerts().then((res) => {
      if (active && res?.alerts) {
        setAlertCount(res.alerts.filter((a) => a.status !== "dismissed").length);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  return <ProtectedRoute>
    <div className="satya-workspace">
      <a href="#workspace-content" className="satya-skip-link">Skip to content</a>
      <aside className="satya-sidebar">
        <div className="satya-sidebar-brand"><Brand /><button ref={menuButton} className="satya-mobile-menu" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="workspace-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={22} /> : <Menu size={22} />}</button></div>
        <div className="satya-company">Business workspace<span>Orders, invoices & payments</span></div>
        <nav id="workspace-navigation" aria-label="Main navigation" className={menuOpen ? "is-open" : ""}>
          {links.filter((item) => item.href !== "/audit" || ["ap_manager", "auditor", "admin"].includes(user?.role || "")).filter((item) => item.href !== "/inbox" || user?.role !== "auditor").map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined} className={pathname.startsWith(href) ? "active" : ""} onClick={() => setMenuOpen(false)}><Icon size={20} aria-hidden="true" />{label}</Link>)}
          <button className="satya-mobile-signout" onClick={logout}><LogOut size={18} />Sign out</button>
        </nav>
        <div className="satya-sidebar-bottom"><div className="satya-trust-note"><ShieldCheck size={20} /><p>Every answer starts with your records. Missing information is never guessed.</p></div><div className="satya-profile"><span className="satya-avatar">{(user?.name || user?.email || "S").charAt(0).toUpperCase()}</span><span><strong>{user?.name || "Your account"}</strong><small>{user?.role === "ap_manager" ? "Finance manager" : user?.role === "ops_analyst" ? "Operations analyst" : user?.role === "admin" ? "Administrator" : "Auditor"}</small></span><button onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={19} /></button></div></div>
      </aside>
      <main className="satya-main" id="workspace-content" tabIndex={-1}>
        <header className="satya-topbar">
          <span>Workspace <span aria-hidden="true">/</span> <strong>{title}</strong></span>
          <div className="satya-topbar-tools">
            <Link href="/dashboard" className="satya-evidence-chip" title={`${alertCount} active system alerts`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', textDecoration: 'none' }}>
              <Bell size={14} className={alertCount > 0 ? "text-amber-500" : "text-muted-foreground"} />
              <span>{alertCount} {alertCount === 1 ? 'alert' : 'alerts'}</span>
            </Link>
            <span className="satya-tag">INR · India time</span>
            <ThemeToggle />
          </div>
        </header>
        <section className="satya-page"><div className="satya-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><span className="satya-demo-badge">Demo workspace · no live payments</span></div>{children}</section>
      </main>
    </div>
  </ProtectedRoute>;
}

export function evidenceLabel(value: string) {
  const labels: Record<string, string> = {
    PROVEN_FROM_INPUTS: "Supported by records",
    CONDITIONAL: "Needs confirmation",
    UNKNOWN: "Not confirmed",
    APPROVE: "Review for approval; other checks still apply",
    REQUEST_CLARIFICATION: "Request more information",
    PLACE_ON_HOLD: "Put this investigation on hold",
    ESCALATE: "Escalate for review",
    "SETTLED MONEY STILL NEEDS ALLOCATION": "A payment is not linked to an invoice",
    "THE SAME INVOICE REFERENCE APPEARS TWICE": "This invoice may be recorded twice",
    "PARTIAL DELIVERY IS EXPECTED AT THIS POINT": "The rest of the delivery is not due yet",
  };
  return labels[value.toUpperCase()] || value.replaceAll("_", " ");
}

export function Panel({ title, children, detail }: { title?: string; children: React.ReactNode; detail?: string }) {
  return <section className="satya-panel">{title && <div className="satya-panel-heading"><h2>{title}</h2>{detail && <p>{detail}</p>}</div>}{children}</section>;
}

export function State({ error, loading }: { error?: string; loading?: boolean }) {
  if (error) return <div role="alert" className="satya-notice error"><strong>We couldn’t complete that request.</strong><br />{error}</div>;
  if (loading) return <div role="status" className="satya-notice satya-loading"><LoaderCircle size={20} className="satya-spin" />Loading your records…</div>;
  return null;
}
