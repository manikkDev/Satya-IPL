"use client";

// v2 app shell (docs/plan/06 §4): left sidebar + top bar with entity
// switcher, command palette, theme toggle, AI capacity pill and user menu.
// Collapses to a bottom nav on small screens. Wraps everything in the .v2
// token scope; theme comes from next-themes (dark is the showcase default).

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  Home, ClipboardList, Inbox, GitBranch, Wallet, Building2, ShieldCheck,
  MessageSquare, BarChart3, History, Settings, Search, LogOut, Menu,
  ChevronDown, Sun, Moon, type LucideIcon,
} from "lucide-react";
import ProtectedRoute from "@/components/auth/protected-route";
import { AiCapacityPill } from "@/components/AiCapacityPill";
import { SessionProvider, useSession } from "@/components/v2/session";
import { HealthBanner } from "@/components/v2/health-banner";
import { mocksEnabled } from "@/lib/flags";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from "@/components/ui/command";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui/sheet";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; match?: string };
type NavSection = { label?: string; items: NavItem[] };

const NAV_SECTIONS: NavSection[] = [
  { items: [{ href: "/app", label: "Today", icon: Home, match: "/app$" }] },
  {
    label: "Work",
    items: [
      { href: "/app/orders", label: "Orders", icon: ClipboardList },
      { href: "/app/documents", label: "Documents", icon: Inbox },
      { href: "/app/investigations", label: "Investigations", icon: GitBranch },
      { href: "/app/payments", label: "Payments", icon: Wallet },
    ],
  },
  {
    label: "Track",
    items: [
      { href: "/app/suppliers", label: "Suppliers", icon: Building2 },
      { href: "/app/compliance", label: "Compliance", icon: ShieldCheck },
    ],
  },
  { items: [{ href: "/app/ask", label: "Ask Satya", icon: MessageSquare }] },
  {
    label: "Manage",
    items: [
      { href: "/app/reports", label: "Reports", icon: BarChart3 },
      { href: "/app/audit", label: "Review history", icon: History },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

const MOBILE_NAV: NavItem[] = [
  { href: "/app", label: "Today", icon: Home, match: "/app$" },
  { href: "/app/orders", label: "Orders", icon: ClipboardList },
  { href: "/app/ask", label: "Ask", icon: MessageSquare },
  { href: "/app/documents", label: "Docs", icon: Inbox },
];

function isActive(pathname: string, item: NavItem) {
  if (item.match) return new RegExp(item.match).test(pathname);
  return pathname.startsWith(item.href);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-3">
      {NAV_SECTIONS.map((section, si) => (
        <div key={si} className={cn(si > 0 && "mt-5")}>
          {section.label ? (
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              {section.label}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-[13.5px] transition-all duration-150",
                      active
                        ? "bg-[var(--sidebar-active-bg)] font-medium text-[var(--sidebar-active-ink)]"
                        : "text-[var(--sidebar-ink)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)] transition-all duration-150",
                        active ? "opacity-100" : "opacity-0 group-hover:opacity-40",
                      )}
                      aria-hidden="true"
                    />
                    <Icon size={17} aria-hidden="true" className={cn("shrink-0 transition-colors", active && "text-[var(--accent)]")} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function EntitySwitcher() {
  const { entities, activeEntity, setActiveEntityId } = useSession();
  if (entities.length === 0) return null;
  return (
    <Select value={activeEntity?.id} onValueChange={setActiveEntityId}>
      <SelectTrigger
        className="h-9 w-auto max-w-56 gap-2 border-[var(--line)] bg-[var(--surface)] text-sm text-[var(--ink)] shadow-[var(--shadow-1)]"
        aria-label="Choose entity"
      >
        <span className="truncate text-[13px] [&_span]:mr-1.5">
          <SelectValue placeholder="Entity" />
        </span>
      </SelectTrigger>
      <SelectContent>
        {entities.map((entity) => (
          <SelectItem key={entity.id} value={entity.id} textValue={entity.legalName}>
            <span className="font-code text-xs text-[var(--muted)] mr-2">{entity.code}</span>
            {entity.legalName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ThemeToggleButton() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || theme === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setTheme(dark ? "light" : "dark")}
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu() {
  const { user, logout } = useSession();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-2)]"
        aria-label="Account menu"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-strong)] ring-1 ring-[var(--accent)]/30">
          {(user?.name || "S").charAt(0).toUpperCase()}
        </span>
        <span className="hidden sm:block max-w-32 truncate text-[13px]">{user?.name ?? "Account"}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="v2 w-56 border-[var(--line)] bg-[var(--surface)]">
        <DropdownMenuLabel>
          <span className="block truncate">{user?.name}</span>
          <span className="block truncate text-xs font-normal text-[var(--muted)]">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/app/settings")}>
          <Settings size={15} className="mr-2" aria-hidden="true" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout}>
          <LogOut size={15} className="mr-2" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const items = NAV_SECTIONS.flatMap((s) => s.items);
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page, order, supplier — or ask Satya…" />
      <CommandList>
        <CommandEmpty>No matches. Try “Ask Satya” instead.</CommandEmpty>
        <CommandGroup heading="Pages">
          {items.map((item) => (
            <CommandItem
              key={item.href}
              value={item.label}
              onSelect={() => {
                onOpenChange(false);
                router.push(item.href);
              }}
            >
              <item.icon size={16} className="mr-2" aria-hidden="true" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem
            value="Ask Satya"
            onSelect={() => {
              onOpenChange(false);
              router.push("/app/ask");
            }}
          >
            <MessageSquare size={16} className="mr-2" aria-hidden="true" />
            Ask Satya
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="New purchase order"
            onSelect={() => {
              onOpenChange(false);
              router.push("/app/orders/new");
            }}
          >
            <ClipboardList size={16} className="mr-2" aria-hidden="true" />
            New purchase order
          </CommandItem>
          <CommandItem
            value="Upload a document"
            onSelect={() => {
              onOpenChange(false);
              router.push("/app/documents");
            }}
          >
            <Inbox size={16} className="mr-2" aria-hidden="true" />
            Upload a document
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
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
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <div className="mx-auto flex min-h-screen max-w-[var(--app-max)]">
        {/* Sidebar — desktop */}
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col overflow-y-auto border-r border-[var(--sidebar-line)] bg-[var(--sidebar-bg)] md:flex">
          <div className="px-5 pb-4 pt-5">
            <Link href="/app" className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/satya.svg" alt="" aria-hidden="true" className="h-7 w-7 rounded-[7px]" />
              <span className="text-[19px] font-bold tracking-tight text-[var(--ink)]">
                satya<span className="text-[var(--accent)]">.</span>
              </span>
            </Link>
          </div>
          <NavLinks />
          <div className="border-t border-[var(--sidebar-line)] p-4">
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              Every number links back to a document. Missing information is never guessed.
            </p>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--topbar-bg)] px-4 backdrop-blur-md sm:px-6">
            <EntitySwitcher />
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="ml-auto flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--muted)] shadow-[var(--shadow-1)] transition-colors hover:border-[var(--line-strong)] hover:text-[var(--ink-2)]"
            >
              <Search size={15} aria-hidden="true" />
              <span className="hidden sm:inline">Search or ask…</span>
              <kbd className="hidden rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-px font-code text-[10px] sm:inline">⌘K</kbd>
            </button>
            <div className="hidden lg:block">
              <AiCapacityPill />
            </div>
            <ThemeToggleButton />
            <UserMenu />
          </header>

          <main id="app-content" tabIndex={-1} className="flex-1 px-4 py-7 pb-24 sm:px-6 md:pb-12 lg:px-8">
            <div className="mx-auto w-full max-w-[var(--content-max)]">
              <HealthBanner />
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Bottom nav — mobile */}
      <nav
        aria-label="Quick navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-[var(--line)] bg-[var(--sidebar-bg)] md:hidden"
      >
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]",
                active ? "font-medium text-[var(--accent)]" : "text-[var(--muted)]",
              )}
            >
              <Icon size={19} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-[var(--muted)]" aria-label="More pages">
            <Menu size={19} aria-hidden="true" />
            More
          </SheetTrigger>
          <SheetContent side="bottom" className="v2 border-[var(--line)] bg-[var(--sidebar-bg)] p-0 pb-6">
            <div className="px-5 pb-2 pt-5 text-sm font-medium text-[var(--ink)]">All pages</div>
            <NavLinks onNavigate={() => setMoreOpen(false)} />
          </SheetContent>
        </Sheet>
      </nav>

      <Palette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <span className="sr-only" aria-live="polite">{user?.name ? `Signed in as ${user.name}` : ""}</span>
    </div>
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
