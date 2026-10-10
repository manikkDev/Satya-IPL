"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown, LogOut, User, Shield, Search, AlertTriangle,
  FileText, Network, Bell, Briefcase, ScanLine, BarChart3,
  Target, MessageSquare, Menu, X, Sparkles, GitBranch, Scale, Landmark
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

// Navigation sections - organized by workflow
const ANALYST_TOOLS = [
  { icon: BarChart3, label: "Command Center", href: "/analyst", desc: "Portfolio risk overview" },
  { icon: GitBranch, label: "FL Control Panel", href: "/analyst/fl", desc: "Federated training runs" },
  { icon: Network, label: "Risk Graph", href: "/analyst/graph", desc: "Pseudonymised Neo4j intelligence" },
  { icon: Scale, label: "Fairness Audit", href: "/analyst/fairness", desc: "Bias across institutions" },
];

const CITIZEN_TOOLS = [
  { icon: User, label: "My Risk Profile", href: "/citizen", desc: "Explainable risk score" },
  { icon: Shield, label: "Consent Center", href: "/citizen/consent", desc: "DPDP purpose controls" },
  { icon: MessageSquare, label: "AI Copilot", href: "/chat", desc: "Ask about your score" },
];

const DIRECT_LINKS = [
  { icon: MessageSquare, label: "Copilot", href: "/chat", badge: false },
  { icon: Network, label: "Network", href: "/graph", badge: false },
];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modulesOpen, setModulesOpen] = useState(false);
  const profileRef = useRef(null);
  const modulesRef = useRef(null);
  const { user, isLoading, logout } = useAuth();
  const userAvatar = user?.profileImageUrl || user?.avatarUrl || null;
  const userName = user?.name || user?.username || user?.email || "Profile";
  const userInitial = userName.charAt(0).toUpperCase();
  const userEmail = user?.email || "";

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
      if (modulesRef.current && !modulesRef.current.contains(event.target)) {
        setModulesOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-border/50"
      style={{
        backdropFilter: "blur(16px)",
        background: "color-mix(in srgb, var(--background) 90%, transparent)",
      }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative">
            <img
              src="/main-logo.png"
              alt="Arth Saathi"
              className="h-9 w-9 rounded-lg transition-transform group-hover:scale-105"
            />
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold tracking-tight text-foreground">
              Arth Saathi
            </span>
            <span className="text-[10px] text-muted-foreground -mt-1 hidden sm:block">
              Federated Risk Intelligence
            </span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center gap-1">
          {/* Analyst Dropdown */}
          <NavDropdown
            label="Analyst"
            items={ANALYST_TOOLS}
            icon={Landmark}
          />

          {/* Citizen Dropdown */}
          <NavDropdown
            label="Citizen"
            items={CITIZEN_TOOLS}
            icon={User}
          />

          {/* Direct Links */}
          {DIRECT_LINKS.map((tool) => (
            <NavLink key={tool.label} href={tool.href} icon={tool.icon} badge={tool.badge}>
              {tool.label}
            </NavLink>
          ))}
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2">
          {/* Quick Demo Button - Desktop */}
          <Link
            href="/analyst/fl"
            className="hidden md:flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Sparkles className="h-4 w-4" />
            Live FL Demo
          </Link>

          {/* Auth */}
          {!isLoading && (
            user ? (
              <div className="relative" ref={profileRef}>
                <button
                  onClick={() => setProfileOpen(!profileOpen)}
                  className="flex h-10 items-center gap-2 rounded-full border border-border bg-muted/50 px-2 pl-3 hover:bg-muted transition-colors"
                >
                  <span className="text-sm font-medium hidden sm:block">{userName.split(' ')[0]}</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                    {userAvatar ? (
                      <img src={userAvatar} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <span className="text-sm font-semibold text-primary">{userInitial}</span>
                    )}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${profileOpen ? 'rotate-180' : ''}`} />
                </button>
                
                {profileOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-background shadow-lg">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold">{userName}</p>
                      <p className="text-xs text-muted-foreground truncate">{userEmail}</p>
                    </div>
                    <button
                      onClick={() => { setProfileOpen(false); logout(); }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Sign in
              </Link>
            )
          )}

          {/* Mobile Menu Toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden flex h-10 w-10 items-center justify-center rounded-lg hover:bg-muted transition-colors"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-4 space-y-4">
            {/* Quick Actions */}
            <div className="flex gap-2">
              <Link
                href="/analyst/fl"
                onClick={() => setMobileOpen(false)}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
              >
                <GitBranch className="h-4 w-4" />
                Live FL Demo
              </Link>
            </div>

            {/* Analyst Section */}
            <MobileNavSection title="Analyst">
              {ANALYST_TOOLS.map((tool) => (
                <MobileNavLink key={tool.label} href={tool.href} icon={tool.icon} onClick={() => setMobileOpen(false)}>
                  <div>
                    <p className="font-medium">{tool.label}</p>
                    <p className="text-xs text-muted-foreground">{tool.desc}</p>
                  </div>
                </MobileNavLink>
              ))}
            </MobileNavSection>

            {/* Citizen Section */}
            <MobileNavSection title="Citizen">
              {CITIZEN_TOOLS.map((tool) => (
                <MobileNavLink key={tool.label} href={tool.href} icon={tool.icon} onClick={() => setMobileOpen(false)}>
                  <div>
                    <p className="font-medium">{tool.label}</p>
                    <p className="text-xs text-muted-foreground">{tool.desc}</p>
                  </div>
                </MobileNavLink>
              ))}
            </MobileNavSection>

            {/* Platform Section */}
            <MobileNavSection title="Platform">
              {DIRECT_LINKS.map((tool) => (
                <MobileNavLink key={tool.label} href={tool.href} icon={tool.icon} onClick={() => setMobileOpen(false)}>
                  {tool.label}
                </MobileNavLink>
              ))}
            </MobileNavSection>
          </div>
        </div>
      )}
    </nav>
  );
};

// Sub-components
function NavDropdown({ label, items, icon: Icon }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <Icon className="h-4 w-4" />
        {label}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
          <div className="p-1.5 space-y-0.5">
            {items.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors"
              >
                <item.icon className="h-4 w-4 text-primary mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NavLink({ href, children, icon: Icon, badge }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <Icon className="h-4 w-4" />
      {children}
      {badge && (
        <span className="ml-1 flex h-2 w-2 rounded-full bg-destructive" />
      )}
    </Link>
  );
}

function MobileNavSection({ title, children }) {
  return (
    <div className="border-t border-border pt-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
        {title}
      </p>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  );
}

function MobileNavLink({ href, children, icon: Icon, onClick }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted transition-colors"
    >
      <Icon className="h-4 w-4 text-primary" />
      {children}
    </Link>
  );
}

export default Navbar;
