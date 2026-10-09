"""How many pills a feed has left, and where more could come from (docs/PILLS.md §5, §7).

* `unseen`: live pills in the scope's units (by mode; a review feed counts as explore) that
  you have never seen;
* per document: its unseen count, the units `make-pills` could still run on (a chapter
  distillation and no `pill_set`, in reading order, each with a token estimate), and
  `undistilled` when there is no chapter distillation at all (nothing can be made);
* `low`: under `generate.LOW_WATER` unseen.
"""

import dataclasses
import uuid
from collections import Counter

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.models import Node
from app.models.enums import ArtifactType
from app.pills import generate
from app.pills.feed import history
from app.pills.feed.candidates import scope_pills
from app.pills.feed.config import FeedMode
from app.pills.feed.scope import Scope
from app.pills.generatable import anchors_with, open_chapters
from app.pills.serialize import document_ref
from app.schemas.pills import Generatable, Supply, SupplyDocument


def _titles(
    session: Session, open_units: dict[uuid.UUID, list[tuple[str, int]]]
) -> dict[tuple[uuid.UUID, str], str | None]:
    pairs = [(d, a) for d, units in open_units.items() for a, _ in units]
    if not pairs:
        return {}
    rows = session.exec(
        select(Node.document_id, Node.anchor, Node.heading).where(
            tuple_(col(Node.document_id), col(Node.anchor)).in_(pairs)
        )
    ).all()
    return {(d, a): h for d, a, h in rows}


def compute(session: Session, scope: Scope) -> Supply:
    if scope.mode is FeedMode.REVIEW:
        scope = dataclasses.replace(scope, mode=FeedMode.EXPLORE)
    rows = scope_pills(session, scope)
    seen, _ = history.per_pill(session, [r.id for r in rows])
    unseen = Counter(r.document_id for r in rows if not seen[r.id])
    ids = list(scope.documents)
    distilled = anchors_with(session, ids, ArtifactType.CHAPTER_DISTILLATION)
    open_units = open_chapters(session, ids)
    titles = _titles(session, open_units)
    estimate = generate.estimate_tokens(session, generate.SKILL, 1) if open_units else None
    by_document = [
        SupplyDocument(
            document=document_ref(document),
            unseen=unseen[doc_id],
            generatable=[
                Generatable(anchor=a, title=titles.get((doc_id, a)), estimate_tokens=estimate)
                for a, _ in open_units.get(doc_id, [])
            ],
            undistilled=not distilled.get(doc_id),
        )
        for doc_id, document in scope.documents.items()
    ]
    total = sum(unseen.values())
    return Supply(unseen=total, by_document=by_document, low=total < generate.LOW_WATER)
