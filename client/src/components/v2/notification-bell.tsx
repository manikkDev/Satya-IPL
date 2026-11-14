"use client";

// Top-bar notifications: derived server-side from new critical/high findings,
// reminders that are due, and investigations assigned to you. Polls gently
// (only while the tab is visible) and never invents alerts.

import Link from "next/link";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, OctagonAlert, AlarmClock, UserRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { workflow, type Notification } from "@/lib/api/workflow";
import { mocksEnabled } from "@/lib/flags";
import { cn } from "@/lib/utils";

const ICON = { finding: OctagonAlert, reminder: AlarmClock, assignment: UserRound } as const;
const TONE: Record<string, string> = {
  critical: "text-[var(--sev-critical)]",
  high: "text-[var(--sev-high)]",
  medium: "text-[var(--sev-medium)]",
  info: "text-[var(--accent)]",
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const enabled = !mocksEnabled();
  const { data, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: workflow.notifications,
    enabled,
    refetchInterval: () => (typeof document !== "undefined" && document.visibilityState === "visible" ? 60_000 : false),
    retry: 0,
    staleTime: 30_000,
  });
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && enabled && refetch();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, refetch]);

  if (!enabled) return null;
  const items = data?.items ?? [];
  const count = data?.unread ?? 0;

  const dismiss = async (keys: string[]) => {
    queryClient.setQueryData(["notifications"], (old: { items: Notification[]; unread: number } | undefined) =>
      old ? { items: old.items.filter((n) => !keys.includes(n.key)), unread: Math.max(0, old.unread - keys.length) } : old,
    );
    await workflow.dismiss(keys).catch(() => refetch());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={count ? `${count} notifications` : "Notifications"}
        className="relative grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink-2)] shadow-[var(--shadow-1)] transition-colors hover:text-[var(--ink)]"
      >
        <Bell size={15} aria-hidden="true" />
        {count > 0 ? (
          <span className="tnum absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--sev-critical)] px-1 text-[10.5px] font-semibold leading-none text-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--ink)]">Notifications</p>
          {items.length ? (
            <button
              type="button"
              onClick={() => dismiss(items.map((n) => n.key))}
              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              <CheckCheck size={13} aria-hidden="true" /> Clear all
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">You’re all caught up.</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto py-1">
            {items.map((n) => {
              const Icon = ICON[n.kind] ?? Bell;
              return (
                <li key={n.key} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--surface-2)]">
                  <Icon size={16} className={cn("mt-0.5 shrink-0", TONE[n.severity] ?? "text-[var(--muted)]")} aria-hidden="true" />
                  <Link href={n.href} className="min-w-0 flex-1" onClick={() => dismiss([n.key])}>
                    <p className="line-clamp-2 text-[13px] leading-snug text-[var(--ink)]">{n.title}</p>
                    {n.detail ? <p className="mt-0.5 text-xs text-[var(--muted)]">{n.detail}</p> : null}
                  </Link>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => dismiss([n.key])}
                    className="shrink-0 rounded px-1 text-xs text-[var(--muted)] opacity-0 transition-opacity hover:text-[var(--ink)] focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
