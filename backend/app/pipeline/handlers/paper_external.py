"""Paper jobs that talk to the outside world (docs/PAPERS.md §5, P7): OpenAlex enrichment,
reading candidates, the watch list, and adding a candidate to the shelf.

    paper_enrich      document_id   → app.papers.enrich
    paper_candidates  (global)      → app.papers.candidates + candidate_store (→ recommend_next)
    paper_watch       payload.force → app.papers.watch (→ paper_candidates)
    paper_fetch       payload.candidate_id → app.papers.add

HTTP goes through `app.papers.http.http_client()` (tests install a MockTransport). Rate
limits and outages are retried by the worker; bad input fails permanently.
"""

import uuid
from collections.abc import Callable
from typing import Any

from app.core.config import get_settings
from app.core.errors import ConflictError
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document
from app.models.enums import JobKind
from app.papers import add, candidate_store, candidates, enrich, watch
from app.papers.fetch_pdf import NotAPdfError, PdfTooLargeError
from app.papers.http import http_client, openalex
from app.papers.openalex import (
    OpenAlexError,
    OpenAlexRateLimitedError,
    OpenAlexUnavailableError,
)
from app.papers.shelf import latest_ratings, load_shelf, watched
from app.retrieval.embedding import Embedder, get_embedder
from app.services.errors import InvalidInputError


def _permanent_on_bad_input[T](work: Callable[[], T]) -> T:
    """Refusals a retry cannot change become `PermanentJobError`; rate limits and outages
    propagate, so the worker retries them."""
    try:
        return work()
    except (OpenAlexUnavailableError, OpenAlexRateLimitedError):
        raise
    except (OpenAlexError, NotAPdfError, PdfTooLargeError, InvalidInputError, ConflictError) as exc:
        raise PermanentJobError(str(exc)) from exc


@handler(JobKind.PAPER_ENRICH)
def run_paper_enrich(ctx: JobContext) -> HandlerResult:
    """Match the paper on OpenAlex; fill paper_meta and its references."""
    document = ctx.session.get(Document, ctx.job.document_id) if ctx.job.document_id else None
    if document is None:
        raise PermanentJobError(f"paper_enrich needs a document, got {ctx.job.document_id}.")
    with http_client() as client:
        api = openalex(client)
        outcome = _permanent_on_bad_input(lambda: enrich.enrich(ctx.session, document, api))
    return HandlerResult(result=outcome.as_result())


def _embedder_if_useful(ctx: JobContext) -> Embedder | None:
    """Only load the embedding model when a >= 4-star paper has an abstract to compare."""
    shelf = load_shelf(ctx.session)
    liked = [shelf.by_id(d) for d in watched(latest_ratings(ctx.session))]
    return get_embedder() if any(p is not None and p.abstract for p in liked) else None


@handler(JobKind.PAPER_CANDIDATES)
def run_paper_candidates(ctx: JobContext) -> HandlerResult:
    """Rebuild and rescore the reading queue; hand the top N to recommend_next."""
    embedder = _embedder_if_useful(ctx)
    with http_client() as client:
        api = openalex(client)
        rebuild = _permanent_on_bad_input(lambda: candidates.build(ctx.session, api, embedder))
    saved = candidate_store.save(ctx.session, rebuild)
    job = candidate_store.queue_recommend_next(ctx.session, saved.top)
    result: dict[str, Any] = {
        "scored": len(rebuild.scored),
        "created": saved.created,
        "updated": saved.updated,
        "removed": saved.removed,
        "top": [str(i) for i in saved.top],
        "recommend_next_job": str(job.id) if job else None,
    }
    return HandlerResult(result=result)


@handler(JobKind.PAPER_WATCH)
def run_paper_watch(ctx: JobContext) -> HandlerResult:
    """New works citing your >= 4-star papers since each one's last check."""
    force = bool((ctx.job.payload or {}).get("force"))
    with http_client() as client:
        api = openalex(client)
        outcome = _permanent_on_bad_input(lambda: watch.run_watch(ctx.session, api, force=force))
    return HandlerResult(result=outcome.as_result())


@handler(JobKind.PAPER_FETCH)
def run_paper_fetch(ctx: JobContext) -> HandlerResult:
    """Download a candidate's open-access PDF and ingest it as a paper."""
    raw = (ctx.job.payload or {}).get("candidate_id")
    try:
        candidate_id = uuid.UUID(str(raw))
    except ValueError:
        raise PermanentJobError(f"paper_fetch needs payload.candidate_id, got {raw!r}.") from None
    library_dir = get_settings().library_dir
    with http_client() as client:
        added = _permanent_on_bad_input(
            lambda: add.add_to_shelf(ctx.session, candidate_id, client, library_dir)
        )
    return HandlerResult(
        result={
            "document_id": str(added.document_id),
            "source_path": added.source_path,
            "already_on_shelf": added.already_on_shelf,
        }
    )
