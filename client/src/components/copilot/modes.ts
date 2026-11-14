// Composer modes and "/" commands for Ask Satya.

import { Calculator, FileSearch, GitCompareArrows, Landmark, MessageCircleQuestion, NotebookPen, PenLine, Sun, Telescope, Users, Wallet, BellRing, type LucideIcon } from "lucide-react";
import type { AgentMode } from "@/lib/api/copilot";

export const MODE_META: Record<AgentMode, { label: string; short: string; icon: LucideIcon; description: string; placeholder: string }> = {
  ask: {
    label: "Ask", short: "Ask", icon: MessageCircleQuestion,
    description: "Quick answers from your records",
    placeholder: "Ask about a supplier, invoice, payment or deadline…",
  },
  analyse: {
    label: "Analyse", short: "Analyse", icon: Telescope,
    description: "Deeper, multi-step: compares suppliers and periods, cross-checks totals",
    placeholder: "What should I investigate? e.g. “Why did payables jump this month?”",
  },
  draft: {
    label: "Draft", short: "Draft", icon: PenLine,
    description: "Supplier emails, dispute letters and internal notes you can edit",
    placeholder: "What should I write? e.g. “Dispute email to Kaveri about the duplicate”",
  },
  plan: {
    label: "Plan payments", short: "Plan", icon: Wallet,
    description: "Builds a payment run within your budget and dates",
    placeholder: "Your budget and date, e.g. “₹5 lakh by Friday”",
  },
};

export type SlashCommand = {
  cmd: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  mode?: AgentMode;
  /** text placed in the box (cursor at the end) */
  text?: string;
  /** sent straight away */
  send?: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "/payrun", label: "Plan a payment run", hint: "Budget + date → ranked run to approve", icon: Wallet, mode: "plan", text: "Plan payments with a budget of ₹" },
  { cmd: "/remind", label: "Draft a reminder", hint: "Polite chaser to a supplier", icon: BellRing, mode: "draft", text: "Draft a reminder email to " },
  { cmd: "/explain", label: "Explain a case or invoice", hint: "What happened and what to do", icon: FileSearch, mode: "ask", text: "Explain " },
  { cmd: "/compare", label: "Compare periods", hint: "This month vs last, by supplier", icon: GitCompareArrows, mode: "analyse", send: "Compare purchases this month vs last month and tell me which suppliers drove the change" },
  { cmd: "/gst2b", label: "GSTR-2B check", hint: "Missing invoices and ITC at risk", icon: Landmark, mode: "ask", send: "Which invoices are missing from GSTR-2B, and how much ITC is at risk?" },
  { cmd: "/briefing", label: "Today's briefing", hint: "What needs you today", icon: Sun, mode: "ask", send: "Give me today's briefing — what needs my attention?" },
  { cmd: "/supplier", label: "Supplier deep-dive", hint: "Balance, issues, payments, trend", icon: Users, mode: "analyse", text: "Give me the full picture of supplier " },
  { cmd: "/note", label: "Write an internal note", hint: "For your CFO, MD or team", icon: NotebookPen, mode: "draft", text: "Write a note for our CFO on " },
  { cmd: "/calc", label: "Calculate", hint: "Exact maths, e.g. 18% of ₹2,50,000", icon: Calculator, mode: "ask", text: "Calculate " },
];
