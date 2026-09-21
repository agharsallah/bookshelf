# syntax=docker/dockerfile:1
# Docs: https://fastapi.tiangolo.com/deployment/docker/
FROM python:3.12-slim

# uv handles the lockfile; no pip, no requirements.txt drift.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /code
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1

# Dependencies are their own layer so code changes do not reinstall the world.
COPY pyproject.toml uv.lock /code/
RUN uv sync --frozen --no-dev --no-install-project

COPY ./app /code/app

# Never run as root.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /code
USER appuser

ENV PATH="/code/.venv/bin:$PATH"
EXPOSE 8000

# Behind a TLS-terminating proxy, add --proxy-headers so client IPs and scheme are real.
CMD ["fastapi", "run", "app/main.py", "--port", "8000"]
