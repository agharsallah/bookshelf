"""Highlights and notes (§9 "Your notes"). `raw` is written once and never rewritten (D11).

A note with words (`raw`) queues `structure_note`, whose `structured_note` artifact is
shown next to the raw text. A plain highlight (`raw` null) queues nothing: no model call.
A highlight may gain its words exactly once (`add_raw`), which then queues structuring;
after that `raw` never changes. A note whose anchor disappears in a re-parse is kept and
reported as `detached` rather than deleted.

A note may also mark a passage of a chapter's distillation or summary (`artifact_id`):
then `block` is the render block it sits in, `range` is into that block's text, and
`quote` keeps the marked words for when a newer version replaces the artifact.
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
from app.models.enums import ArtifactType, JobKind, NoteColor, NoteTarget
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
    artifact_id: uuid.UUID | None = None
    block: int | None = None
    quote: str | None = None


@dataclass(frozen=True, slots=True)
class NoteView:
    """A note with its latest structured version, whether what it marks still exists, and
    the marked words (null for a whole-block note, or once the passage is gone)."""

    note: Note
    structured: Artifact | None
    detached: bool
    passage: str | None = None


# Artifacts whose passages can carry notes: what the reader's pane shows as one text.
PANE_TARGETS: dict[ArtifactType, NoteTarget] = {
    ArtifactType.CHAPTER_DISTILLATION: NoteTarget.CHAPTER_DISTILLATION,
    ArtifactType.CHAPTER_SUMMARY: NoteTarget.CHAPTER_SUMMARY,
}


def render_block_count(body: dict[str, Any]) -> int:
    """How many render blocks the reader shows for an artifact body: its `blocks`, plus
    the takeaway callout when there is one (frontend `bodyBlocks`)."""
    blocks = body.get("blocks")
    count = sum(isinstance(b, dict) for b in blocks) if isinstance(blocks, list) else 0
    takeaway = body.get("takeaway")
    has_takeaway = (
        isinstance(takeaway, dict)
        and isinstance(takeaway.get("text"), str)
        and isinstance(takeaway.get("cites"), list)
    )
    return count + int(has_takeaway)


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
    target = _check_pane_target(session, data) if data.artifact_id else NoteTarget.SOURCE
    node = session.exec(
        select(Node).where(Node.document_id == data.document_id, Node.anchor == data.anchor)
    ).first()
    if node is None:
        raise InvalidInputError(f"No node '{data.anchor}' in this document.", field="body.anchor")
    if data.range is not None and target is NoteTarget.SOURCE:
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
        target=target,
        artifact_id=data.artifact_id,
        block=data.block,
        quote=data.quote,
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


def _check_pane_target(session: Session, data: NoteInput) -> NoteTarget:
    """A pane note must mark a passage of a distillation/summary of this document, at its
    anchor, inside one of its render blocks; `quote` must be exactly the marked words."""
    artifact = session.get(Artifact, data.artifact_id)
    if artifact is None or artifact.document_id != data.document_id:
        raise InvalidInputError(
            f"No artifact {data.artifact_id} in this document.", field="body.artifact_id"
        )
    target = PANE_TARGETS.get(artifact.type)
    if target is None:
        raise InvalidInputError(
            f"Notes can mark a chapter distillation or summary, not a {artifact.type}.",
            field="body.artifact_id",
        )
    if artifact.anchor != data.anchor:
        raise InvalidInputError(
            f"A note on this {artifact.type} must use its anchor '{artifact.anchor}'.",
            field="body.anchor",
        )
    blocks = render_block_count(artifact.body)
    if data.block is None or data.block >= blocks:
        raise InvalidInputError(
            f"block must be one of the artifact's {blocks} render blocks.", field="body.block"
        )
    if data.range is None or data.quote is None:
        raise InvalidInputError(
            "A note on a pane passage needs `range` and `quote`.", field="body.range"
        )
    if len(data.quote) != data.range[1] - data.range[0]:
        raise InvalidInputError(
            "quote must be exactly the marked words (range.end - range.start characters).",
            field="body.quote",
        )
    return target


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
    texts: dict[tuple[Any, Any], str | None] = {
        (doc_id, anchor): text
        for doc_id, anchor, text in session.exec(
            select(Node.document_id, Node.anchor, Node.text).where(
                tuple_(col(Node.document_id), col(Node.anchor)).in_(list(keys))
            )
        )
    }
    return [_view(n, structured.get(n.id), texts) for n in notes]


def _view(
    note: Note, structured: Artifact | None, texts: dict[tuple[Any, Any], str | None]
) -> NoteView:
    key = (note.document_id, note.anchor)
    if note.target is not NoteTarget.SOURCE:
        detached = key not in texts or note.artifact_id is None
        return NoteView(note=note, structured=structured, detached=detached, passage=note.quote)
    text = texts.get(key)
    span = note.range or {}
    start, end = span.get("start"), span.get("end")
    passage = text[start:end] if text and isinstance(start, int) and isinstance(end, int) else None
    return NoteView(note=note, structured=structured, detached=key not in texts, passage=passage)


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
