# Bookshelf API

FastAPI backend for Bookshelf: ingest books and articles, parse them into an anchored
tree, distil them through Claude Code skills, review the results, search them, and walk
the idea graph. Design: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (§18 lists
where the build deviates from it).

## Quick start

```bash
../scripts/pg-local.sh start        # Postgres on 127.0.0.1:54329 (.pgdata/, trust auth)
uv sync                             # create .venv and install deps
cp .env.example .env                # adjust as needed
uv run python -m app.db.migrate     # apply ../supabase/migrations/*.sql locally
uv run fastapi dev app/main.py      # API on http://127.0.0.1:8000, with its own job worker
```

The API runs a pipeline worker on a background thread (`app/jobs/background.py`), so
starting it is enough for queued jobs to run. On shutdown or a `fastapi dev` reload it
hands unfinished jobs back to the queue and kills their `claude` runs, so the next
process restarts them at once. Set `BOOKSHELF_API_WORKER=false` to run workers only as
separate processes (`python -m app.jobs.worker`); any number can share the queue. Every
worker keeps a row in `workers` fresh, and `GET /jobs/queue` (and the `queue` event of
`/jobs/stream`) reports the live ones and any job kind with queued work that no worker
runs — the UI shows that as "no worker is running" instead of an endless "queued".

- Swagger UI: http://127.0.0.1:8000/docs · ReDoc: `/redoc` · schema: `/openapi.json`
- Liveness `GET /health` · readiness `GET /health/ready` (database; Qdrant reported
  separately — `degraded` without it, never down)

## Commands

```bash
uv run pytest                        # whole suite (~15 s, needs pg-local running)
uv run pytest --cov                  # with coverage
uv run ruff check . --fix            # lint
uv run ruff format .                 # format
uv run mypy app                      # strict type check
uv run python -m app.db.migrate      # apply pending migrations to BOOKSHELF_DATABASE_URL

uv run python -m app.jobs.worker                  # poll forever (Ctrl-C stops after running jobs)
uv run python -m app.jobs.worker --once           # drain what is runnable now, then exit
uv run python -m app.jobs.worker --kinds parse,summarize --exclude-kinds brief
uv run python -m app.pipeline.interactive import ../skills/.outbox/*.json   # import interactive results

uv run fastapi run app/main.py --port 8000        # production server
```

## Pipeline in one screen

One state machine per document (§7). Each step is a row in the `jobs` table — the queue
itself (`FOR UPDATE SKIP LOCKED`, no Redis) — keyed so re-running unchanged work is free:

```
POST /documents {path|url} → parse ─┬─ describe_figure · explain_code · describe_math · explain_table
                                    └─ summarize (per chapter)
   (element jobs done) → distil_section per section (+ chapter intro) → distil_chapter
   (every chapter distilled) → brief → human approves the brief → embed → link_concepts
   (concepts created) → dedup (link_concepts, mode=dedup) → proposed same_as merges
```

- **Parse** (Python): PDF tier ladder (outline → font headings → OCR), HTML via
  trafilatura, Markdown. A guessed outline lands in `needs_review`: fix it with
  `PATCH /documents/{ref}/outline` or accept it with `POST /documents/{ref}/outline/confirm`.
- **Skills** (model): every skill-backed job selects its inputs, hashes them, skips if a
  live artifact covers the hash, else renders `skills/<name>/SKILL.md` and runs
  `claude -p` (tier → `haiku`/`sonnet`/`opus`, `app/pipeline/models.py`; override per
  tier with `BOOKSHELF_MODEL_<TIER>`, and set its thinking effort with
  `BOOKSHELF_EFFORT_<TIER>` = `low`…`max`, default `medium`). Outputs pass
  hard gates (schema, anchors; one retry) and soft gates (grounding, compression, …) and
  land as `draft` or `needs_review` artifacts for the review queue.
- **Run ceiling**: after `max_runs_per_document` CLI runs a document is `paused`
  (`documents.meta.paused`); `POST /documents/{ref}/resume` lifts it.
- **Orchestrator** (`app/pipeline/orchestrator.py`): three lookup tables decide what
  follows a finished job or a review; status only moves forward.

## Model runtime: the Claude Code CLI

There is no Anthropic API key in the backend. Model calls go through `ModelRunner`, whose
implementation shells out to `claude -p` (`BOOKSHELF_CLAUDE_BIN`, default `claude`) with
no tools, no session persistence and no project settings. Install Claude Code and log in
once (`claude` → `/login`); the worker then uses your subscription. Concurrency is capped
by `BOOKSHELF_WORKER_CONCURRENCY` (2).

Interactive mode: open Claude Code in the repo and run a skill by name
(`/distil-chapter <slug> ch03`). The skill fetches `GET /skills/{name}/inputs` (the exact
batch inputs and `input_hash`), works with you, writes `skills/.outbox/*.json` and imports
it via `POST /artifacts/import` — same gates, `run_mode = interactive`. See
[`../skills/README.md`](../skills/README.md).

## Postgres

Postgres only (JSONB, arrays, FTS, `SKIP LOCKED`). The schema lives in
`../supabase/migrations/` as plain SQL, applied:

