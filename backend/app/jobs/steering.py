"""How the queue picks the next job beyond plain priority: a job a person sent to run now,
kinds that go first, wait or are skipped, books that go first, and kinds that run on a slot
of their own outside the running cap. `app.jobs.queue` builds `claim()` and `positions()`
from the SQL fragments here, so the two always agree on the order.

The settings live in `app_settings.data["queue"]` (`app.services.app_settings`) and are
read in SQL on every claim, so every worker obeys a change at once, with no restart.
"""

from app.core.config import Settings
from app.models.enums import JobKind

# A job a person said to run now: below every pipeline priority (the lowest is 0), so it
# goes first, and the only kind of job a paused queue still starts.
RUN_NOW_PRIORITY = -1
# A queued job of a kind on `skip` is dropped without running, with this error; like a
# cancel it only releases the barriers it held (`app.pipeline.orchestrator`).
TURNED_OFF = "skipped: its kind is turned off in the queue"

# The kind's mode (`first`, `hold`, `skip`, or '' for none) and whether the job's book goes
# first, read from `app_settings.data["queue"]` for a job aliased `j`.
KIND_MODE = (
    "coalesce((select data -> 'queue' -> 'kinds' ->> j.kind::text "
    "from app_settings where id = 1), '')"
)
_FIRST_BOOK = (
    "coalesce(j.document_id::text in (select jsonb_array_elements_text(coalesce("
    "data -> 'queue' -> 'first_documents', '[]'::jsonb)) from app_settings where id = 1), false)"
)
# `claim()`'s order: run-now first, then skips (they cost nothing and release barriers),
# then boosted work (a first kind and a first book add up), then the pipeline's priority.
FIRST_ORDER = (
    f"j.priority <= :run_now desc, ({KIND_MODE} = 'skip') desc, "
    f"(({KIND_MODE} = 'first')::int + ({_FIRST_BOOK})::int) desc, j.priority, j.run_after"
)


def own_slot_kinds(settings: Settings) -> tuple[JobKind, ...]:
    """Kinds the API runs on a single slot of its own (`app.jobs.narration`, the build
    runner, and `app.jobs.embedded` for embedded Qdrant), never in a pipeline worker's
    slots. `max_running` neither counts nor holds them back. With a Qdrant URL the pipeline
    worker embeds, so `embed` takes a capped slot like any other job."""
    embed = (JobKind.EMBED,) if settings.qdrant_url is None else ()
    return (JobKind.NARRATE, JobKind.BUILD_RUN, *embed)
