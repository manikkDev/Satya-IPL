# 06 — Agent D: Frontend & UX (`client/**`)

You own everything the user sees: public website, product app, graph, PO wizard & PDF, copilot UI, legal pages. Read 00, 01 (§2–§9 — you must understand the domain to design it), 02 (§2, §3, §5, §7). The judges and customers are **not technical**: clarity beats cleverness.

Owner test command:
```bash
cd client && npm run lint && npm test && npm run build      # unit tests (node --test / vitest) + type/lint + production build
npm run test:e2e                                             # Playwright (system Chrome), against docker compose stack
```
You are the only agent that runs `next dev`/`next build` on the host (00 §5).

---

## 1. Current state & cleanup
- Next.js 15.5 App Router, React 19, Tailwind v4, Radix primitives, framer-motion 11, lucide, sonner, cmdk, react-markdown. Pages: `/`, `/login`, `/signup`, `/dashboard`, `/cases`, `/cases/[id]`, `/records`, `/inbox`, `/purchase-orders`, `/chat`, `/audit`, `/evaluation`. Components: `BusinessShell`, `BusinessGraph` (simple), `DeliveryProgress`, `ImportWorkspace`; styles in `src/styles/business.css`.
- Legacy to delete (after confirming no imports): `src/legacy/**`, `components/risk/**`, `CircularFlowDiagram`, `DemoPreviewSection`, `FeaturesSection`, `HeroSection`, `HowItWorks`, `Navbar.jsx`, `NetworkGraph.jsx`, `PatternResult`, `ProblemsSesction`, `StatsSection`, `Footer.jsx`, legacy chat UI pieces (`components/ui/chat*.tsx`, `message-*`, `excalidraw-viewer`, `ml-payload-graph-viewer`, `audio-visualizer`, `interrupt-prompt`, `tts-button`, `mermaid` usage), `lib/excalidraw-sanitizer.ts`, `lib/audio-utils.ts`, `lib/api.ts` (legacy). Remove unused deps: `@excalidraw/excalidraw`, `mermaid`, `d3` (if graph moves to Cytoscape), `panzoom`, `shiki` (unless used for code), `fuse.js` (if unused).
- Keep working demo flows behind flags until v2 screens replace them (00 §6.7).

## 2. Design principles & vocabulary

### 2.1 Principles
1. **Answer first, details on demand** (progressive disclosure): every page opens with the one sentence/number that matters, then "Why?", then evidence.
2. **One primary action per screen**, clearly labelled with a verb ("Approve ₹60,000", "Ask supplier for credit note").
3. **Plain words + the official term**: "Goods received (GRN)". First use on a page has a `<Term>` tooltip.
4. **Never colour alone**: certainty and severity always have icon + word.
5. **Show the trail**: every number is clickable → evidence drawer (document preview, the exact field/quote, calculation).
6. **Calm, credible, Indian**: ₹ with Indian grouping (₹1,23,456.00), dates `30 Oct 2026`, IST, FY labels "FY 2026-27".
7. **No AI-slop aesthetics**: no gratuitous gradients, glassmorphism, neon glows, emoji, stock 3D blobs, or "✨ AI" badges. Motion only to explain change (state transitions, money flowing along the graph, progress), always respecting `prefers-reduced-motion`.
8. **Fast & forgiving**: optimistic UI where safe, skeletons not spinners, undo for non-financial actions, autosave drafts.

