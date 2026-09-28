"""`paper_structure` job (docs/PAPERS.md §3): roles, paper_meta, bibliography, citations.

Queued by the orchestrator after every parse of a `genre = paper` document; the work is
`papers.structure.run_structure`. GROBID is used only when `BOOKSHELF_GROBID_URL` is set.
"""

import httpx

from app.core.config import get_settings
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document
from app.models.enums import Genre, JobKind, JobState
from app.papers.grobid import TIMEOUT_SECONDS, Grobid
from app.papers.structure import run_structure


@handler(JobKind.PAPER_STRUCTURE)
def run_paper_structure(ctx: JobContext) -> HandlerResult:
    document_id = ctx.job.document_id
    document = ctx.session.get(Document, document_id) if document_id else None
    if document is None:
        raise PermanentJobError(f"paper_structure needs an existing document, got {document_id}.")
    if document.genre is not Genre.PAPER:
        return HandlerResult(state=JobState.SKIPPED, result={"reason": "not a paper"})
    settings = get_settings()
    if not settings.grobid_url:
        return HandlerResult(
            result=run_structure(ctx.session, document, library_dir=settings.library_dir)
        )
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        grobid = Grobid(client, settings.grobid_url)
        report = run_structure(
            ctx.session, document, library_dir=settings.library_dir, grobid=grobid
        )
    return HandlerResult(result=report)
