FROM python:3.11.16-slim-bookworm

ARG TORCH_VERSION=2.7.1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --index-url https://download.pytorch.org/whl/cpu "torch==${TORCH_VERSION}+cpu"

COPY requirements.txt requirements.lock ./
RUN python -m pip install -r requirements.lock

COPY pyproject.toml .
COPY arth_fl ./arth_fl
RUN python -m pip install --no-deps -e .

COPY app.py settings.py ./
COPY data ./data
COPY models ./models
COPY explain ./explain
COPY graph ./graph
COPY vertical ./vertical
COPY experiments ./experiments
COPY jobs ./jobs

RUN mkdir -p /app/data/raw /app/data/processed /app/data/partitions /app/runs \
    && useradd --create-home --uid 10001 arth \
    && chown -R arth:arth /app

USER arth

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