- locally (and per test run, into a throwaway database) by `uv run python -m app.db.migrate`;
- on Supabase through the Supabase MCP `apply_migration` or `supabase db push`. Point the
  backend at it with the **session pooler** URL:
  `BOOKSHELF_DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.

## Qdrant

- `BOOKSHELF_QDRANT_URL` unset → embedded on-disk store in `../.qdrant/`. It locks its
  directory to one process, so **the API owns it**: the API lifespan runs `embed` jobs on
  one background thread and the worker skips them (it logs why; `--kinds embed` forces).
- `BOOKSHELF_QDRANT_URL=https://<cluster>:6333` (+ `BOOKSHELF_QDRANT_API_KEY`) → a server
  or Qdrant Cloud; the worker embeds and the in-API runner stays off.
- Collections are created on first use. Search before anything is indexed returns no
  groups with `index_state: "empty"`, and with Qdrant unreachable `"unavailable"`;
  addressed and lexical searches never need Qdrant. The first real embed downloads the
  FastEmbed models (~160 MB).

## Layout

```
app/
├── main.py              app factory, middleware, lifespan (embed runner, shutdown signals)
├── core/                settings, OpenAPI docs, errors, logging, middleware, auth, lifecycle
├── db/                  engine/session, migration runner
├── models/              SQLModel tables (database shape)
├── schemas/             Pydantic wire models (incl. the shared outline override shape)
├── services/            documents, notes, ingest (+ SSRF-guarded fetch), library, media, jobs
├── api/                 deps (session, settings, pagination), router, routes/ per resource
├── jobs/                queue (jobs table), registry, worker CLI, in-API embed runner
├── pipeline/            orchestrator, execution, selectors, gates, runner, skills, ceiling,
│   ├── parse/           PDF / HTML / Markdown parsers, anchors, override, tree upsert
│   └── handlers/        parse, skills (generic), embed, export
├── retrieval/           Qdrant client/collections, embedders, indexing, router, hybrid and
│                        lexical search, relations, cited answers, suggest
└── graph/               concept links → graph, dedup, merge, neighborhoods, curation, views
tests/                   pytest; real Postgres, in-memory Qdrant, fake embedder and runner
```

## Configuration

Every setting is an environment variable prefixed `BOOKSHELF_`, read from `.env` (and
`../frontend/.env`). See `.env.example`. The ones that matter most:

| Variable | Default | |
|---|---|---|
| `BOOKSHELF_DATABASE_URL` | `postgresql+psycopg://bookshelf@127.0.0.1:54329/bookshelf` | pg-local; Supabase session pooler in production |
| `BOOKSHELF_API_KEY` | unset | required for writes when set; mandatory in production |
| `BOOKSHELF_QDRANT_URL` / `_API_KEY` | unset | unset = embedded store in `.qdrant/` |
| `BOOKSHELF_API_EMBED_RUNNER` | `true` | API runs embed jobs when Qdrant is embedded |
| `BOOKSHELF_CLAUDE_BIN` | `claude` | the CLI the runner calls |
| `BOOKSHELF_CLAUDE_TIMEOUT_SECONDS` | `900` | per CLI run |
| `BOOKSHELF_WORKER_CONCURRENCY` | `2` | parallel jobs / CLI processes |
| `BOOKSHELF_MAX_RUNS_PER_DOCUMENT` | `400` | run ceiling |
| `BOOKSHELF_LIBRARY_DIR` / `_MEDIA_DIR` / `_EXPORTS_DIR` / `_SKILLS_DIR` | repo folders | originals, crops, exports, skills |
| `BOOKSHELF_CORS_ORIGINS` / `_ALLOWED_HOSTS` | `http://localhost:4321` / `*` | explicit in production |

Generate an API key: `python -c "import secrets; print(secrets.token_urlsafe(32))"`.

## Guardrails

| Guardrail | Where | Behaviour |
|---|---|---|
| API-key auth on writes | `core/security.py` | `X-API-Key` for POST/PATCH/DELETE; constant-time compare |
| Fail-fast config | `core/config.py` | production refuses to boot without a key or with wildcard hosts/origins |
| Rate limiting | `core/ratelimit.py` | fixed window per key or IP; `429` + `Retry-After` (in-process) |
| Body size cap | `core/middleware.py` | `413` above `MAX_REQUEST_BYTES` |
| SSRF guard | `services/fetch.py` | URL ingest refuses hosts resolving to internal addresses, on every redirect hop |
| Uniform errors | `core/errors.py` | one envelope with `request_id` (also on unhandled 500s); no tracebacks on the wire |
| Request correlation | `core/middleware.py` | `X-Request-ID` generated or validated, echoed, on every log line |
| Idempotency | `artifacts_idempotency_idx` | one live artifact per `(type, input_hash, skill_version)` |
| D11 | trigger on `notes` | your words (`raw`) are never rewritten; a highlight may gain them once |

## Error format

```json
{"error": {"code": "not_found", "message": "Document 42 does not exist.", "details": [],
           "request_id": "8f14e45fceea167a5a36dedd4bea2543"}}
```

Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`payload_too_large`, `validation_error`, `gate_rejected`, `upstream_error`,
`rate_limited`, `internal_error`.

## Docker

```bash
docker build -t bookshelf-api .
docker run --rm -p 8000:8000 --env-file .env bookshelf-api
```

## Reference

FastAPI documentation used here: `../llm-docs/fastapi/llm.txt`, `../llm-docs/fastapi/DOCS_MAP.md`.
