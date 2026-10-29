.PHONY: up down logs health train test test-python test-api build
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
	curl --fail --output /dev/null http://localhost:3000
train:
	docker compose run --rm --no-deps ml-fl-service python business_training.py
	docker compose restart ml-fl-service
test-python:
	docker compose -f docker-compose.yml -f ml-fl-service/compose.owner.yml run --rm --no-deps ml-fl-service python -m pytest tests -q
test-api:
	cd server && npm test
	cd chatbot-backend && npm test
test: test-python test-api
build:
	cd client && npm run build
