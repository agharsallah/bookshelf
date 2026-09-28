"""`parse` job (stage 1): the document's file → `nodes` tree, status → parsed/needs_review.

The handler only parses and stores; the worker's orchestrator enqueues the next stage
after it returns. Input problems (missing file, unsupported or unreadable file, invalid
outline override) are permanent: the document goes to `parse_failed` and the job fails
without retrying. Anything else is re-raised so the worker retries it.
"""

import re
from pathlib import Path

from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document, Node
from app.models.enums import DocumentStatus, JobKind, JobState
from app.papers.detect import apply_guess, paper_mode
from app.papers.outline import paper_strategy
from app.pipeline.parse import (
    PDF_SUFFIXES,
    ParsedDocument,
    ParseError,
    load_override,
    parse_file,
    store_tree,
)
from app.services.library import resolve_source_path
from app.services.media import prune_document_media

MAX_REPORTED_WARNINGS = 50
_NON_SLUG = re.compile(r"[^a-z0-9]+")


def _slugish(value: str) -> str:
    return _NON_SLUG.sub("-", value.casefold()).strip("-")


def _is_placeholder_title(document: Document) -> bool:
    """Ingest names a document after its file until the parser knows better."""
    stem = Path(document.source_path or "").stem
    return _slugish(document.title) in {document.slug, _slugish(stem)}


def _fill_metadata(document: Document, parsed: ParsedDocument) -> None:
    """Fill title / authors / year from the file, never overwriting what a person set."""
    if parsed.title and _is_placeholder_title(document):
        document.title = parsed.title[:500]
    if parsed.authors and not document.authors:
        document.authors = parsed.authors
    if parsed.year is not None and document.year is None and -3000 <= parsed.year <= 3000:
        document.year = parsed.year


def _image_paths(session: Session, document: Document) -> list[str]:
    """Media paths the document's nodes reference after the re-parse."""
    metas = session.exec(select(Node.meta).where(Node.document_id == document.id)).all()
    return [m["image_path"] for m in metas if isinstance(m.get("image_path"), str)]


def _mark_failed(session: Session, document: Document) -> None:
    session.rollback()
    document.status = DocumentStatus.PARSE_FAILED
    session.add(document)
    session.commit()


@handler(JobKind.PARSE)
def run_parse(ctx: JobContext) -> HandlerResult:
    session, job = ctx.session, ctx.job
    document = session.get(Document, job.document_id) if job.document_id else None
    if document is None:
        raise PermanentJobError("parse job has no existing document")

    document.status = DocumentStatus.PARSING
    session.add(document)
    session.commit()

    settings = get_settings()
    override = document.outline_override
    try:
        path = resolve_source_path(settings.library_dir, document.source_path)
        parsed = parse_file(
            path,
            slug=document.slug,
            media_dir=settings.media_dir,
            outline_override=load_override(override),
            strategy=paper_strategy(paper_mode(document)),  # papers read their own headings
        )
    except (ParseError, ValueError) as exc:
        _mark_failed(session, document)
        raise PermanentJobError(f"parse failed: {exc}") from exc
    except Exception:
        _mark_failed(session, document)  # an unexpected parser crash: let the worker retry
        raise

    session.refresh(document, ["outline_override"])
    if document.outline_override != override:  # a human changed the outline meanwhile
        return HandlerResult(
            state=JobState.SKIPPED,
            result={"reason": "outline changed during the parse; the newer parse job applies it"},
        )

    try:
        count = store_tree(session, document, parsed)
        _fill_metadata(document, parsed)
        judged = path.suffix.lower() in PDF_SUFFIXES and override is None
        apply_guess(document, parsed, from_tree=not judged)  # docs/PAPERS.md §3 "Genre"
        document.page_count = parsed.page_count
        document.parse_tier = parsed.tier
        document.status = (
            DocumentStatus.NEEDS_REVIEW if parsed.needs_review else DocumentStatus.PARSED
        )
        session.add(document)
        session.commit()
    except Exception:
        _mark_failed(session, document)
        raise

    referenced = _image_paths(session, document)
    pruned = prune_document_media(settings.media_dir, document.slug, referenced)
    return HandlerResult(
        result={
            "nodes": count,
            "pruned_media": len(pruned),
            "tier": parsed.tier,
            "needs_review": parsed.needs_review,
            "warnings": parsed.warnings[:MAX_REPORTED_WARNINGS],
            "genre": document.genre.value,
        }
    )
