"""The idempotent per-document sync of `pills` (docs/PILLS.md §4, D1).

`sync_document` computes the pills a document should have (`app.pills.inputs.load` →
`harvest.harvest_document`) and makes the table agree, keyed by `source_key`:

* a new key inserts a row; a known key updates the row in place when anything changed (its
  id stays, so events, saves and sessions keep pointing at it);
* a live row no longer produced is **retired** (`retired_at`), never deleted while it may
  be referenced; a retired row produced again comes back (unretired, updated).

Running it twice changes nothing the second time. Commits.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.models import Document
from app.models.pill import Pill
from app.pills import inputs
from app.pills.harvest import PillDraft, harvest_document

logger = logging.getLogger(__name__)

# Fields a harvest owns; the row's id, created_at and source_key never change.
FIELDS = (
    "anchor",
    "kind",
    "headline",
    "body",
    "cites",
    "concepts",
    "thread_key",
    "thread_index",
    "thread_title",
    "est_seconds",
    "origin",
    "source_artifact_id",
    "draft",
)


@dataclass(slots=True)
class PillSync:
    created: int = 0
    updated: int = 0
    unretired: int = 0
    retired: int = 0
    unchanged: int = 0

    @property
    def changed(self) -> bool:
        return bool(self.created or self.updated or self.unretired or self.retired)

    def as_dict(self) -> dict[str, int]:
        return {
            "created": self.created,
            "updated": self.updated,
            "unretired": self.unretired,
            "retired": self.retired,
            "unchanged": self.unchanged,
        }


def _row(document: Document, pill: PillDraft) -> Pill:
    return Pill(
        document_id=document.id,
        source_key=pill.source_key,
        **{name: getattr(pill, name) for name in FIELDS},
    )


def apply(session: Session, document: Document, drafts: Sequence[PillDraft]) -> PillSync:
    """Make the document's rows match `drafts` (module docstring). Commits."""
    current = {
        p.source_key: p
        for p in session.exec(select(Pill).where(Pill.document_id == document.id)).all()
    }
    synced = PillSync()
    now = datetime.now(UTC)
    wanted = {d.source_key for d in drafts}
    for pill in drafts:
        row = current.get(pill.source_key)
        if row is None:
            session.add(_row(document, pill))
            synced.created += 1
            continue
        differs = [n for n in FIELDS if getattr(row, n) != getattr(pill, n)]
        for name in differs:
            setattr(row, name, getattr(pill, name))
        if row.retired_at is not None:
            row.retired_at = None
            synced.unretired += 1
        elif differs:
            synced.updated += 1
        else:
            synced.unchanged += 1
        session.add(row)
    for key, row in current.items():
        if key not in wanted and row.retired_at is None:
            row.retired_at = now
            session.add(row)
            synced.retired += 1
    session.commit()
    if synced.changed:
        # Nested: `created` is a LogRecord attribute and cannot be passed as an extra.
        logger.info(
            "Pills harvested", extra={"document_id": str(document.id), "pills": synced.as_dict()}
        )
    return synced


def sync_document(session: Session, document: Document) -> PillSync:
    """Harvest `document` and store the result (idempotent; commits)."""
    loaded = inputs.load(session, document)
    return apply(
        session, document, harvest_document(loaded.context, loaded.artifacts, loaded.links)
    )
