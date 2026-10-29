# Contract change proposals

Format: `## CC-<n> <title>` · proposer · affected endpoint/type · change (additive?) · consumers · status (proposed/agreed/landed <commit>). Agent B edits 02 only after status = agreed.

## CC-1 Engine §6 gap-fill: shared types + semantics
- Proposer: A (handoffs/B.md 2026-10-29) · Editor: B (custodian)
- Affected: §6 all endpoints; new types `DocumentLink`, `EntityPolicy`, `Reviews`, `Scenario`/`ScenarioChange`, `MatchRecord`, `PaymentInput`, `OpenInvoice`, `CreditInput`, `TdsPolicy`, `SupplierRef`, `DeadlinePolicy`, `Deadline`
- Change: define previously-named-only request/response types; clarify date-only vs timestamp semantics; add `policy` input + `utgst` + flag nullability to `/v2/tax/compute`; rename `tds393Applicable` → `tds194qApplicable` (typo, not yet implemented); define placeOfSupply derivation, per-line cess, ROUND_HALF_UP 2dp rounding; `Reviews` = `confirmedDuplicates`/`paymentAllocations`/`acceptedVariances` record shapes
- Additive? yes (renamed flag was undefined/unimplemented)
- Consumers: A (engine), B (server proxies)
- Status: landed f2f37e3

## CC-2 Legacy env/identity cleanup
- Proposer: A (handoffs/B.md) · Editor: B
- Affected: render.yaml, docker-compose*.yml, Makefile — remove `FLOWER_PYTHON`, `PROGRESS_WEBHOOK`; test flow uses `ml-fl-service/compose.owner.yml` (test target)
- Engine `/health` `service` field: `"satya-engine"` when `FEATURE_V2_RECON_V2=1`, legacy identity otherwise (A implements)
- Status: landed f2f37e3
