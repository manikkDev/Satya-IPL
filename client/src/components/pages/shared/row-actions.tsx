"use client";

// Row anatomy: one visible, contextual primary action ("Review", "Plan
// payment") + a "⋯" overflow menu for everything else. Clicks never bubble
// to a clickable row underneath.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { BTN_BASE, BTN_SIZES, BTN_VARIANTS } from "@/components/ui/v2";
import { cn } from "@/lib/utils";

export type RowAction = {
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  /** Draw a separator above this item. */
  separated?: boolean;
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

export function RowActions({
  primary,
  items = [],
  primaryVariant = "secondary",
  label = "More actions",
  className,
}: {
  primary?: RowAction | null;
  items?: RowAction[];
  primaryVariant?: "primary" | "secondary" | "outline" | "ghost";
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const PrimaryIcon = primary?.icon;
  const primaryClass = cn(BTN_BASE, BTN_SIZES.sm, BTN_VARIANTS[primaryVariant]);
  const visible = items.filter(Boolean);

  return (
    <div className={cn("flex items-center justify-end gap-1.5", className)} onClick={stop} onKeyDown={stop}>
      {primary ? (
        primary.href && !primary.disabled ? (
          <Link href={primary.href} className={primaryClass}>
            {PrimaryIcon ? <PrimaryIcon size={15} aria-hidden="true" /> : null}
            {primary.label}
          </Link>
        ) : (
          <button type="button" className={primaryClass} onClick={primary.onSelect} disabled={primary.disabled}>
            {PrimaryIcon ? <PrimaryIcon size={15} aria-hidden="true" /> : null}
            {primary.label}
          </button>
        )
      ) : null}
      {visible.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={label}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {visible.map((item, i) => {
              const Icon = item.icon;
              return (
                <div key={`${item.label}-${i}`}>
                  {item.separated && i > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem
                    disabled={item.disabled}
                    className={cn("text-[15px]", item.danger && "text-[var(--sev-critical)] focus:text-[var(--sev-critical)]")}
                    onSelect={() => {
                      if (item.onSelect) item.onSelect();
                      else if (item.href) router.push(item.href);
                    }}
                  >
                    {Icon ? <Icon size={16} className="mr-2" aria-hidden="true" /> : null}
                    {item.label}
                  </DropdownMenuItem>
                </div>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
