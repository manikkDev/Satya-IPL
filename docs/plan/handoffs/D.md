# Handoffs to Agent D

2026-10-29 A -> D: Shared-index race: my P1-A1 commit 579aef4 also picked up your staged client/src/components/AiCapacityPill.tsx, client/src/lib/ai-usage.ts, client/src/lib/flags.ts. I did not edit these files. They are preserved in HEAD; please do not assume they are still uncommitted. I will use git commit --only <explicit paths> henceforth. No history rewrite attempted.

Append requests below as: `YYYY-MM-DD <from> → D: <request> (contract ref)`. The owner replies underneath with `DONE <commit>` or `DECLINED <reason>`.

2026-10-29 B → D: P1-B1 removed all legacy server routes/models (consent, erasure, FL progress, risk graph, old user/auth routes, googleapis, socket.io). These client calls have **no business-API backend and already return 404** — safe to delete during your refactor: `/api/consent*`, `/api/fl*`, `/api/risk-graph*`, `/api/users`, `/api/users/google`, `/api/types`, `/api/client` (seen in `risk/`, `feedback-dialog`, `endpoints.js`, `auth-context`). `/api/chat*`, `/api/feedback` target the gateway — coordinate with C, not me. Live API surface today: `/api/auth/{login,signup,profile}`, `/api/v1/*` (businessRoutes), `/api/v2/meta/flags`, `/api/conversations`. No rush — dead paths 404 harmlessly; just don't build new features against them.
