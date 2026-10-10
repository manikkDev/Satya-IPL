PYTHON ?= .venv/bin/python

.PHONY: up down logs health data partitions validate-data vfl-partitions graph-features baseline fl fl-dp experiments seed test
up:
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs -f
health:
	curl --fail http://localhost:8000/health
	curl --fail http://localhost:5002/api/health
	curl --fail http://localhost:5001/health
data:
	cd ml-fl-service && $(PYTHON) -m data.download --only paysim_banks && $(PYTHON) -m data.features paysim_banks
partitions:
	cd ml-fl-service && $(PYTHON) -m data.partition --dataset paysim_banks --clients 5 --mode hfl --seed 42
validate-data:
	cd ml-fl-service && $(PYTHON) -m data.validate --dataset paysim_banks --clients 5
vfl-partitions:
	cd ml-fl-service && $(PYTHON) -m data.partition --dataset paysim_banks --mode vfl --seed 42
graph-features:
	cd ml-fl-service && $(PYTHON) -m graph.features
baseline:
	cd ml-fl-service && $(PYTHON) -m models.baselines --dataset paysim_banks
fl:
	cd ml-fl-service && $(PYTHON) -m experiments.fl_run --strategy fedprox --rounds 8
fl-dp:
	cd ml-fl-service && $(PYTHON) -m experiments.fl_run --strategy fedprox --rounds 8 --dp-enabled --dp-noise-multiplier 0.45 --dp-clipping-norm 2.0
experiments:
	cd ml-fl-service && $(PYTHON) -m experiments.run_matrix && $(PYTHON) -m experiments.report
seed:
	cd ml-fl-service && $(PYTHON) -m experiments.seed_demo
test:
	cd ml-fl-service && $(PYTHON) -m pytest -q