### 2.2 Vocabulary map (use exactly these UI labels)
| Internal | UI label | Tooltip (≤ 20 words) |
|---|---|---|
| evidenceSupportedPayable | **What you really owe** | Delivered and accepted goods at the agreed price, minus payments, advances and credit notes. |
| recordedPayable | **What your books show** | The unpaid amount in your accounting entries, including any duplicates. |
| disputedExposure | **Amount under question** | Money tied to possible duplicates, over-billing or unlinked payments. |
| itcAtRisk | **GST credit at risk** | Input tax credit you may lose or have to reverse if not fixed. |
| CONFIRMED / PROBABLE / POSSIBLE / AMBIGUOUS / INSUFFICIENT_EVIDENCE | **Confirmed / Likely / Possible / Unclear — needs your decision / Missing information** | (explain basis per finding) |
| APPROVE / REQUEST_CLARIFICATION / ESCALATE / PLACE_ON_HOLD | **Approve / Ask for clarification / Escalate / Put on hold** | |
| GRN | Goods received (GRN) | Your stores team's record of what physically arrived. |
| QC | Quality check | Accepted vs rejected quantity after inspection. |
| PI | Proforma invoice (PI) | Supplier's advance bill/quote — not a tax invoice. |
| IRN | e-invoice number (IRN) | Unique number given when the invoice is registered on the GST system. |
| UTR | Bank reference (UTR) | Unique transfer number from your bank for NEFT/RTGS/IMPS. |
| GSTR-2B / IMS | GST purchase statement (GSTR-2B) / Invoice inbox (IMS) | |
| Finding | Issue | |
| Case / Investigation | Order check (per PO) / Investigation | |
| Snapshot | Saved check (as of date) | |

## 3. Design system (build first — P1)
- **Tokens** in `src/styles/tokens.css` (CSS variables, light + dark):
  - Surfaces: `--paper #F7F6F2` (light bg), `--surface #FFFFFF`, `--surface-2 #F0EEE8`, `--ink #14213D` (primary text/brand navy), `--ink-2 #3D4A63`, `--muted #6B7385`, `--line #E3E0D8`.
  - Brand accent: `--accent #0F766E` (teal 700), `--accent-strong #115E59`, `--accent-soft #E6F3F1`.
  - Semantic (certainty/severity, colour-blind safe with icons): confirmed `#15803D`, likely `#0E7490`, possible `#A16207`, unclear `#7C3AED`, missing `#64748B`; severity critical `#B91C1C`, high `#C2410C`, medium `#A16207`, low `#0E7490`, info `#475569`.
  - Dark theme equivalents with WCAG AA contrast (verify with a contrast checker; record ratios in a comment).
  - Radius 10/14/20; shadows subtle (1–2 layers); spacing 4-pt scale; container widths 1200 (app content max 1440 with sidebar).
- **Typography** via `next/font`: Inter (UI, `font-feature-settings: "tnum"` for numbers), Fraunces or Instrument Serif (**public site headings only**), JetBrains Mono (IDs, UTRs, GSTINs). Type scale: 12/14/16/18/22/28/36/48/64.
- **Components** (`src/components/ui/*`, shadcn/ui-style on Radix, Tailwind v4): Button, IconButton, Badge, CertaintyBadge, SeverityBadge, ActionButton (maps Action → verb/colour), Money (formats string amounts; never parses to float for arithmetic), Qty, DateText, Term (tooltip), Card, StatCard, Table (TanStack Table: sort, filter, column visibility, sticky header, virtualised > 200 rows), Tabs, Drawer (evidence), Dialog, Stepper, Combobox (async search), FileDrop, Skeleton, EmptyState (with next action), ErrorState (with retry + plain message), Toast (sonner), CommandPalette (cmdk: jump to PO/invoice/supplier, run actions), Timeline, ProgressRing, Kbd.
- Libraries to add (verify latest stable versions and React 19 compatibility before installing; record in STATUS): `@tanstack/react-query` (server state, retries, cache), `@tanstack/react-table`, `react-hook-form` + `zod` + `@hookform/resolvers`, `cytoscape` + `cytoscape-dagre` (or `cytoscape-elk`) for the graph, `@react-pdf/renderer` (PDF generation in browser), `qrcode` (QR on PDF), `recharts` (simple charts). Avoid heavy UI kits.

