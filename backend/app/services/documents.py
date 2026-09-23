"""Document queries and edits: lookup by id or slug, filtered listing with aggregate
pipeline stats (a fixed number of grouped queries per page, never one per row),
metadata edits, deletion, and the outline override."""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import case, func, null
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.core.errors import NotFoundError
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, Job, Node, Note
from app.models.enums import DocumentStatus, JobKind, JobState, NodeKind, Review
from app.services.errors import InvalidInputError
from app.services.jobs import enqueue_or_live
from app.services.sql import contains_pattern

CONTAINER_KINDS = [k for k in NodeKind if k.is_container]
LEAF_KINDS = [k for k in NodeKind if not k.is_container]


def get_document(session: Session, ref: str) -> Document:
    """Look a document up by uuid or by slug."""
    document: Document | None
    try:
        document = session.get(Document, uuid.UUID(ref))
    except ValueError:
        document = session.exec(select(Document).where(Document.slug == ref)).first()
    if document is None:
        raise NotFoundError(f"Document {ref} does not exist.")
    return document


@dataclass(frozen=True, slots=True)
class DocumentFilters:
    tag: str | None = None
    status: DocumentStatus | None = None
    author: str | None = None
    q: str | None = None


def _filtered[Q: SelectOfScalar[Any]](query: Q, filters: DocumentFilters) -> Q:
    if filters.tag:
        query = query.where(col(Document.tags).contains([filters.tag]))
    if filters.status:
        query = query.where(Document.status == filters.status)
    if filters.author:
        authors = func.array_to_string(col(Document.authors), " ")
        query = query.where(authors.ilike(contains_pattern(filters.author), escape="\\"))
    if filters.q:
        query = query.where(col(Document.title).ilike(contains_pattern(filters.q), escape="\\"))
    return query


def list_documents(
    session: Session, filters: DocumentFilters, *, limit: int, offset: int
) -> tuple[list[Document], int]:
    """One page of documents, newest first, and the total match count."""
    total = session.exec(_filtered(select(func.count()).select_from(Document), filters)).one()
    page = _filtered(select(Document), filters).order_by(
        col(Document.created_at).desc(), col(Document.id)
    )
    return list(session.exec(page.offset(offset).limit(limit))), int(total)


@dataclass(slots=True)
class DocumentStats:
    chapters: int = 0
    blocks: int = 0
    figures: int = 0
    notes: int = 0
    artifacts: dict[str, int] = field(default_factory=dict)
    latest_job: Job | None = None


def document_stats(session: Session, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, DocumentStats]:
    """Node, note, artifact and latest-job stats for many documents in four queries."""
    stats = {doc_id: DocumentStats() for doc_id in ids}
    if not ids:
        return stats

    def count_where(condition: Any) -> Any:
        return func.count(case((condition, 1)))

    node_rows = session.exec(
        select(
            Node.document_id,
            count_where(Node.kind == NodeKind.CHAPTER),
            count_where(col(Node.kind).in_(LEAF_KINDS)),
            count_where(Node.kind == NodeKind.FIGURE),
        )
        .where(col(Node.document_id).in_(ids))
        .group_by(col(Node.document_id))
    )
    for doc_id, chapters, blocks, figures in node_rows:
        stats[doc_id].chapters, stats[doc_id].blocks, stats[doc_id].figures = (
            chapters,
            blocks,
            figures,
        )

    note_rows = session.exec(
        select(Note.document_id, func.count())
        .where(col(Note.document_id).in_(ids))
        .group_by(col(Note.document_id))
    )
    for doc_id, notes in note_rows:
        stats[doc_id].notes = notes

    artifact_rows = session.exec(
        select(Artifact.document_id, Artifact.review, func.count())
        .where(col(Artifact.document_id).in_(ids))
        .group_by(col(Artifact.document_id), col(Artifact.review))
    )
    for doc_id, review, count in artifact_rows:
        stats[doc_id].artifacts[Review(review).value] = count

    latest = session.exec(
        select(Job)
        .where(col(Job.document_id).in_(ids))
        .distinct(col(Job.document_id))
        .order_by(col(Job.document_id), col(Job.created_at).desc())
    )
    for job in latest:
        assert job.document_id is not None  # noqa: S101 - filtered above
        stats[job.document_id].latest_job = job
    return stats


def job_summary(session: Session, document_id: uuid.UUID) -> dict[JobKind, dict[JobState, int]]:
    rows = session.exec(
        select(Job.kind, Job.state, func.count())
        .where(Job.document_id == document_id)
        .group_by(col(Job.kind), col(Job.state))
    )
    summary: dict[JobKind, dict[JobState, int]] = defaultdict(dict)
    for kind, state, count in rows:
        summary[JobKind(kind)][JobState(state)] = count
    return dict(summary)


_EDITABLE = frozenset({"title", "authors", "year", "tags", "language"})


def update_document(session: Session, document: Document, changes: dict[str, Any]) -> Document:
    """Apply metadata edits. Only title, authors, year, tags and language are editable."""
    unknown = set(changes) - _EDITABLE
    if unknown:
        raise InvalidInputError(f"Not editable: {', '.join(sorted(unknown))}.")
    if "tags" in changes:
        changes["tags"] = list(dict.fromkeys(changes["tags"]))  # dedupe, keep order
    for name, value in changes.items():
        setattr(document, name, value)
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def delete_document(session: Session, document: Document) -> None:
    """Delete the row; nodes, notes, artifacts and jobs cascade. The file is never touched."""
    session.delete(document)
    session.commit()


def set_outline(
    session: Session, document: Document, chapters: list[dict[str, Any]]
) -> tuple[Job, bool]:
    """Store (or, with `[]`, clear) the outline override and queue a forced re-parse.

    Page ranges are validated against `page_count` when it is known. Returns the parse
    job and whether an already-live parse job was reused.
    """
    if document.page_count is not None:
        for chapter in chapters:
            if chapter["page_to"] > document.page_count:
                raise InvalidInputError(
                    f"'{chapter['title']}' ends on page {chapter['page_to']}, "
                    f"but the document has {document.page_count} pages.",
                    field="body.chapters",
                )
    # `null()`: SQL NULL, not a JSON `null` value, so "no override" reads the same in SQL.
    document.outline_override = chapters or null()  # type: ignore[assignment]
    session.add(document)
    session.flush()
    return enqueue_or_live(
        session, JobSpec(kind=JobKind.PARSE, document_id=document.id, payload={"force": True})
    )


def resume(
    session: Session, document: Document, *, max_runs: int | None, default: int
) -> list[Job]:
    """Lift a run-ceiling pause (§14) and requeue what it stopped."""
    from app.pipeline import ceiling  # the pipeline imports services; keep this one-way
    from app.pipeline.execution import SKILL_JOB_KINDS

    return ceiling.resume(session, document, SKILL_JOB_KINDS, default=default, max_runs=max_runs)
