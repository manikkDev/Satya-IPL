"use client";

// Workspace shell: left sidebar (company switcher, grouped navigation, setup
// progress) + top bar (search/command palette, notifications, theme, account).
// On phones the sidebar becomes a bottom bar with the five most-used places
// and a "More" sheet with everything else.
//
// Information architecture — grouped by the job a finance team is doing:
//   Home · To review
//   Purchasing & payables: Orders · Invoices & documents · Payments · Suppliers
//   Tax & compliance:      Compliance
//   Insights:              Assistant · Reports · Model performance · Activity log
//   (footer)               Import data · Settings

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { useQuery } from "@tanstack/react-query";
import {
  Home, ListChecks, ClipboardList, FileText, Wallet, Building2, ShieldCheck, MessageSquare, BarChart3, Gauge,
  History, Settings, Search, LogOut, Menu, ChevronsUpDown, Sun, Moon, Upload, Plus, UserPlus, Rocket,
  ArrowRight, X, type LucideIcon,
} from "lucide-react";
import ProtectedRoute from "@/components/auth/protected-route";
import { AiCapacityPill } from "@/components/AiCapacityPill";
import { SessionProvider, useSession } from "@/components/v2/session";
import { HealthBanner } from "@/components/v2/health-banner";
import { mocksEnabled } from "@/lib/flags";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NotificationBell } from "@/components/v2/notification-bell";
import { onboarding, setupDismissKey } from "@/lib/api/onboarding";
import { roleLabel } from "@/content/copy/vocabulary";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/v2";
import { cn } from "@/lib/utils";

export type NavItem = { href: string; label: string; icon: LucideIcon; match?: string; hint: string };
type NavSection = { label?: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/app", label: "Home", icon: Home, match: "^/app/?$", hint: "What needs you today" },
      { href: "/app/investigations", label: "To review", icon: ListChecks, hint: "Issues Satya found that need a decision" },
    ],
  },
  {
    label: "Purchasing & payables",
    items: [
      { href: "/app/orders", label: "Orders", icon: ClipboardList, hint: "Purchase orders and their delivery, billing and payment" },
      { href: "/app/documents", label: "Invoices & documents", icon: FileText, hint: "Upload and confirm invoices, delivery notes, receipts" },
      { href: "/app/payments", label: "Payments", icon: Wallet, hint: "Match bank payments to the bills they settle" },
      { href: "/app/suppliers", label: "Suppliers", icon: Building2, hint: "Supplier details, MSME status, bank accounts, balances" },
    ],
  },
  {
    label: "Tax & compliance",
    items: [{ href: "/app/compliance", label: "Compliance", icon: ShieldCheck, hint: "MSME 45-day, GST credit, e-invoice and TDS deadlines" }],
  },
  {
    label: "Insights",
    items: [
      { href: "/app/ask", label: "Assistant", icon: MessageSquare, hint: "Ask about your payables in plain words — answers cite documents" },
      { href: "/app/reports", label: "Reports", icon: BarChart3, hint: "Totals, ageing and supplier summaries you can export" },
      { href: "/app/model", label: "Model performance", icon: Gauge, hint: "How accurate Satya's matching is, measured on your data" },
      { href: "/app/audit", label: "Activity log", icon: History, hint: "Every decision and change, with who made it and when" },
    ],
  },
];

export const NAV_FOOTER: NavItem[] = [
  { href: "/app/imports", label: "Import data", icon: Upload, hint: "Bring in Tally exports, bank statements and GSTR-2B" },
  { href: "/app/settings", label: "Settings", icon: Settings, hint: "Company details, approval rules, people and data" },
];

const MOBILE_NAV: NavItem[] = [
  NAV_SECTIONS[0].items[0],
  { ...NAV_SECTIONS[0].items[1], label: "Review" },
  { ...NAV_SECTIONS[1].items[1], label: "Documents" },
  NAV_SECTIONS[3].items[0],
];

const ALL_NAV = [...NAV_SECTIONS.flatMap((s) => s.items), ...NAV_FOOTER];