## 4. Information architecture
Public (marketing, SSG): `/` · `/product` · `/how-it-works` · `/pricing` · `/research` · `/security` · `/about` · `/contact` · `/legal/privacy` · `/legal/terms` · `/legal/cookies` · `/legal/dpa` · `/legal/ai` · `/legal/grievance` · `/verify/[hash]` (document verification) · `/login` · `/signup`.
App (auth, `/app/*`, left sidebar + top bar with entity switcher, search/command palette, AI capacity pill, user menu):
- `/app` **Today** · `/app/orders` (POs) · `/app/orders/new` (wizard) · `/app/orders/[id]` · `/app/sales/pi/new` (outgoing PI, distribution entity only) · `/app/documents` (inbox) · `/app/documents/[draftId]` (review) · `/app/investigations` · `/app/investigations/[id]` · `/app/payments` (+ allocation workbench) · `/app/suppliers` · `/app/suppliers/[id]` · `/app/compliance` · `/app/ask` (copilot full page) · `/app/reports` · `/app/audit` · `/app/settings/{organisation,entities,users,approvals,policies,numbering,branding,masters,ai}`.
Redirect old routes (`/dashboard`→`/app`, `/cases`→`/app/investigations`, `/purchase-orders`→`/app/orders`, `/inbox`→`/app/documents`, `/chat`→`/app/ask`, `/records`→`/app/documents?tab=records`, `/evaluation`→`/research#evaluation`) via `next.config.js` redirects once v2 is live.
Mobile: sidebar collapses to bottom nav (Today, Orders, Ask, Documents, More). All pages usable at 360 px.

## 5. Screens (acceptance criteria per screen)

### 5.1 Today (`/app`)
Top: greeting + entity switcher + date. Row of 4 StatCards: **What you really owe**, **Amount under question**, **GST credit at risk**, **Payments due this week** (each with delta vs last week and "See why"). Section "Needs your attention" (max 7 items: holds, approvals, ambiguous payments, deadlines) each as a one-line sentence with primary action button. "Deadlines" timeline (MSME 45-day, Rule 37 180-day, e-invoice 30-day, PO delivery dates) with days-left chips. "Recent activity". Empty state for new orgs: setup checklist (add entity details → add suppliers → create first PO or import → upload a document → ask Satya). Data: `GET /api/v2/dashboard/today`.

### 5.2 Orders list & PO detail
List: filters (status, supplier, entity, date, "has issues"), columns (PO number, supplier, value, delivered %, invoiced %, paid %, issues, status). Detail page: header (PO number, revision, supplier, entity, status, actions: Amend, Short-close, Download PDF, Ask about this PO); **Line lifecycle table** (ordered / received / accepted / invoiced / paid / open per line with mini progress bars, integer-safe formatting); **Delivery schedule** (batches with due dates; overdue highlighted); tabs: Documents (all linked docs as cards), Money trail (graph), Issues, Timeline, History (revisions with diff). Keep and improve existing `DeliveryProgress` (receipt milestones, clickable evidence).

### 5.3 PO / PI creation wizard (`/app/orders/new`, `/app/sales/pi/new`)
A guided, question-style stepper with a **live document preview on the right** (desktop) / toggle (mobile). Autosave draft every change (debounced 800 ms) via `PATCH /documents/:id`.
1. **Who is buying?** entity (billing GSTIN auto), ship-to address (choose/add), cost centre, required-by date. Place of supply derived (explain "This decides CGST+SGST vs IGST").
2. **Who is the supplier?** async search; shows GSTIN validity (checksum), state, MSME category badge (with tooltip about 45-day rule), bank account status (read-only), payment terms default; "Add new supplier" inline sheet.
3. **What are you buying?** item rows: item search (master + HSN), description, specs, HSN (with rate preview & "effective from" + notification ref from API), UOM, qty, rate, discount; "Split into delivery batches" per line (qty + date pairs, must sum to line qty).
4. **Commercial terms**: payment terms builder (advance % against PI, balance credit days after acceptance, milestones), delivery terms (Ex-works / FOR destination / other), freight/packing/insurance (included / extra with amount & tax), inspection (pre-dispatch / on receipt), warranty months, penalty/LD (% per week, cap %), validity; terms template picker (from policy) with editable clauses; "These are sample clauses — review with your legal adviser."
5. **Tax & totals**: server-computed preview (`POST /documents/:id/compute`, debounced; show "Calculating…" state; never compute in JS); tax summary by HSN/rate; warnings (e.g., "HSN rate depends on product details — confirm", "E-way bill will be required (value > ₹50,000)").
6. **Approvals**: shows who must approve per DoA ("Needs approval from Plant Head because value > ₹10 lakh"); submit.
7. **Issue & share**: after approval → Issue (assigns number) → Download PDF, Download CSV/JSON, Copy verify link, Email text (copy), Print.
Validation: react-hook-form + zod mirroring API rules; errors in plain language next to fields; keyboard friendly; screen-reader labels.

