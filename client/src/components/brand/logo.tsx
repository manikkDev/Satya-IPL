// Satya brand mark — "one trail": a geometric S drawn as a single continuous
// path that starts at a saffron source dot. It stands for the evidence trail
// from order → receipt → invoice → payment. Inline SVG so it stays crisp at
// any size and needs no network request.

import { useId } from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`satya-tile-${id}`} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0E7A5F" />
          <stop offset="1" stopColor="#0A5E4A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#satya-tile-${id})`} />
      <path
        d="M22 9.6H13.4a3.6 3.6 0 0 0 0 7.2h5.2a3.6 3.6 0 0 1 0 7.2H10"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.6" cy="9.6" r="1.95" fill="#F0A44B" />
    </svg>
  );
}

export function Logo({ size = 28, className, wordClassName }: { size?: number; className?: string; wordClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span
        className={cn("font-semibold tracking-[-0.035em] text-[var(--ink)]", wordClassName)}
        style={{ fontSize: Math.round(size * 0.72) }}
      >
        satya
      </span>
    </span>
  );
}
