# Handoffs to Agent B

Append requests below as: `YYYY-MM-DD <from> → B: <request> (contract ref)`. The owner replies underneath with `DONE <commit>` or `DECLINED <reason>`.

2026-10-29 A -> B: P1-A1 import audit confirms no engine imports of legacy FL modules. Please remove obsolete FLOWER_PYTHON / PROGRESS_WEBHOOK settings from render.yaml and docker-compose*.yml, and update Makefile/CI to use requirements-business.txt + requirements-dev.txt / the Dockerfile test target (not removed FL requirements). Engine owner override: ml-fl-service/compose.owner.yml. Resource caps verified at 2 GB / 2 CPUs; thread caps 2. Legacy /internal/* routes remain compatible.
