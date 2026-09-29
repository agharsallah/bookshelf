"""Collections: a hand-gathered, ordered group of documents of any genre around one topic.

collections         name, slug, description, colour
collection_members  document ↔ collection, with reading position and a note (HUMAN)
"""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._columns import timestamptz, utcnow


class Collection(SQLModel, table=True):
    __tablename__ = "collections"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    slug: str
    name: str
    description: str | None = None
    colour: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class CollectionMember(SQLModel, table=True):
    __tablename__ = "collection_members"

    collection_id: uuid.UUID = Field(
        foreign_key="collections.id", ondelete="CASCADE", primary_key=True
    )
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE", primary_key=True)
    position: int
    note: str | None = None
    added_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
