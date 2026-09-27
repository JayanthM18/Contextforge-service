# Exact tag, per docs/RULES.md. Every Python dependency is pinned in
# requirements.txt, so two builds of this file produce the same judge wrapper.
FROM python:3.12.11-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Ragas and its dependencies phone home by default. The evaluator only
    # talks to the judge it was given.
    RAGAS_DO_NOT_TRACK=true \
    HF_HUB_DISABLE_TELEMETRY=1

WORKDIR /evaluator
COPY requirements.txt ./
RUN pip install --no-deps -r requirements.txt && pip check

COPY app ./app

# Tests run inside the same image the tool uses, so a passing suite means the
# pinned environment works, not just the developer's laptop.
FROM base AS test
COPY requirements-dev.txt pyproject.toml ./
RUN pip install pytest==8.4.2
COPY tests ./tests
COPY fixtures ./fixtures
CMD ["python", "-m", "pytest", "-q"]

FROM base AS runtime
RUN useradd --create-home --uid 10001 evaluator
USER evaluator
WORKDIR /work
ENV PYTHONPATH=/evaluator
ENTRYPOINT ["python", "-m", "app"]
