# Bookshelf

Track your reads, learnings, briefs and distillations — and search them. Drop a PDF, an EPUB or
an article into `library/`, and Bookshelf parses it into an anchored tree, distils it
bottom-up with Claude Code skills (section notes → chapter distillations → a one-page
brief), puts every result through a human review queue, indexes what you approved for
cited search, and links concepts across books into an idea graph.

Design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · backend: [`backend/README.md`](backend/README.md)
· skills: [`skills/README.md`](skills/README.md).

## Quickstart

Prerequisites: Python ≥ 3.12 with [uv](https://docs.astral.sh/uv/), Node with
[pnpm](https://pnpm.io/), a local PostgreSQL install (server binaries), and
[Claude Code](https://docs.claude.com/en/docs/claude-code) logged in (`claude` →
`/login`). There is no Anthropic API key anywhere: every model call is `claude -p`.

```bash
# 1. Database: an isolated Postgres in .pgdata/ on port 54329 (no password)
scripts/pg-local.sh start

# 2. Backend
cd backend
uv sync
cp .env.example .env
uv run python -m app.db.migrate        # apply supabase/migrations/*.sql
uv run fastapi dev app/main.py         # http://127.0.0.1:8000/docs — also runs the job worker

# 2b. Or, with BOOKSHELF_DATABASE_URL on Supabase: the API plus a Podman Postgres as
#     "This computer" in Settings → Database (port 54330). The container starts with the
#     server and stops when it exits (PG_KEEP=1 keeps it). By hand: scripts/pg-podman.sh
#     start | stop | status | logs | reset.
scripts/dev-backend.sh

# 3. Optional: a standalone worker (another terminal), e.g. with BOOKSHELF_API_WORKER=false.
#    It shares the queue with the API's own worker; `GET /jobs/queue` lists live workers.
cd backend && uv run python -m app.jobs.worker

# 4. Frontend (another terminal)
cd frontend
pnpm install
pnpm dev                               # http://localhost:4321
# or the production build: pnpm build && pnpm serve   (same port, reads frontend/.env)
```

## Adding books

Put files in `library/` (PDF, EPUB, `.html`, `.md`; originals are never modified). The library
page lists files not yet ingested; ingesting one (or `POST /api/v1/documents
{"path": "library/x.pdf"}`, or `{"url": "https://…"}` for a web article) queues its parse.
A PDF without an embedded outline lands in *needs review*: fix the chapters in the outline
editor, or confirm the guess as is. Figure and formula crops go to `.media/`, exports to
`exports/`, the embedded vector store to `.qdrant/` — all derived and rebuildable.

## Interactive skills

Batch mode is the worker running `claude -p` per job. Interactive mode is you in a Claude
Code session in this repo: run a skill by name, e.g. `/distil-chapter meadows-systems
ch03`. The skill fetches the exact inputs the batch runner would use
(`GET /api/v1/skills/{name}/inputs`), works through them with you, writes the result to
`skills/.outbox/` and imports it (`POST /api/v1/artifacts/import`) through the same quality
gates. Set `BOOKSHELF_API` (default `http://127.0.0.1:8000/api/v1`) and `BOOKSHELF_API_KEY`
in the shell if your API needs a key. Details in [`skills/README.md`](skills/README.md).

## Pointing at Supabase

1. Apply the migrations in `supabase/migrations/` to the project — with the Supabase MCP
   (`apply_migration`) or the CLI (`supabase link` then `supabase db push`). They are plain
   Postgres, guarded to run unchanged on both.
2. Set the **session pooler** connection string (Project → Connect → Session pooler) in
   `backend/.env`:
   `BOOKSHELF_DATABASE_URL=postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`

The Data API is locked down (RLS on, no grants to `anon`/`authenticated`); only the backend
reads and writes.

## Pointing at a Postgres server (a VM, say)

Any Postgres 15+ works in place of Supabase; the migrations are plain SQL.

1. On the server, make a role and a database the app owns, and let the backend reach it:

   ```bash
   sudo -u postgres psql -c "create role bookshelf login password '<password>'"
   sudo -u postgres psql -c "create database bookshelf owner bookshelf"
   # postgresql.conf: listen_addresses = '*'   (or the VM's private address)
   # pg_hba.conf:     hostssl bookshelf bookshelf <your-ip>/32 scram-sha-256
   sudo systemctl restart postgresql
   ```

   Keep port 5432 closed to the internet except for your address. Better still, reach the
   server over a VPN or an SSH tunnel (`ssh -L 5433:127.0.0.1:5432 <vm>`, then `127.0.0.1:5433`).
2. Set libpq's variables in `backend/.env`. When `PGHOST` is set they take the place of
   `BOOKSHELF_DATABASE_URL`. Add `PGSSLMODE=require` when the server has TLS on:

   ```bash
   PGHOST=<vm-host>
   PGPORT=5432
   PGDATABASE=bookshelf
   PGUSER=bookshelf
   PGPASSWORD=<password>
   ```
3. Apply the migrations: `cd backend && uv run python -m app.db.migrate`. Settings → Database
   also applies any that are pending before a switch, a sync or a snapshot. Unlike on
   Supabase, the app owns this schema. `app.db.migrate` tells the two apart by the
   `supabase_admin` role, so it never touches a Supabase database.

To start from what you already have, use Settings → Database (sync "This computer" up to it)
or restore a snapshot.

## Pointing at a Qdrant cluster

Without configuration Qdrant runs embedded in `.qdrant/`, owned by the API process (which
then also runs the embed jobs). For a server — `docker run -p 6333:6333 qdrant/qdrant` or
Qdrant Cloud — set in `backend/.env`:

```bash
BOOKSHELF_QDRANT_URL=https://<cluster>.cloud.qdrant.io:6333
BOOKSHELF_QDRANT_API_KEY=<key>
```

and the worker takes over embedding. Collections are created on first use; the index is
derived data, so `POST /api/v1/jobs {"kind": "embed"}` rebuilds it from Postgres.

## Tests

```bash
cd backend && uv run pytest        # needs scripts/pg-local.sh running
cd frontend && pnpm test
```
