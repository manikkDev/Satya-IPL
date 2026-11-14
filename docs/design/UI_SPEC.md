# Satya UI spec — "calm, professional, understandable"

Owner feedback (Nov 2026): pages feel dumped and compact; Compliance is inconsistent and
dislocated; Home repeats itself; the "AI assistant available ▬▬" indicator is meaningless;
the assistant UI is cramped and lacks the premium feel of Claude/ChatGPT-style agents.
This spec is binding for every page. When in doubt: **show less, explain better, align everything.**

## 1. Principles
1. **One job per page.** Every page answers one question ("What needs me today?", "Which legal deadlines are at risk?"). The page header states it in plain words.
2. **Progressive disclosure.** Show the decision-relevant summary first; details on click (drawer, expandable row, "Show all"). Never print explanatory paragraphs on every row — explain a rule once, in an info panel.
3. **Say each fact once.** If a deadline is shown in "Needs you today", don't repeat it in three more widgets on the same page.
4. **Alignment over decoration.** Lists of like things are tables (desktop) with fixed columns: money right-aligned and tabular, dates in one column, status in one column, actions in the last column. Rows never change layout based on status.
5. **Colour carries meaning, sparingly.** No tinted row backgrounds or "walls of red". Status = small chip (icon + word) or a 3px left accent at most. Red only for overdue/critical.
6. **Plain language + numbers that read well.** ₹ in Indian grouping (no "₹₹"), "1 day" not "1 day(s)", dates as "14 Nov 2026", relative time where helpful ("due tomorrow"). Never show raw engine codes or internal ids to users.
7. **Every number is explainable.** Numbers that matter have a "How is this calculated?" affordance (tooltip/popover), not inline essays.

## 2. Layout & rhythm
- Content width: max 1200px for data pages, 760px for reading/conversation (Ask, long text).
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48. Page sections separated by 32–40. Card padding 24 (20 on mobile). Gap between cards 16–24.
- Page header: eyebrow (optional) · H1 28px · one-line description 15–16px muted · primary action on the right (max one primary + one secondary).
- Section header: 19px semibold + optional one-line description + optional right link ("View all →").
- KPI rows: max 3–4 cards; each = label, big number, one short explanation line, optional "See why".
- Tables: 15px body, 13–14px header (muted, sentence case), row height ≥ 56px, zebra none, row hover surface-2, sticky header for long lists, empty state inside the table frame. Mobile: rows become stacked cards with the same field order.
- Row actions: one visible primary action (contextual verb: "Plan payment", "Review issue", "Send reminder") + a "⋯" overflow menu for the rest.
- Filters: segmented chips with counts ("Overdue 7 · Due this week 1 · Upcoming 4 · On hold 3") above the table; search right-aligned.

## 3. Components to use/standardise (client/src/components/ui/v2.tsx)
PageHeader, SectionHeader, Card, StatCard/KPI, StatusChip (icon+word, tones: critical/warn/ok/info/neutral), Money, DateText, RelativeDue ("3 days overdue"/"due tomorrow"), DataTable/ResponsiveTable with column defs, RowActions (primary + overflow), FilterChips, InfoPanel (collapsible "How this check works"), EmptyState (icon, title, one line, action), Skeletons that match final layout, Drawer/Sheet for details.

## 4. Motion
150–220ms ease-out for hover/press/expand; content fades in (no slide-in of whole pages); skeleton → content crossfade; respect prefers-reduced-motion. Assistant streaming has its own rules (§6).

## 5. Topbar & AI status
Replace the "AI assistant available ▬▬" pill with an **"Ask Satya" button** (sparkle-free icon, e.g. message-circle) that opens the assistant, plus a tiny status dot inside it (green = AI on, amber = limited/evidence-only). Capacity details live only in a tooltip/popover in plain words ("AI answers available · resets 1:30 pm IST" / "Running in evidence-only mode — answers come straight from your records"). Never show quota bars or raw numbers in the topbar.

## 6. Ask Satya (assistant) — premium agent feel
- Layout: conversation column max 760px centred; history in a collapsible left rail; sources open in a right side panel on demand (not always visible).
- User message: right-aligned subtle bubble. Assistant message: no bubble, full-width text block with comfortable 16px/1.65 typography, headings and lists styled, tables as clean mini-tables with "Export CSV".
- **Streaming**: text appears progressively with a soft fade per chunk and a blinking caret while generating; auto-scroll only when the user is at the bottom; "Stop generating" button.
- **Thinking/steps**: while working show a compact animated "Working…" row; expandable "Steps" list (e.g. "Checking MSME deadlines ✓ 0.4s", "Calculating total ✓") — collapses automatically when the answer is ready, re-openable ("Show 3 steps").
- Citations: small numbered superscript chips; hover/focus shows a preview card (document type, number, supplier, amount, date, "Open").
- Action cards: clean bordered card with title, the key figures, consequences, Confirm / Edit / Dismiss; after confirm shows a success state with a link to the created record.
- Composer (bottom, large rounded): multiline textarea, send button, and a toolbar row:
  - **Mode selector**: Ask (quick answers) · Analyse (deep multi-step investigation) · Draft (emails, disputes, notes) · Plan payments (payment-run planner with budget).
  - **Tools/options popover** (toggles): Show my calculations, Include screening signals, Cite every figure (on, locked), Use only confirmed links, Scope (supplier / period / entity pickers).
  - **Attach a document** (PDF/image) → "Ask about this invoice".
  - "/" opens a command menu (/pay-run, /draft-reminder, /explain <case>, /compare-months, /gst-2b, /briefing).
  - Placeholder changes with mode; small footer text: "Satya can be wrong about context but never invents figures."
- Empty state: greeting + today's briefing as 3–4 calm summary cards (not a dense grid) + suggested prompts grouped by job (Payables, Suppliers, GST & compliance, Investigations) as large tappable rows.
- Feedback per answer: copy, thumbs up/down, regenerate, "Show steps".

## 7. Page-specific notes
- **Home**: (1) greeting + one-line status sentence ("3 bills need a decision today; ₹7.2 lakh is safe to pay"); (2) "Needs you today" — top 5 ranked items with one action each + "Show all"; (3) 3 KPIs (Safe to pay · On hold · Due this week) with drill-downs; (4) Two-column: "This week" mini-calendar/timeline of deadlines (not a duplicate long list) and "Unmatched money" (payments without an invoice); (5) Recent activity — human sentences, 5 items, link to Activity log. Remove the duplicated compliance widget (link to Compliance instead).
- **Compliance**: Overview first: 6 check cards (MSME 45-day, GSTR-2B match, Rule 37 180-day, TDS 194Q/194C, e-invoice & e-way bill, LUT) each with status chip (All clear / Needs attention / Action needed), count, ₹ at stake, next deadline, "Open". Selecting a check shows: InfoPanel "How this check works" (rule, consequence, how Satya computes, legal reference — collapsed by default after first view), filter chips with counts, an aligned table (Invoice · Supplier · MSME type · Amount · Deadline · Status · Interest est. · Action), disputed bills marked "On hold — resolve dispute" (never "Record payment" as the primary action), bulk actions (Send reminders, Export). Screening/compliance language: "screening, not tax advice" once in the info panel.
- All other pages: apply §2–§4; check every list for alignment, every empty state, every header.
