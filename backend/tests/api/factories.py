"""Small builders that seed documents, nodes, notes and artifacts directly.

Each builder has working defaults and takes keyword overrides, so a test states only
what it is about. Nothing here goes through the parser.
"""

import hashlib
import uuid
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.models import Artifact, Document, Node, Note
from app.models.enums import ArtifactType, DocumentKind, NodeKind, Origin, Review


def make_document(session: Session, **overrides: Any) -> Document:
    token = uuid.uuid4().hex[:8]
    fields: dict[str, Any] = {
        "kind": DocumentKind.PDF,
        "slug": f"doc-{token}",
        "title": f"Document {token}",
        "sha256": hashlib.sha256(token.encode()).hexdigest(),
        "source_path": f"library/{token}.pdf",
    }
    document = Document(**(fields | overrides))
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def make_node(
    session: Session,
    document: Document,
    anchor: str,
    kind: NodeKind,
    *,
    parent: Node | None = None,
    ordinal: int = 0,
    commit: bool = True,
    **overrides: Any,
) -> Node:
    fields: dict[str, Any] = {
        "document_id": document.id,
        "parent_id": parent.id if parent else None,
        "anchor": anchor,
        "kind": kind,
        "ordinal": ordinal,
        "depth": parent.depth + 1 if parent else 0,
    }
    if kind.is_container:
        fields["heading"] = f"Heading {anchor}"
    else:
        fields["text"] = f"Text of {anchor}."
    node = Node(**(fields | overrides))
    session.add(node)
    if commit:
        session.commit()
        session.refresh(node)
    return node


TABLE_META = {
    "table": {"header": ["Stock", "Flow"], "rows": [["Water", "Rain"], ["Money", "Income"]]},
    "caption": "Table 1.1 Stocks and flows",
}


def make_book(session: Session, **overrides: Any) -> Document:
    """A small tree, inserted out of reading order on purpose:

    ch01 · Heading ch01
      s01 · p001, p002
      s02 · t001 (table)
    ch02 · f001 (figure), p001
    """
    document = make_document(session, **overrides)

    def node(anchor: str, kind: NodeKind, **fields: Any) -> Node:
        session.flush()  # parents first: nodes.parent_id references nodes.id
        return make_node(session, document, anchor, kind, commit=False, **fields)

    ch02 = node("ch02", NodeKind.CHAPTER, ordinal=1)
    node("ch02/p001", NodeKind.PARAGRAPH, parent=ch02, ordinal=1)
    node(
        "ch02/f001",
        NodeKind.FIGURE,
        parent=ch02,
        text="A bathtub.",
        meta={"caption": "Figure 2.1 A bathtub", "image_path": "doc/f001.png"},
    )
    ch01 = node("ch01", NodeKind.CHAPTER)
    s02 = node("ch01/s02", NodeKind.SECTION, parent=ch01, ordinal=1)
    node("ch01/s02/t001", NodeKind.TABLE, parent=s02, meta=TABLE_META)
    s01 = node("ch01/s01", NodeKind.SECTION, parent=ch01)
    node("ch01/s01/p002", NodeKind.PARAGRAPH, parent=s01, ordinal=1)
    node("ch01/s01/p001", NodeKind.PARAGRAPH, parent=s01)
    session.commit()
    return document


def make_note(session: Session, document: Document, anchor: str, **overrides: Any) -> Note:
    note = Note(**({"document_id": document.id, "anchor": anchor, "raw": "my words"} | overrides))
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


def make_artifact(
    session: Session,
    document: Document,
    *,
    type: ArtifactType = ArtifactType.CHAPTER_SUMMARY,
    body: dict[str, Any] | None = None,
    **overrides: Any,
) -> Artifact:
    fields: dict[str, Any] = {
        "document_id": document.id,
        "type": type,
        "version": 1,
        "origin": Origin.SKILL,
        "skill": "summarize",
        "skill_version": "1",
        "input_hash": uuid.uuid4().hex,
        "body": body if body is not None else {"blocks": []},
        "review": Review.APPROVED,
    }
    artifact = Artifact(**(fields | overrides))
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return artifact


def write_file(folder: Path, name: str, content: bytes | None = None) -> Path:
    """A file under `folder`; default content is unique, so hashes never collide."""
    path = folder / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content if content is not None else uuid.uuid4().bytes * 8)
    return path
