"""Library-card blurbs: one short paragraph per document, from its approved artifacts.

Preference: the latest approved `book_summary`'s first paragraph, else the approved
brief's `thesis` section, else the first chapter's approved `chapter_summary`. One query
for a whole page of documents (never one per card); truncated to `BLURB_CHARS`.
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import and_, func
from sqlmodel import Session, col, select

from app.models import Artifact, Node
from app.models.enums import ArtifactType, Review
from app.pipeline.bodies import plain_text

BLURB_CHARS = 280
PREFERENCE = (ArtifactType.BOOK_SUMMARY, ArtifactType.BOOK_BRIEF, ArtifactType.CHAPTER_SUMMARY)


def first_paragraph(blocks: Any) -> str:
    """Plain text of the first paragraph block (else of the first block with text)."""
    if not isinstance(blocks, list):
        return ""
    dicts = [b for b in blocks if isinstance(b, dict)]
    paragraphs = [b for b in dicts if b.get("type") == "paragraph"]
    for block in paragraphs + dicts:
        text = " ".join(plain_text(block).split())
        if text:
            return text
    return ""


def _text(artifact: Artifact) -> str:
    body = artifact.body
    if artifact.type is ArtifactType.BOOK_BRIEF:
        sections = body.get("sections") or []
        thesis = next((s for s in sections if isinstance(s, dict) and s.get("key") == "thesis"), {})
        return first_paragraph(thesis.get("blocks"))
    return first_paragraph(body.get("blocks"))


def clip(text: str, limit: int = BLURB_CHARS) -> str:
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0] or text[: limit - 1]
    return cut.rstrip(" ,;:.") + "…"


def blurbs(session: Session, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Per document: its blurb, when any approved candidate artifact has text."""
    if not ids:
        return {}
    ordinal = func.coalesce(col(Node.ordinal), -1)
    rows = session.exec(
        select(Artifact)
        .outerjoin(
            Node,
            and_(
                col(Node.document_id) == col(Artifact.document_id),
                col(Node.anchor) == col(Artifact.anchor),
            ),
        )
        .where(
            col(Artifact.document_id).in_(ids),
            col(Artifact.type).in_(list(PREFERENCE)),
            Artifact.review == Review.APPROVED,
        )
        .distinct(col(Artifact.document_id), col(Artifact.type))
        .order_by(
            col(Artifact.document_id), col(Artifact.type), ordinal, col(Artifact.version).desc()
        )
    ).all()
    found: dict[uuid.UUID, dict[ArtifactType, str]] = {}
    for artifact in rows:
        text = _text(artifact)
        if text:
            found.setdefault(artifact.document_id, {})[artifact.type] = text
    return {
        doc_id: clip(next(texts[t] for t in PREFERENCE if t in texts))
        for doc_id, texts in found.items()
    }
