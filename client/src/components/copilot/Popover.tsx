"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small anchored panel above the composer. Closes on outside click and Esc
 * (focus returns to the trigger). Full width on phones.
 */
export function Popover({
  open,
  onClose,
  children,
  className,
  label,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  anchor?: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor?.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        "sx-rise absolute bottom-[calc(100%+10px)] left-0 right-0 z-40 max-h-[min(70vh,560px)] overflow-y-auto rounded-[16px] border border-[var(--line)] bg-[var(--surface)] p-2 shadow-[var(--shadow-3)] sx-scroll sm:right-auto sm:w-[380px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Accessible on/off switch row. */
export function SwitchRow({ label, hint, checked, onChange, disabled, icon }: { label: string; hint?: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)] disabled:cursor-default disabled:hover:bg-transparent"
    >
      {icon ? <span className="mt-0.5 text-[var(--muted)]">{icon}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-[var(--ink)]">{label}</span>
        {hint ? <span className="block text-[12.5px] leading-snug text-[var(--muted)]">{hint}</span> : null}
      </span>
      <span className={cn("relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]", disabled && "opacity-60")} aria-hidden="true">
        <span className={cn("absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-transform duration-200", checked ? "translate-x-[19px]" : "translate-x-[3px]")} />
      </span>
    </button>
  );
}
