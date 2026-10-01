"""Archive and restore: put a document away without losing anything, and bring it back.

An archived document (`documents.archived_at` set) keeps every row: its tree, notes,
artifacts, reading, recall and review history. It leaves the library listing, search
(its points are purged from Qdrant and lexical search skips it) and the review queue,
and its work is held: queued jobs are skipped with `HELD` and the worker claims nothing
new for it. Restoring clears the mark, requeues what was held and, when the document
had been indexed, queues an `embed` to put it back into search. The idea graph is left
as it is: withdrawing it would drop human curation that a restore could not bring back.
"""

from sqlalchemy import func, text
from sqlmodel import Session, col, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job
from app.models._columns import utcnow
from app.models.enums import JobKind, JobState
from app.services.documents import purge_job
from app.services.jobs import enqueue_or_live

HELD = "held: document archived"
REQUEUED_AS = "requeued_as"  # `jobs.result` key: the job a held one became on restore


def archive(session: Session, document: Document) -> Document:
    """Archive the document (a no-op when it already is). Commits."""
    if document.archived_at is not None:
        return document
    document.archived_at = utcnow()
    session.add(document)
    session.execute(
        text(
            """
            update jobs set state = 'skipped', error = :error, finished_at = now(),
                            locked_at = null
            where document_id = :id and state = 'queued'
            """
        ),
        {"id": document.id, "error": HELD},
    )
    enqueue_or_live(session, purge_job(document.id))  # commits the archive with the purge
    session.refresh(document)
    return document


def restore(session: Session, document: Document) -> list[Job]:
    """Put the document back on the shelf and resume its held work. Returns the jobs it
    queued (none when it was not archived). Commits."""
    if document.archived_at is None:
        return []
    document.archived_at = None
    session.add(document)
    session.commit()
    requeued_before = func.coalesce(col(Job.result).op("?")(REQUEUED_AS), False)
    held = session.exec(
        select(Job)
        .where(
            Job.document_id == document.id,
            Job.state == JobState.SKIPPED,
            Job.error == HELD,
            ~requeued_before,
        )
        .order_by(col(Job.created_at))
    ).all()
    queued: list[Job] = []
    for job in held:
        again = queue.enqueue(session, queue.retry_spec(job))  # None: identical work queued
        job.result = {**(job.result or {}), REQUEUED_AS: str(again.id) if again else None}
        session.add(job)
        session.commit()
        if again is not None:
            queued.append(again)
    if _was_indexed(session, document):
        embed, deduplicated = enqueue_or_live(
            session, JobSpec(kind=JobKind.EMBED, document_id=document.id)
        )
        if not deduplicated and embed not in queued:
            queued.append(embed)
    return queued


def _was_indexed(session: Session, document: Document) -> bool:
    return (
        session.exec(
            select(Job.id).where(
                Job.document_id == document.id,
                Job.kind == JobKind.EMBED,
                Job.state == JobState.DONE,
            )
        ).first()
        is not None
    )
