"""Document references on the wire, built from a row or from a `documents` lookup payload."""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlmodel import Session, col, select

from app.models import Document
from app.schemas.search import DocumentRef

SNIPPET_CHARS = 320


def document_ref(document: Document) -> DocumentRef:
    return DocumentRef(
        id=document.id, slug=document.slug, title=document.title, authors=list(document.authors)
    )


def ref_from_payload(payload: dict[str, Any]) -> DocumentRef:
    return DocumentRef(
        id=uuid.UUID(str(payload["document_id"])),
        slug=str(payload["slug"]),
        title=str(payload["title"]),
        authors=[str(a) for a in payload.get("authors") or []],
    )


def load_refs(session: Session, ids: Iterable[uuid.UUID | str]) -> dict[str, DocumentRef]:
    """Refs for `ids` in one query, keyed by the id as a string."""
    wanted = {uuid.UUID(str(i)) for i in ids}
    if not wanted:
        return {}
    rows = session.exec(select(Document).where(col(Document.id).in_(wanted))).all()
    return {str(d.id): document_ref(d) for d in rows}


def snippet(text: str, limit: int = SNIPPET_CHARS) -> str:
    """The first `limit` characters, cut at a word boundary."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return f"{cut}…"