### 5.4 PO / PI PDF (client-side with `@react-pdf/renderer`, data from `GET /documents/:id/render-model`)
A4 portrait, 15 mm margins, embedded fonts (Inter + Noto Sans for ₹ glyph coverage; verify ₹ renders). Layout:
- **Letterhead header**: logo (left), legal name, address, GSTIN, PAN, CIN, phone/email (right); thin accent rule. Uses entity branding colours.
- Title bar: "PURCHASE ORDER" / "PROFORMA INVOICE" + "Revision R1" if amended + "Original/Duplicate" marker.
- Meta grid: PO number, date, FY, reference (PR/quotation), payment terms, delivery terms, required-by, place of supply (state + code), buyer contact.
- Party blocks: Supplier (name, address, GSTIN, MSME/Udyam no.), Bill-to, Ship-to.
- Items table: #, description (+ specs line), HSN, qty, UOM, rate, discount, taxable value, GST % and amount (CGST/SGST or IGST columns depending on supply), line total; delivery schedule sub-rows; repeat header on page break.
- Charges rows; **Tax summary by HSN/rate** table; totals block (taxable, CGST, SGST, IGST, cess, round-off, grand total) + **amount in words** (from API).
- Terms & conditions (numbered clauses) — may continue on next page.
- For PI: bank details for advance, validity, "This is not a tax invoice".
- For export/SEZ under LUT: endorsement "Supply meant for export/SEZ under LUT without payment of IGST — LUT ARN …, FY …".
- Signature block: "For <Entity legal name>", uploaded **stamp/seal image** and **signature image** (from branding settings) + "Authorised Signatory", name/designation; footnote "This is a computer-generated document. Images of seal/signature are not a digital signature."
- **Footer** every page: entity footer text, "Page x of y", verification QR (`qrcode`) encoding `PUBLIC_SITE/verify/<contentHash>` + short hash text.
- Filenames: `<number with / replaced by ->.pdf`. Golden-image test: render the flagship PO to PDF in CI and assert page count, presence of key strings (PDF text extraction).

### 5.5 Documents inbox (`/app/documents`)
Big drop zone ("Drop invoices, delivery notes, bank statements, GST files — PDF, photo, Excel, CSV, JSON"), recent uploads list with live status (Queued → Reading → Checking → Needs your review / Saved / Failed with reason). Data-policy notice before first AI extraction (01/00 rule 8): "Sample/demo data may be processed by Google Gemini free tier; for real company documents enable paid processing or consent in Settings → AI." Tabs: Uploads, Needs review, Records (all documents table, replaces old Records page), Structured import (existing CSV/JSON mapping workspace, restyled; keep the sample-download and validation preview behaviour that tests depend on).
**Review screen** (`/app/documents/[draftId]`): split view — left: document preview (PDF via `<iframe>`/pdf.js-less image pages from API, zoom); right: extracted fields grouped (Parties, Document, Lines, Taxes, Totals, GST/e-invoice) with confidence chips (High/Check/Low), source badge ("From verified e-invoice QR", "Read by AI — quote found", "Read by AI — please check"), issues list with fix suggestions; clicking a field highlights its quote (text search) on the preview; line table editable; supplier & PO suggestions to confirm; "Save as evidence" primary action (disabled until required fields valid). Keyboard: Tab through low-confidence fields first.