function isActive(pathname: string, item: NavItem) {
  if (item.match) return new RegExp(item.match).test(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const Icon = item.icon;
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[15px] leading-5 transition-colors duration-150",
        active
          ? "bg-[var(--sidebar-active-bg)] font-semibold text-[var(--sidebar-active-ink)]"
          : "text-[var(--sidebar-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
      )}
    >
      <Icon
        size={18}
        strokeWidth={active ? 2.2 : 1.9}
        aria-hidden="true"
        className={cn("shrink-0", active ? "text-[var(--accent)]" : "text-[var(--muted)] group-hover:text-[var(--ink-2)]")}
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-3">
      {NAV_SECTIONS.map((section, si) => (
        <div key={si} className={cn(si > 0 && "mt-6")}>
          {section.label ? (
            <p className="px-3 pb-1.5 text-[13px] font-medium text-[var(--muted)]">{section.label}</p>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function EntitySwitcher({ className }: { className?: string }) {
  const { entities, activeEntity, setActiveEntityId, group } = useSession();
  if (entities.length === 0) {
    return group ? <p className={cn("truncate px-1 text-[15px] font-semibold text-[var(--ink)]", className)}>{group.name}</p> : null;
  }
  if (entities.length === 1) {
    const only = entities[0];
    return (
      <div className={cn("rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2", className)}>
        <p className="truncate text-[15px] font-semibold leading-5 text-[var(--ink)]">{only.legalName}</p>
        <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">{only.gstin ? <span className="font-code">{only.gstin}</span> : "GSTIN not added yet"}</p>
      </div>
    );
  }
  return (
    <Select value={activeEntity?.id} onValueChange={setActiveEntityId}>
      <SelectTrigger
        className={cn("h-auto w-full gap-2 border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-left shadow-none [&>svg]:hidden", className)}
        aria-label="Choose company"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-5 text-[var(--ink)]">
            <SelectValue placeholder="Choose company" />
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-[var(--muted)]">
            {activeEntity?.gstin ? <span className="font-code">{activeEntity.gstin}</span> : `${entities.length} companies`}
          </span>
        </span>
        <ChevronsUpDown size={16} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectItem key={entity.id} value={entity.id} textValue={entity.legalName}>
            {entity.legalName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function useSetupProgress() {
  const { mocks, group, hasPermission } = useSession();
  const { data } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: () => onboarding.status(),
    enabled: !mocks,
    staleTime: 60_000,
  });
  const [localDismissed, setLocalDismissed] = useState(false);
  useEffect(() => {
    if (!group?.id) return;
    try {
      setLocalDismissed(localStorage.getItem(setupDismissKey(group.id)) === "1");
    } catch {
      /* storage unavailable */
    }
  }, [group?.id]);
  const visible = Boolean(
    data && data.completed < data.total && !data.dismissedAt && !localDismissed && group?.plan !== "demo" && hasPermission("entity.manage"),
  );
  return { status: data, visible };
}

function SetupCard() {
  const { status, visible } = useSetupProgress();
  const pathname = usePathname();
  if (!visible || !status || pathname.startsWith("/app/setup")) return null;
  return (
    <Link
      href="/app/setup"
      className="mx-3 mb-3 block rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[var(--line-strong)]"
    >
      <span className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
        <Rocket size={16} className="text-[var(--accent)]" aria-hidden="true" /> Finish setting up
      </span>
      <span className="mt-1 block text-[13px] text-[var(--muted)]">
        {status.completed} of {status.total} steps done
      </span>
      <Progress value={(status.completed / status.total) * 100} className="mt-2.5" label="Setup progress" />
    </Link>
  );
}

function DemoBanner() {
  const { group } = useSession();
  const [hidden, setHidden] = useState(false);
  if (group?.plan !== "demo" || hidden) return null;
  return (
    <div className="flex items-center gap-3 border-b border-[var(--line)] bg-[var(--saffron-soft)] px-4 py-2 text-[14px] text-[var(--ink-2)] sm:px-6 lg:px-10">
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-[var(--ink)]">You’re exploring a fictional company.</span>{" "}
        <span className="hidden sm:inline">The suppliers, invoices and payments are sample data — nothing here moves real money.</span>
      </span>
      <Link href="/signup" className="hidden shrink-0 font-semibold text-[var(--saffron-ink)] hover:underline sm:inline">
        Start a pilot with your data
      </Link>
      <button type="button" onClick={() => setHidden(true)} aria-label="Hide demo notice" className="grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--muted)] hover:text-[var(--ink)]">
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function ThemeToggleButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setTheme(dark ? "light" : "dark")}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="hidden h-10 w-10 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] sm:grid"
        >
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu() {
  const { user, logout, group } = useSession();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const roles = (user?.roles ?? []).map(roleLabel);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-10 items-center gap-2 rounded-[var(--radius-sm)] px-1.5 text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)] sm:px-2"
        aria-label="Account menu"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[14px] font-semibold text-[var(--on-accent)]">
          {(user?.name || "S").charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-36 truncate text-[15px] font-medium text-[var(--ink)] lg:block">{user?.name ?? "Account"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="py-2.5">
          <span className="block truncate text-[15px] font-semibold">{user?.name}</span>
          <span className="block truncate text-[13px] font-normal text-[var(--muted)]">{user?.email}</span>
          {roles.length || group ? (
            <span className="mt-1 block truncate text-[13px] font-normal text-[var(--muted)]">
              {[roles.join(", "), group?.name].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-[15px] sm:hidden" onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun size={16} className="mr-2" aria-hidden="true" /> : <Moon size={16} className="mr-2" aria-hidden="true" />}
          {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[15px]" onSelect={() => router.push("/app/settings")}>
          <Settings size={16} className="mr-2" aria-hidden="true" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[15px]" onSelect={() => router.push("/guide")}>
          <FileText size={16} className="mr-2" aria-hidden="true" /> User guide
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-[15px]" onSelect={logout}>
          <LogOut size={16} className="mr-2" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const ACTIONS: { label: string; hint: string; icon: LucideIcon; run: () => void; shortcut?: string }[] = [
    { label: "Ask the assistant", hint: "Questions about payables, answered with sources", icon: MessageSquare, run: () => go("/app/ask") },
    { label: "New purchase order", hint: "Raise a PO with GST worked out", icon: Plus, run: () => go("/app/orders/new") },
    { label: "Upload an invoice or document", hint: "PDF, photo, e-invoice JSON", icon: FileText, run: () => go("/app/documents") },
    { label: "Import data", hint: "Tally, bank statement, GSTR-2B", icon: Upload, run: () => go("/app/imports") },
    { label: "Invite a teammate", hint: "Add people with the right role", icon: UserPlus, run: () => go("/app/setup#team") },
    { label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode", hint: "Change the colour theme", icon: resolvedTheme === "dark" ? Sun : Moon, run: () => { onOpenChange(false); setTheme(resolvedTheme === "dark" ? "light" : "dark"); } },
  ];
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Go to a page or do something…" className="text-[15px]" />
      <CommandList>
        <CommandEmpty>No matches. Try asking the assistant instead.</CommandEmpty>
        <CommandGroup heading="Do something">
          {ACTIONS.map((action) => (
            <CommandItem key={action.label} value={`${action.label} ${action.hint}`} onSelect={action.run} className="py-2.5">
              <action.icon size={17} className="mr-2.5 text-[var(--muted)]" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] text-[var(--ink)]">{action.label}</span>
                <span className="truncate text-[13px] text-[var(--muted)]">{action.hint}</span>
              </span>
              {action.shortcut ? <CommandShortcut>{action.shortcut}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Go to">
          {ALL_NAV.map((item) => (
            <CommandItem key={item.href} value={`${item.label} ${item.hint}`} onSelect={() => go(item.href)} className="py-2.5">
              <item.icon size={17} className="mr-2.5 text-[var(--muted)]" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] text-[var(--ink)]">{item.label}</span>
                <span className="truncate text-[13px] text-[var(--muted)]">{item.hint}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

function MeErrorBanner() {
  const { meError, retryMe } = useSession();
  if (!meError) return null;
  return (
    <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--sev-high)]/40 bg-[var(--sev-high-soft)] px-4 py-3 text-[15px] text-[var(--ink-2)]">
      <span>Your workspace permissions couldn’t be loaded, so some actions are hidden. {meError}</span>
      <button type="button" onClick={retryMe} className="ml-auto font-semibold text-[var(--accent-strong)] hover:underline">Try again</button>
    </div>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="v2 min-h-screen bg-[var(--paper)]">
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--on-accent)]"
      >
        Skip to content
      </a>

      <div className="flex min-h-screen">
        {/* Sidebar — desktop */}
        <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-[var(--sidebar-line)] bg-[var(--sidebar-bg)] md:flex">
          <div className="px-5 pb-3 pt-5">
            <Link href="/app" aria-label="Satya home" className="inline-flex rounded-[var(--radius-sm)]">
              <Logo size={28} />
            </Link>
          </div>
          <div className="px-3 pb-4">
            <EntitySwitcher />
          </div>
          <NavLinks />
          <SetupCard />
          <div className="border-t border-[var(--sidebar-line)] px-3 py-3">
            <ul className="space-y-0.5">
              {NAV_FOOTER.map((item) => (
                <li key={item.href}><NavLink item={item} /></li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <DemoBanner />
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-[var(--line)] bg-[var(--topbar-bg)] px-4 backdrop-blur-md sm:gap-3 sm:px-6 lg:px-10">
            <Link href="/app" aria-label="Satya home" className="md:hidden">
              <LogoMark size={30} />
            </Link>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ml-auto flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] px-3 text-[15px] text-[var(--muted)] transition-colors hover:border-[var(--muted)] hover:text-[var(--ink-2)] md:ml-0 md:w-full md:max-w-md"
              aria-label="Search pages and actions"
            >
              <Search size={17} aria-hidden="true" className="shrink-0" />
              <span className="hidden truncate sm:inline">Search pages and actions…</span>
              <kbd className="ml-auto hidden rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-px font-code text-[13px] md:inline">⌘K</kbd>
            </button>
            <div className="hidden flex-1 md:block" />
            <div className="hidden xl:block">
              <AiCapacityPill />
            </div>
            <NotificationBell />
            <ThemeToggleButton />
            <UserMenu />
          </header>

          <main id="app-content" tabIndex={-1} className="flex-1 px-4 py-6 pb-28 outline-none sm:px-6 sm:py-8 md:pb-14 lg:px-10">
            <div className="mx-auto w-full max-w-[var(--content-max)]">
              <HealthBanner />
              <MeErrorBanner />
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Bottom nav — mobile */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-[var(--line)] bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[13px]", active ? "font-semibold text-[var(--accent-strong)] dark:text-[var(--accent)]" : "text-[var(--muted)]")}
            >
              <Icon size={21} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger className="flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[13px] text-[var(--muted)]" aria-label="All pages">
            <Menu size={21} aria-hidden="true" />
            More
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto border-[var(--line)] bg-[var(--sidebar-bg)] p-0 pb-6">
            <SheetTitle className="px-5 pb-3 pt-5 text-[17px] font-semibold text-[var(--ink)]">All pages</SheetTitle>
            <div className="px-3 pb-4"><EntitySwitcher /></div>
            <NavLinks onNavigate={() => setMoreOpen(false)} />
            <div className="mt-2 border-t border-[var(--sidebar-line)] px-3 pt-3">
              {NAV_FOOTER.map((item) => <NavLink key={item.href} item={item} onNavigate={() => setMoreOpen(false)} />)}
            </div>
          </SheetContent>
        </Sheet>
      </nav>

      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <span className="sr-only" aria-live="polite">{user?.name ? `Signed in as ${user.name}` : ""}</span>
    </div>
  );
}

/** Link to the setup checklist, for pages that want to nudge new workspaces. */
export function SetupLink({ className }: { className?: string }) {
  return (
    <Link href="/app/setup" className={cn("inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--accent-strong)] hover:underline dark:text-[var(--accent)]", className)}>
      Open setup <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const inner = (
    <SessionProvider>
      <ShellInner>{children}</ShellInner>
    </SessionProvider>
  );
  return mocksEnabled() ? inner : <ProtectedRoute>{inner}</ProtectedRoute>;
}
