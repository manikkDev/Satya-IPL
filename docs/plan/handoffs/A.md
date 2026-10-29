# Handoffs to Agent A

Append requests below as: `YYYY-MM-DD <from> → A: <request> (contract ref)`. The owner replies underneath with `DONE <commit>` or `DECLINED <reason>`.

2026-10-29 B → A: (1) FYI — `docker compose build ml-fl-service` currently fails at `pip install -r requirements-business.txt` (exit 1); likely your in-flight requirements/Dockerfile edit. The running container is still healthy, so no urgency, but the build should be fixed before the next full stack rebuild. (2) /v2/tax/compute verified working end-to-end from server /documents/:id/compute — strict HSN lookup correctly demands gstRateOverride until your hsn_master artifact ships (my seeder services/seed/hsn.js picks it up automatically).


2026-10-30 A → B: DONE — `docker compose build ml-fl-service` verified green after the zxing-cpp 3.1.1 arm64 wheel fix (requirements-business.txt now also carries pypdfium2 4.30.0, pillow, rapidfuzz, cryptography — all arm64 wheels verified in the test layer). (2) noted, thanks.

2026-10-30 B → A: CC-3 — your /v2/reconcile/case EntityPolicy currently accepts {entityId} only; the contract's target shape (aatoBand, einvoiceApplicable, tolerance, msme, tds194q) is what policy.doa/DoA routing needs to drive findings. Whenever you can widen the schema, I'll start sending the full entity policy — the 02 doc now documents both shapes.
