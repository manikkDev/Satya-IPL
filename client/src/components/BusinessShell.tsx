"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import ProtectedRoute from "@/components/auth/protected-route";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ArrowUpRight, LayoutDashboard, Files, GitBranch, MessageSquare, Upload, ShieldCheck, FlaskConical, LogOut } from "lucide-react";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/cases", label: "Investigations", icon: GitBranch },
  { href: "/records", label: "Source records", icon: Files },
  { href: "/inbox", label: "Import workspace", icon: Upload },
  { href: "/chat", label: "Evidence copilot", icon: MessageSquare },
  { href: "/audit", label: "Decision trail", icon: ShieldCheck },
  { href: "/evaluation", label: "Model transparency", icon: FlaskConical },
];
export function Brand() {
  return <Link href="/" className="satya-brand"><span className="satya-mark">S</span><span>satya<span className="satya-brand-dot">.</span></span></Link>;
}
export default function BusinessShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  return <ProtectedRoute><div className="satya-workspace"><aside className="satya-sidebar"><Brand /><div className="satya-company">EQUIPMENT DISTRIBUTION<span>India · evidence-led operations</span></div><nav>{links.filter((item) => item.href !== '/audit' || ['ap_manager', 'auditor', 'admin'].includes(user?.role || '')).filter((item) => item.href !== '/inbox' || user?.role !== 'auditor').map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""}><Icon size={17} />{label}{pathname.startsWith(href) && <ArrowUpRight size={14} className="ml-auto" />}</Link>)}</nav><div className="satya-sidebar-bottom"><span className="satya-live">SOURCE-FIRST INTELLIGENCE</span><p>Financial facts come from records, not generated conclusions.</p><div className="flex items-center justify-between"><span className="text-xs">{user?.name}<br /><span className="text-muted-foreground">{user?.role?.replaceAll("_", " ")}</span></span><button onClick={logout} aria-label="Sign out"><LogOut size={18} /></button></div></div></aside><main className="satya-main"><header className="satya-topbar"><span>Operations / <strong>{title}</strong></span><div className="flex items-center gap-3"><span className="satya-tag">INR · IST</span><ThemeToggle /></div></header><section className="satya-page"><div className="satya-page-heading"><div><p className="satya-eyebrow">THE EVIDENCE WORKSPACE</p><h1>{title}</h1><p>{subtitle}</p></div><span className="satya-tag">Constructed demo · not live banking</span></div>{children}</section></main></div></ProtectedRoute>;
}
export function Panel({ title, children, detail }: { title?: string; children: React.ReactNode; detail?: string }) {
  return <section className="satya-panel">{title && <div className="satya-panel-heading"><h2>{title}</h2>{detail && <p>{detail}</p>}</div>}{children}</section>;
}
export function State({ error, loading }: { error?: string; loading?: boolean }) {
  if (error) return <div role="alert" className="satya-notice error">{error}</div>;
  if (loading) return <div className="satya-notice">Retrieving persisted business evidence…</div>;
  return null;
}
