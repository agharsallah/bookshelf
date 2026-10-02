"""SOURCE and STRUCTURE layers: documents and their node tree (§6)."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel, col

from app.models._columns import enum_type, jsonb, text_array, timestamptz, utcnow
from app.models.enums import DocumentKind, DocumentStatus, Genre, NodeKind


class Document(SQLModel, table=True):
    __tablename__ = "documents"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    kind: DocumentKind = Field(sa_type=enum_type(DocumentKind))  # the file format
    genre: Genre = Field(default=Genre.BOOK, sa_type=enum_type(Genre))  # what the text is (P1)
    slug: str
    title: str
    authors: list[str] = Field(default_factory=list, sa_column=text_array())
    year: int | None = None
    source_uri: str | None = None
    source_path: str | None = None
    sha256: str
    page_count: int | None = None
    language: str = "en"
    status: DocumentStatus = Field(
        default=DocumentStatus.REGISTERED, sa_type=enum_type(DocumentStatus)
    )
    parse_tier: int | None = None
    outline_override: list[dict[str, Any]] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    tags: list[str] = Field(default_factory=list, sa_column=text_array())
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    archived_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    # HUMAN: read through, whatever the chapter positions say (`app.services.reading`).
    finished_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))


def not_archived() -> Any:
    """`where` clause: the document is not archived (`app.services.archive`)."""
    return col(Document.archived_at).is_(None)


class Node(SQLModel, table=True):
    """One node of the document tree. Containers carry `heading`; leaves carry `text`.

    `anchor` is the stable address every citation, note, and edge points at (D4).
    """

    __tablename__ = "nodes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    parent_id: uuid.UUID | None = Field(default=None, foreign_key="nodes.id", ondelete="CASCADE")
    anchor: str
    kind: NodeKind = Field(sa_type=enum_type(NodeKind))
    ordinal: int
    depth: int
    heading: str | None = None
    text: str | None = None
    content_hash: str | None = None
    page_from: int | None = None
    page_to: int | None = None
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
