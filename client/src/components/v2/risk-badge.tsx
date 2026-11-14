import { ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import type { SupplierRisk } from "@/lib/api/workflow";
import { cn } from "@/lib/utils";

const STYLE = {
  low: { icon: ShieldCheck, label: "Low", cls: "bg-[var(--confirmed-soft)] text-[var(--confirmed)]" },
  medium: { icon: Shield, label: "Medium", cls: "bg-[var(--possible-soft)] text-[var(--possible)]" },
  high: { icon: ShieldAlert, label: "High", cls: "bg-[var(--sev-critical-soft)] text-[var(--sev-critical)]" },
} as const;

/** Risk band + score — icon, word and number, never colour alone. */
export function RiskBadge({ risk, className }: { risk?: Pick<SupplierRisk, "band" | "score"> | null; className?: string }) {
  if (!risk) return <span className="text-[14px] text-[var(--muted)]">—</span>;
  const s = STYLE[risk.band];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-medium leading-none", s.cls, className)}>
      <s.icon size={14} aria-hidden="true" />
      {s.label} <span className="tnum opacity-80">· {risk.score}</span>
    </span>
  );
}
