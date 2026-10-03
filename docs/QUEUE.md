# Steering the pipeline queue

Every piece of pipeline work is a row in the `jobs` table. Workers take queued jobs one at
a time (`claim()` in `backend/app/jobs/queue.py`). This page explains how the next job is
picked and every control that changes it, from the **Pipeline** page or from the API. None
of them needs a restart: workers read the controls on every pick.

## How the next job is picked

Among the queued jobs whose time has come (a retry waits out its backoff), a worker takes
the first in this order:

1. **Run now**: a job a person sent to the front (`POST /jobs/{id}/run-now`), in the order
   they were sent.
2. **Skipped kinds**: jobs of a kind set to `skip`. They are dropped at once, without
   running, so they cost nothing.
3. **Boosted work**: a job scores one point if its kind is set to `first` and one if its
   book is in **Books first**. Two points go before one, one before none.
4. **The pipeline's own priority** (`PRIORITY` in `backend/app/pipeline/orchestrator.py`):
   enrich elements (40), summaries (60), section and chapter distillation (80, 90),
   the brief (100), embedding (110), concept links (120). Lower goes first.
5. **Age**: older first.

A job is never picked while:

- the queue is **paused** (unless it was sent to run now),
- its kind is on **hold** (unless it was sent to run now),
- the **running cap** is full (unless its kind runs on a slot of its own, or is skipped),
- an identical job (same kind, book, section, input) is already running,
- its book is archived.

The place in line each queued row shows follows the same order. Held jobs come after
every runnable one.

## The controls

All of them sit at the top of the Pipeline page and in `PATCH /jobs/queue`. Fields you
leave out keep their value. Every request needs the API key (`X-API-Key`).

Kind modes have two homes that write the same setting. **Settings → Job kinds** lists
every kind, queued or not, so you can turn one off before its work arrives. The Pipeline
page's **Priorities** panel lists only the kinds with queued work. On the Pipeline page, a
queued job whose kind is on hold or skipped is greyed, with a link to that kind in
Settings (`/settings#queue-kind-<kind>`).

| Control | On the page | What it does |
|---|---|---|
| Pause all | **Pause all** / **Resume all** | Starts nothing; running jobs finish. A usage limit pauses it on its own. |
| Running cap | **Run at most N at once** | Caps the jobs running together across all workers. Embedding (with embedded Qdrant), narration and build runs have slots of their own and are not counted. |
| Run now | **Run now** on a queued row | Sends one job to the front. It takes the next free slot under the cap, starts even while paused or on hold, and skips a retry's wait. |
| Kind: first | **Priorities**, the kind’s tile → **First** | Jobs of that kind go before other queued work. |
| Kind: hold | **Priorities**, the kind’s tile → **Hold** | Jobs of that kind wait in the queue, picked by nobody, until you set the kind back to **As usual**. |
| Kind: skip | **Priorities**, the kind’s tile → **Skip** (only on kinds that allow it) | Jobs of that kind are dropped as they come up (state `skipped`, like a cancel), now and for new ones, until you set it back. Only for kinds whose stage moves on without them. |
| Books first | **Priorities → Books first**, or **Put first** on a document row | That book's jobs go before other queued work. |

### Hold or skip?

- **Hold keeps the work.** The jobs stay queued and run when you release the kind. While
  they wait, the stages after them wait too, for those books only. Hold
  `describe_figure` and a book's section notes wait for its figures.
- **Skip drops the work.** Skipped jobs never run, and their stage moves on without them:
  section notes are written without the figure descriptions. To get those descriptions
  later, set the kind back to **As usual** and re-run the affected sections from the
  document page's contents.
- Only the enrich kinds can be skipped: `describe_figure`, `explain_code`,
  `describe_math`, `explain_table` (`skippable_kinds` in `GET /jobs/queue`). Skipping
  anything else would leave its book stuck before the next stage (a book never becomes
  `indexed` without its `embed`), so the API refuses it with `422`. Hold those instead.

## Recipes

The examples use `curl` with `$API` set to the API (by default
`http://127.0.0.1:8000/api/v1`) and `$KEY` set to `BOOKSHELF_API_KEY`. Each line has a matching control on the Pipeline page.

**Finish one book before the rest.** Page: on its row under Documents, **Put first**.

```sh
curl -X PATCH "$API/jobs/queue" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"first_documents": ["<document id>"]}'
```

`first_documents` replaces the list. Send several ids to put several books first, or
`[]` to clear it. A book's id is in `GET /documents`.

**Get search working sooner: embed first.** Page: **Priorities → Embed → First**.

```sh
curl -X PATCH "$API/jobs/queue" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"kinds": {"embed": "first"}}'
```

**Stop spending on figure descriptions for now.** Page: **Priorities → Describe figure → Hold**
to keep them for later, or **Skip** to go without them.

```sh
curl -X PATCH "$API/jobs/queue" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"kinds": {"describe_figure": "hold"}}'      # or "skip"
```

**Back to normal for a kind.** Page: **As usual**. In the API, `null` removes the kind's
mode. `kinds` merges, so other kinds keep theirs.

```sh
curl -X PATCH "$API/jobs/queue" -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"kinds": {"describe_figure": null}}'
```

**Run one held job anyway.** Page: **Run now** on its row. API: `POST /jobs/{id}/run-now`.

**See what is steered.** `GET /jobs/queue` answers `kinds`, `first_documents`,
`skippable_kinds`, and `queued_kinds` (queued jobs per kind, all of them). On the page,
**Priorities** stays closed; each active choice shows beside it as a chip ("Embed first",
"Describe figure skipped"), and its × undoes that one choice.

## Workers that run only some kinds

A worker started by hand can be limited to some kinds for its whole life:

```sh
cd backend
uv run python -m app.jobs.worker --kinds embed,link_concepts   # only these
uv run python -m app.jobs.worker --exclude-kinds describe_figure # never this
```

This suits a dedicated machine. To change the order on a running system, use the
controls above instead: they apply to every worker at once, with no restart.

## Where it lives

- The settings: `app_settings.data["queue"]` (`backend/app/services/app_settings.py`,
  `QueueControls`), as `paused`, `max_running`, `kinds` and `first_documents`.
- The order and its SQL: `backend/app/jobs/steering.py`, used by `claim()` and
  `positions()` in `backend/app/jobs/queue.py`, so the picking order and the place in
  line always agree.
- Skipping: the worker drops a claimed job of a skipped kind with the error `TURNED_OFF`
  (`backend/app/jobs/worker.py`). The orchestrator treats it like a cancel: it only
  releases the barriers it held.
- The pages: `frontend/src/components/pipeline/QueueControls.tsx`, `QueueSteering.tsx`,
  the **Put first** toggle in `DocumentsPanel.tsx`, and Settings → Job kinds
  (`frontend/src/components/settings/QueueKindsSection.tsx`). Both lists use one tile,
  `KindModeTile.tsx`.
