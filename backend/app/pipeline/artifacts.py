"""Artifact persistence: append-only versions, idempotent inserts, review transitions.

Rows are never rewritten. A re-run or a human edit inserts a new `version` for the same
`(document, anchor, type)`; only `review` / `reviewed_at` change in place. The database
guards both invariants: unique versions per scope, and at most one live (non-rejected) row
per `(type, input_hash, skill_version)` — "never pay twice".
"""

import uuid
from collections.abc import Callable, Collection, Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models import Artifact, Node
from app.models.enums import ArtifactType, Origin, Review
from app.pipeline.bodies import cited_anchors
from app.pipeline.hashing import body_hash

_INSERT_ATTEMPTS = 3
ELEMENT_TYPES = frozenset(
    {
        ArtifactType.FIGURE_DESCRIPTION,
        ArtifactType.CODE_EXPLANATION,
        ArtifactType.MATH_DESCRIPTION,
        ArtifactType.TABLE_EXPLANATION,
    }
)


class ArtifactExistsError(Exception):
    """A live artifact already covers this exact input (idempotency)."""

    def __init__(self, existing: Artifact) -> None:
        super().__init__(f"Artifact {existing.id} already covers this input")
        self.existing = existing


def _now() -> datetime:
    return datetime.now(UTC)


def citations_of(body: dict[str, Any]) -> list[str]:
    return sorted(cited_anchors(body))


def document_anchors(session: Session, document_id: uuid.UUID) -> set[str]:
    return set(session.exec(select(Node.anchor).where(Node.document_id == document_id)))


def next_version(
    session: Session, document_id: uuid.UUID, anchor: str | None, kind: ArtifactType
) -> int:
    current = session.exec(
        select(func.max(Artifact.version)).where(
            Artifact.document_id == document_id,
            col(Artifact.anchor).is_(None) if anchor is None else Artifact.anchor == anchor,
            Artifact.type == kind,
        )
    ).one()
    return int(current or 0) + 1


def find_live(
    session: Session, kind: ArtifactType, input_hash: str, skill_version: str | None
) -> Artifact | None:
    """The non-rejected artifact for exactly this input, if one exists."""
    return session.exec(
        select(Artifact).where(
            Artifact.type == kind,
            Artifact.input_hash == input_hash,
            Artifact.skill_version == skill_version,
            Artifact.review != Review.REJECTED,
        )
    ).first()


def insert(session: Session, artifact: Artifact, *, supersede: bool = False) -> Artifact:
    """Insert with the next free version and commit.

    `supersede=True` (a forced re-run) rejects the live row for the same input first, since
    the idempotency index allows only one. Otherwise that row raises `ArtifactExistsError`.
    """
    for _ in range(_INSERT_ATTEMPTS):
        existing = find_live(session, artifact.type, artifact.input_hash, artifact.skill_version)
        if existing is not None and artifact.origin is Origin.SKILL:
            if not supersede:
                raise ArtifactExistsError(existing)
            existing.review, existing.reviewed_at = Review.REJECTED, _now()
            session.add(existing)
        artifact.version = next_version(
            session, artifact.document_id, artifact.anchor, artifact.type
        )
        session.add(artifact)
        try:
            session.commit()
        except IntegrityError:  # a concurrent insert took the version (or the input): re-check
            session.rollback()
            continue
        session.refresh(artifact)
        return artifact
    raise RuntimeError(f"Could not insert {artifact.type} for {artifact.anchor}: contention")


def human_version(
    source: Artifact | None,
    body: dict[str, Any],
    *,
    document_id: uuid.UUID,
    kind: ArtifactType,
    anchor: str | None,
    note_id: uuid.UUID | None = None,
    gates: dict[str, Any] | None = None,
) -> Artifact:
    """A human-authored row (D15): approved on arrival, skill fields empty."""
    return Artifact(
        document_id=document_id,
        anchor=anchor,
        note_id=source.note_id if source is not None else note_id,
        type=kind,
        version=0,  # assigned by `insert`
        origin=Origin.HUMAN,
        input_hash=body_hash(body),
        body=body,
        citations=citations_of(body),
        gates=gates or {},
        review=Review.APPROVED,
        reviewed_at=_now(),
    )


def set_review(session: Session, artifact: Artifact, review: Review) -> Artifact:
    artifact.review, artifact.reviewed_at = review, _now()
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return artifact


def pick_preferred[K](rows: Iterable[Artifact], key: Callable[[Artifact], K]) -> dict[K, Artifact]:
    """Per key, the latest approved row, else the latest one. `rows` in ascending version."""
    chosen: dict[K, Artifact] = {}
    for row in rows:
        current = chosen.get(key(row))
        approved = row.review is Review.APPROVED
        if current is None or approved or current.review is not Review.APPROVED:
            chosen[key(row)] = row
    return chosen


def preferred(
    session: Session, document_id: uuid.UUID, kinds: Collection[ArtifactType]
) -> dict[tuple[ArtifactType, str | None], Artifact]:
    """The artifact downstream stages should read, per `(type, anchor)` scope (§7):
    the latest approved version, else the latest non-rejected one."""
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document_id,
            col(Artifact.type).in_(list(kinds)),
            Artifact.review != Review.REJECTED,
        )
        .order_by(col(Artifact.version))
    ).all()
    return pick_preferred(rows, lambda row: (row.type, row.anchor))


def is_consumable(artifact: Artifact) -> bool:
    """Low-confidence element explanations stay out of distillations until approved (§14)."""
    if artifact.type not in ELEMENT_TYPES or artifact.review is Review.APPROVED:
        return True
    return artifact.body.get("confidence") != "low"
