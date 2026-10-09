"""`harvest_pills` job (docs/PILLS.md §4): a document's pills recomputed from its preferred
artifacts, the graph and its audio renders, and stored idempotently (`app.pills.store`).

A `pill_set` (make-pills) is harvested here too, like every other source: its threads and
pills are materialized into `pills` with origin `skill:make-pills@<version>`. Pure Python,
zero tokens; a document deleted meanwhile leaves nothing to do.
"""

from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document
from app.models.enums import JobKind, JobState
from app.pills.store import sync_document


@handler(JobKind.HARVEST_PILLS)
def run_harvest_pills(ctx: JobContext) -> HandlerResult:
    if ctx.job.document_id is None:
        raise PermanentJobError("harvest_pills needs a document")
    document = ctx.session.get(Document, ctx.job.document_id)
    if document is None:
        return HandlerResult(state=JobState.SKIPPED, result={"reason": "document gone"})
    synced = sync_document(ctx.session, document)
    return HandlerResult(result=synced.as_dict())
