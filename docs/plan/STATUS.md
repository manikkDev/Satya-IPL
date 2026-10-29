# Status log

Append one line per milestone: `YYYY-MM-DD <agent>: <task id> <what> (commit <sha>), tests <n>/<n>`.

2026-10-29 human: plan v2 created; rollback tag v0.9-pitch-baseline pushed.

2026-10-29 A: P1-A1 done (commit 579aef4): import graph app -> api -> compat_v1 -> business_{contracts,demo,imports,matching,reconcile}; training -> matching; no legacy FL imports. User explicitly approved removal after build/tests. Preserved v1 module identity and all five demo cases; production image imports without pytest/torch. Owner tests 42/42 (29 pre-existing unchanged), 1.11 s, container 2 GiB / 2 CPUs, OMP/BLAS/MKL=2. Net source reduction >3,000 lines. No new runtime dependency. Dev-only pytest/hypothesis/httpx. .env.example already had no FL variables. NOTE shared Git index race: commit also included D's staged client/src/{components/AiCapacityPill.tsx,lib/ai-usage.ts,lib/flags.ts}; A did not edit them and has notified D. Future commits use --only with explicit owned paths.

2026-10-29 B: P0-B0 done — lib/flags.js + GET /api/v2/meta/flags (off in prod, on in dev); docker-compose resource limits (engine 2g/2, server+gateway 768m/1, client 1.5g/2, mongo 1g, neo4j 1.5g + 512m heap/256m pagecache). tests 15/15 green (business.test.mjs).
**QUESTION FOR HUMAN (auto-deploys): Render + Vercel deploy on every push to main. For the 30 Oct pitch: (a) pause auto-deploys until after the pitch, or (b) accept every push deploys live (all v2 work is behind FEATURE_V2_* flags, default off in prod)? Please reply in STATUS.**

2026-10-29 D: P0 done — flag-guarded AI capacity pill (GET /api/v2/ai/usage, 60s poll + SSE push hook, hidden when flag off or endpoint absent) mounted under chat composer; sourced stats strip on landing (₹7.34 lakh crore MSME delays — GAME–FISME–C2FO; 0.8–2% duplicate/erroneous disbursements — APQC via CFO.com; ~16% GVA manufacturing — MoSPI). Lint/tests/build green.
