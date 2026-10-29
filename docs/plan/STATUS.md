# Status log

Append one line per milestone: `YYYY-MM-DD <agent>: <task id> <what> (commit <sha>), tests <n>/<n>`.

2026-10-29 human: plan v2 created; rollback tag v0.9-pitch-baseline pushed.

2026-10-29 B: P0-B0 done — lib/flags.js + GET /api/v2/meta/flags (off in prod, on in dev); docker-compose resource limits (engine 2g/2, server+gateway 768m/1, client 1.5g/2, mongo 1g, neo4j 1.5g + 512m heap/256m pagecache). tests 15/15 green (business.test.mjs).
**QUESTION FOR HUMAN (auto-deploys): Render + Vercel deploy on every push to main. For the 30 Oct pitch: (a) pause auto-deploys until after the pitch, or (b) accept every push deploys live (all v2 work is behind FEATURE_V2_* flags, default off in prod)? Please reply in STATUS.**
