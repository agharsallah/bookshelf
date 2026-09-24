"""Highlights and notes (§9 "Your notes"). `raw` is written once and never rewritten (D11).

A note with words (`raw`) queues `structure_note`, whose `structured_note` artifact is
shown next to the raw text. A plain highlight (`raw` null) queues nothing: no model call.
A highlight may gain its words exactly once (`add_raw`), which then queues structuring;
after that `raw` never changes. A note whose anchor disappears in a re-parse is kept and
reported as `detached` rather than deleted.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, tuple_, update
from sqlmodel import Session, col, select

from app.core.errors import ConflictError, NotFoundError
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, Job, Node, Note
from app.models.enums import ArtifactType, JobKind, NoteColor
from app.services.errors import InvalidInputError
from app.services.jobs import enqueue_or_live
from app.services.sql import anchor_under


@dataclass(frozen=True, slots=True)
class NoteInput:
    document_id: uuid.UUID
    anchor: str
    raw: str | None = None
    range: tuple[int, int] | None = None
    color: NoteColor | None = None


@dataclass(frozen=True, slots=True)
class NoteView:
    """A note with its latest structured version and whether its anchor still exists."""

    note: Note
    structured: Artifact | None
    detached: bool


def structure_job_spec(note: Note) -> JobSpec:
    """The `structure_note` job for one note.

    `input_hash` is the note id so that two notes on the same anchor each get a job:
    the queue dedupes live work on (kind, document, anchor, input_hash).
    """
    return JobSpec(
        kind=JobKind.STRUCTURE_NOTE,
        document_id=note.document_id,
        anchor=note.anchor,
        input_hash=f"note:{note.id}",
        payload={"note_id": str(note.id)},
    )


def create_note(session: Session, data: NoteInput) -> tuple[Note, Job | None]:
    """Validate the anchor and range against the tree, insert, and queue structuring when
    the note has words (a plain highlight gets no job)."""
    if session.get(Document, data.document_id) is None:
        raise NotFoundError(f"Document {data.document_id} does not exist.")
    node = session.exec(
        select(Node).where(Node.document_id == data.document_id, Node.anchor == data.anchor)
    ).first()
    if node is None:
        raise InvalidInputError(f"No node '{data.anchor}' in this document.", field="body.anchor")
    if data.range is not None:
        end = data.range[1]  # 0 <= start < end is checked by the request schema
        length = len(node.text or "")
        if end > length:
            raise InvalidInputError(
                f"range.end ({end}) is past the end of the node's text ({length} chars).",
                field="body.range",
            )
    note = Note(
        document_id=data.document_id,
        anchor=data.anchor,
        raw=data.raw,
        color=data.color,
        range={"start": data.range[0], "end": data.range[1]} if data.range else None,
    )
    session.add(note)
    session.flush()
    job: Job | None = None
    if note.raw is not None:
        job, _ = enqueue_or_live(session, structure_job_spec(note))  # commits note + job
    else:
        session.commit()
    session.refresh(note)
    return note, job


def add_raw(session: Session, note: Note, raw: str) -> tuple[Note, Job]:
    """Give a plain highlight its words, once (D11), and queue structuring."""
    conflict = ConflictError(
        "`raw` is immutable (D11): this note already has its words. "
        "Delete it and create a new one instead.",
        details=[{"field": "body.raw"}],
    )
    if note.raw is not None:
        raise conflict
    # Conditional, so a concurrent request that gave the words first wins cleanly: `note`
    # may have been read before that write, and the D11 trigger would reject this one.
    written = session.execute(
        update(Note)
        .where(col(Note.id) == note.id, col(Note.raw).is_(None))
        .values(raw=raw)
        .returning(col(Note.id))
    ).first()
    if written is None:
        session.rollback()
        raise conflict
    session.refresh(note)
    job, _ = enqueue_or_live(session, structure_job_spec(note))  # commits raw + job together
    session.refresh(note)
    return note, job


def get_note(session: Session, note_id: uuid.UUID) -> Note:
    note = session.get(Note, note_id)
    if note is None:
        raise NotFoundError(f"Note {note_id} does not exist.")
    return note


def list_notes(
    session: Session,
    *,
    document_id: uuid.UUID | None,
    anchor: str | None,
    limit: int,
    offset: int,
) -> tuple[list[NoteView], int]:
    """Notes in creation order. `anchor` matches that node and everything beneath it."""
    query = select(Note)
    if document_id is not None:
        query = query.where(Note.document_id == document_id)
    if anchor is not None:
        query = query.where(anchor_under(col(Note.anchor), anchor))
    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    notes = session.exec(
        query.order_by(col(Note.created_at), col(Note.id)).offset(offset).limit(limit)
    ).all()
    return _views(session, notes), int(total)


def _views(session: Session, notes: Sequence[Note]) -> list[NoteView]:
    if not notes:
        return []
    ids = [n.id for n in notes]
    latest = session.exec(
        select(Artifact)
        .where(col(Artifact.note_id).in_(ids), Artifact.type == ArtifactType.STRUCTURED_NOTE)
        .distinct(col(Artifact.note_id))
        .order_by(
            col(Artifact.note_id), col(Artifact.version).desc(), col(Artifact.created_at).desc()
        )
    ).all()
    structured = {a.note_id: a for a in latest}
    keys = {(n.document_id, n.anchor) for n in notes}
    attached: set[tuple[Any, Any]] = {
        (doc_id, anchor)
        for doc_id, anchor in session.exec(
            select(Node.document_id, Node.anchor).where(
                tuple_(col(Node.document_id), col(Node.anchor)).in_(list(keys))
            )
        )
    }
    return [
        NoteView(
            note=n,
            structured=structured.get(n.id),
            detached=(n.document_id, n.anchor) not in attached,
        )
        for n in notes
    ]


def view_note(session: Session, note: Note) -> NoteView:
    return _views(session, [note])[0]


def set_color(session: Session, note: Note, color: NoteColor | None) -> Note:
    """Change the highlight color (`raw` is immutable once written, D11)."""
    note.color = color
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


def delete_note(session: Session, note: Note) -> None:
    """Delete a note; its structured versions cascade with it."""
    session.delete(note)
    session.commit()