### 5.6 Investigations list & detail (`/app/investigations/[id]`)
Header: subject (PO/supplier), status, recommendation banner (big, plain: "Put ₹70,800 on hold — likely duplicate of INV-041. Approve ₹20,000 backed by deliveries.") with ActionButtons (role-aware; disabled with reason when not permitted). Three balance cards (§2.2). Tabs:
1. **Summary** — issues sorted by risk: card per finding with CertaintyBadge, exposure, explanation, "What would settle this?", evidence chips, "Ask Satya about this".
2. **Money trail** — the graph (§6).
3. **Timeline** — chronological documents with knowledge-time **replay slider** ("What did we know on 12 Oct?") — uses `?asOf=`.
4. **Calculations** — step-by-step derivations with evidence links (human-readable formula lines).
5. **Documents** — all linked docs.
6. **Decisions & audit** — history, who/when/why, maker-checker status.
7. **What-if** — scenario builder ("If the remaining 40 pumps arrive…", "If T03 is for INV-042…") → preview diff of balances/findings; clearly labelled "Preview — nothing saved".
Decision dialog: action, scope amounts, reason (required), confirmation; shows SoD reason if blocked; stale revision → friendly refresh prompt.

### 5.7 Payments & allocation workbench
Import bank CSV; list payments with allocation status (Linked / Partly linked / Unclear / Not linked). Workbench for an unclear payment: left payment details; right candidate invoices with the engine's solutions ("Solution A: INV-041 ₹15,000", "Solution B: INV-042 ₹10,000 + AP-992 ₹5,000"); choose solution or manual allocation (amounts must sum — validated by API); require remittance evidence attachment or reason.

### 5.8 Suppliers
List with MSME badge, open value, overdue MSME amount, issues. Supplier 360: KPIs, open POs, deliveries, invoices, payments, statement reconciliation, duplicate-vendor alerts (with Fellegi–Sunter reasons), bank-account change history (maker-checker), Benford indicator labelled "statistical signal, not evidence".

### 5.9 Compliance (`/app/compliance`)
Tabs: GSTR-2B match (period picker; matched / missing in 2B / missing in books / value mismatch; ITC at risk total), MSME 45-day (list by days left, 43B(h) exposure), Rule 37 (180-day), TDS checks, e-invoice & e-way bill checks, LUT validity. Each row explains the rule in one line with a "Learn more" link to the matching help article (same content the copilot uses). Disclaimer: "Satya helps you find issues in your documents; it does not file returns or give tax advice."

### 5.10 Ask Satya (copilot) — full page `/app/ask` + drawer everywhere
Layout: left rail (conversation list with search, "New chat"); centre conversation (max width 760 px); right panel (collapsible) "Sources & graph" showing citations for the selected answer, evidence previews and a mini graph of referenced documents. Top of centre: context chip ("About: PO VPPL/PO/26-27/000123" removable). Composer: multiline, Enter to send, Shift+Enter newline, attach context (pick PO/supplier), suggested prompts by page context. Message rendering: answer markdown (headings off, lists on), **inline citation chips [1] [2]** that open the evidence drawer, answer cards (label/value/detail) only when the backend sends them, certainty line ("Confidence: Likely — based on 3 documents"), follow-up suggestion chips, actions: copy, "Open investigation", thumbs up/down. Live progress line while waiting, driven by SSE `status`/`tool` events ("Finding PO… Reading 4 documents… Checking payments… Writing answer"), not a fake typing animation. Clarification answers render as option buttons. Evidence-only mode banner when `mode:"evidence_only"`.
**AI capacity pill** (under composer, right-aligned, small, muted): `AI capacity ≈ 1,240 requests left today · resets 12:30 PM IST` with a thin progress bar; tooltip shows per-model estimates and "Estimates from free-tier limits; Satya switches keys automatically and falls back to evidence-only answers if needed." Admins see "Active key: key-07 · 61 of 68 available". Poll `GET /api/v2/ai/usage` every 60 s and update from SSE `usage` events. Colour: neutral; amber below 15%; shows "Evidence-only mode" when exhausted.
Drawer variant: `Cmd/Ctrl+K` → "Ask Satya", or floating button on app pages; carries page context automatically.

