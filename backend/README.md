# Bookshelf API

FastAPI backend for Bookshelf: track reads, learnings, briefs, distillations, and search.

## Quick start

```bash
cd backend
uv sync                       # create .venv and install deps
cp .env.example .env          # adjust as needed
uv run fastapi dev app/main.py
```

- Swagger UI: http://127.0.0.1:8000/docs
- ReDoc: http://127.0.0.1:8000/redoc
- OpenAPI schema: http://127.0.0.1:8000/openapi.json
- Liveness: `GET /health` · Readiness: `GET /health/ready`

Everyday commands:

```bash
uv run pytest                 # tests
uv run pytest --cov           # tests with coverage
uv run ruff check . --fix     # lint
uv run ruff format .          # format
uv run mypy app               # strict type check
uv run fastapi run app/main.py --port 8000   # production server
```

## Layout

```
app/
├── main.py              app factory, middleware stack, lifespan
├── core/
│   ├── config.py        Settings (pydantic-settings, BOOKSHELF_* env vars)
│   ├── docs.py          OpenAPI description and tag metadata
│   ├── errors.py        domain errors + global exception handlers
│   ├── logging.py       JSON logging with request-id context
│   ├── middleware.py    request id, access log, body cap, security headers
│   ├── ratelimit.py     fixed-window rate limiter
│   └── security.py      X-API-Key dependency
├── db/session.py        engine, session dependency, table creation
├── models/              SQLModel tables (database shape)
├── schemas/             Pydantic request/response models (wire shape)
├── services/            business logic, no framework types in the signatures
└── api/
    ├── deps.py          session + bounded pagination dependencies
    ├── router.py        versioned router aggregation
    └── routes/          one module per resource
tests/                   pytest + TestClient
```

Models and schemas are kept apart on purpose: a column added to a table is not
automatically published to clients, and a client can never set `id` or timestamps.

## Guardrails

| Guardrail | Where | Behaviour |
|---|---|---|
| API-key auth on writes | `core/security.py` | `X-API-Key` required for POST/PATCH/DELETE; constant-time compare; mandatory in production |
| Fail-fast config | `core/config.py` | Production refuses to boot without an API key or with wildcard hosts/origins |
| Rate limiting | `core/ratelimit.py` | Fixed window per API key or client IP; `429` with `Retry-After`; health probes exempt |
| Body size cap | `core/middleware.py` | `413` above `MAX_REQUEST_BYTES`, checked on both declared and streamed length |
| CORS allowlist | `main.py` | Explicit origins, methods, and headers. No credentialed wildcard |
| Host allowlist | `main.py` | `TrustedHostMiddleware` blocks Host-header spoofing |
| Security headers | `core/middleware.py` | `nosniff`, `DENY`, `no-referrer`, COOP, and a `default-src 'none'` CSP |
| Uniform errors | `core/errors.py` | One envelope for every failure; tracebacks logged, never returned |
| Request correlation | `core/middleware.py` | `X-Request-ID` generated or validated, echoed back, attached to every log line |
| Input validation | `schemas/` | `extra="forbid"`, length/range bounds, cross-field date checks |
| Pagination ceiling | `api/deps.py` | `limit` capped at 100; `offset` bounded |
| Conditional docs | `main.py` | `/docs`, `/redoc`, `/openapi.json` off in production unless explicitly enabled |
| Structured logs | `core/logging.py` | JSON access log with method, path, status, duration, request id |

Rate limiting is in-process. Running more than one worker or replica means each one
keeps its own counter; move `_InMemoryCounter` to Redis before scaling out.

## Configuration

Every setting is an environment variable prefixed `BOOKSHELF_`, readable from `.env`.
See `.env.example` for the full list and defaults.

Generate an API key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## Error format

```json
{
  "error": {
    "code": "not_found",
    "message": "Book 42 does not exist.",
    "details": [],
    "request_id": "8f14e45fceea167a5a36dedd4bea2543"
  }
}
```

Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`payload_too_large`, `validation_error`, `rate_limited`, `internal_error`.

## Database

SQLite by default; any SQLAlchemy URL works (`BOOKSHELF_DATABASE_URL`). Tables are
created at startup by `init_db()`. Once the schema starts changing under real data,
replace that call with Alembic migrations.

## Docker

```bash
docker build -t bookshelf-api .
docker run --rm -p 8000:8000 --env-file .env bookshelf-api
```

## Reference

Local FastAPI documentation lives in `../docs/fastapi/` (see `DOCS_MAP.md`).
