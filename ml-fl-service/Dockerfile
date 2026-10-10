FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY requirements-business.txt ./
RUN python -m pip install --no-cache-dir -r requirements-business.txt
COPY app.py business_contracts.py business_demo.py business_reconcile.py business_matching.py business_training.py ./
COPY tests ./tests
RUN mkdir -p /app/runs && useradd --create-home --uid 10001 satya && chown -R satya:satya /app
USER satya
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