### 5.11 Settings
Organisation & entities (GSTIN with live checksum validation, state, addresses, CIN/PAN, AATO band with explanation, LUT entries), Users & roles (invite, assign roles per entity, SoD explanation), Approvals (DoA matrix editor: doc type × amount band → roles), Policies (tolerances with examples "₹100 or 0.5%, whichever is higher"), Numbering (pattern builder with live preview `VPPL/PO/26-27/000124`), Branding (logo, stamp, signature uploads with preview on a sample PO; colours), Masters (suppliers, items, HSN search), AI & data (data policy, consent toggle per entity, usage history), Integrations (placeholders: Tally export, bank CSV formats).

### 5.12 Audit
Filterable log with hash-chain status badge ("Audit trail intact ✓ verified 2 min ago") and export.

## 6. Money-trail graph v2 (`components/graph/*`)
Goal: a non-technical owner understands the story of an order in 10 seconds.
- **Layout**: Cytoscape.js with `dagre` (or ELK) left→right **swim-lanes by stage**: Order → Dispatch → Receipt → Quality → Invoice → Payment → GST. Parties (entity/supplier) pinned at top. Lanes labelled with plain words and light background bands.
- **Nodes**: card-like (rounded rect) with icon per document type, document number, one key value (qty or ₹), date; status ring colour; finding badge (count, severity colour + icon).
- **Edges**: width ∝ amount (log scale), style by certainty: solid (Confirmed), solid-thin (Likely), dashed (Possible), dotted purple with "?" marker (Unclear), red dashed with ⚠ for suspected duplicate; edge label on hover/selection ("₹30,000 · bank reference quotes INV-041").
- **Interactions**: click node → side panel (document summary, key fields, evidence quotes, open document, "Ask Satya about this"); click edge → why this link exists + certainty + "Confirm / Reject link" (role-aware, creates decision); hover highlights the full path to the PO; **Focus mode** (isolate one line's story); **Filters** (show payments only, show issues only); search box; zoom controls + fit; mini-map; **Replay** slider (uses `timeline`; animates nodes appearing in time order; respects reduced motion); "Explain this graph" button → copilot summary; legend always visible (bottom-left, collapsible); export PNG.
- **Degraded mode**: if `source:"snapshot"`, small note "Showing saved graph (live graph service unavailable)".
- **Accessibility**: "View as list" toggle rendering the same nodes/edges as a grouped, keyboard-navigable list/table; node focus via keyboard; ARIA live region announcing selection.
- Performance: ≤ 300 nodes smooth; > 300 → cluster by stage with expand.

## 7. Public website (marketing) — design and content
Tone: confident, specific, Indian business context, no hype words ("revolutionary", "magic"). Every claim has a source or is clearly labelled as our product capability.
- **Landing `/`** sections (scroll-reveal with framer-motion `whileInView`, subtle, once; reduced-motion → none):
  1. Hero: headline "Know what you really owe — and why." Sub: "Satya matches your purchase orders, deliveries, invoices, payments and GST records, flags costly errors with proof, and tells you what to do next." CTAs: "Try the live demo" / "Book a pilot". Visual: an animated, real (not stock) mini money-trail of the flagship case where a duplicate invoice gets flagged.
  2. The problem in numbers (cite: ₹7.34 lakh crore delayed MSME payments, 0.8–2% duplicate/erroneous disbursements, manufacturing 16% of GVA) with source footnotes.
  3. How it works (4 steps: Create or import → Satya reads & checks → See issues with proof → Decide with confidence).
  4. The flagship story as a scroll-driven walkthrough (sticky graph that updates per step: order 100 → 60 delivered → duplicate invoice → split payments → "₹20,000 really owed").
  5. Features grid (PO/PI with GST, document reading with verified e-invoice QR, evidence-backed issues, ambiguity handling, compliance deadlines, copilot, money-trail graph, audit trail).
  6. Built for India (GST, e-invoice, e-way bill, MSME 45-day, TDS, LUT, INR/IST).
  7. Trust & security (data isolation, audit hash chain, no auto-payments, AI data policy) → link `/security`.
  8. Research-backed (logos-free list of papers/datasets) → `/research`.
  9. Pricing teaser → `/pricing`. 10. FAQ. 11. Footer (legal links, grievance officer, contact).
- **`/pricing`**: plans from the team doc (Starter / Growth / Group / CA Partner / Enterprise) with monthly/annual toggle (annual = 2 months free), feature table, "All prices exclude GST", FAQ. Values come from a single config file `src/content/pricing.ts` (team edits there).
- **`/research`**: methodology (rules + calibrated ML + conformal ambiguity + evidence-first copilot), datasets (real vs semi-synthetic, licences), evaluation report rendered from `GET /api/v2/research/evaluation` (charts: reliability diagram, coverage vs α, PR curves, ablation table) with limitations box, and full reference list from `08_RESEARCH_REFERENCES.md` (copy into `src/content/references.ts`).
- **`/security`**: architecture of isolation, encryption in transit, hashing of bank accounts, audit chain, RBAC/SoD, AI data handling, incident contact.
- **Legal pages** (`/legal/*`): content requirements in 07 §4. Render from MDX/TSX content files in `src/content/legal/` with "Last updated" date and version.
- **Cookie banner** only if non-essential cookies/analytics are used (Vercel Analytics is cookieless; if only essential cookies → no banner, but cookie policy page still present).

## 8. Data layer
- `src/lib/api/` typed clients per contract (02); `fetchJson` with timeout (15 s), JWT header, error normalisation to `{code, message}`, retry on 503 with `retryAfterMs`.
- `@tanstack/react-query` for caching; query keys by resource; invalidate on mutations; SSE client for copilot using `fetch` + `ReadableStream` (EventSource cannot send Authorization headers).
- **Mocks**: `src/lib/mocks/*` with fixtures (copy B's `server/test/fixtures/v2`), toggled by `NEXT_PUBLIC_USE_MOCKS=1`, so UI work never waits for backend.
- Feature flags from `GET /api/v2/meta/flags` merged with `NEXT_PUBLIC_FEATURE_*`.

## 9. Cold starts & resilience UX (Render free tier)
Global "service health" store polling `GET /api/v2/meta/health` when a request fails with 503/timeouts. Show a non-blocking top banner: "Waking up Satya's servers (free hosting sleeps when idle) — about 30–60 seconds" with progress dots; automatically retry queued requests; on the login page, pre-warm services by calling health endpoints on page load (this is user-triggered, not a keep-alive pinger). Copilot shows evidence-only banner when gateway reports degraded.

## 10. Accessibility, performance, quality
- WCAG 2.2 AA: focus visible, skip link, labels, contrast, keyboard everything (graph has list alternative), `aria-live` for async status, reduced motion.
- Performance budgets: public pages LCP < 2.5 s on 4G, JS < 180 kB gz for landing; app route JS < 250 kB gz (dynamic import Cytoscape, react-pdf, recharts only where used).
- Internationalisation-ready strings (English now; Hindi later): keep UI copy in `src/content/copy/*.ts`.
- Tests: unit (formatters: money/qty/Indian words display, vocabulary mapping), component tests for CertaintyBadge/Money, Playwright e2e: login → Today → open flagship investigation → verify the 3 balances and duplicate hold → open graph → click edge → ask copilot "How much do we really owe on PO-1001?" → answer contains ₹20,000.00 with citation → create PO via wizard → approve as another user → issue → download PDF (assert file) → upload sample invoice → review → save → investigation updates. Keep the existing two browser tests passing until replaced.
