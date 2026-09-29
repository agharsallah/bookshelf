"""Wire models of `/collections`: hand-gathered groups of documents of any genre."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.document import DocumentSummary

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
Colour = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,31}$")]
MemberNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
MAX_MEMBERS = 500


class CollectionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    description: Description | None = None
    colour: Annotated[Colour | None, Field(description="A frontend dye name.")] = None
    document_ids: Annotated[
        list[uuid.UUID],
        Field(max_length=MAX_MEMBERS, description="Initial members, in reading order."),
    ] = []


class CollectionUpdate(BaseModel):
    """Only the fields sent change; `null` clears `description` or `colour`. The slug stays,
    so links to the collection survive a rename."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    description: Description | None = None
    colour: Colour | None = None


class CollectionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: str | None
    colour: str | None
    document_ids: Annotated[list[uuid.UUID], Field(description="Members in reading order.")]
    created_at: datetime
    updated_at: datetime


class MemberPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: Annotated[
        MemberNote | None, Field(description="Why this document is in the collection.")
    ] = None


class CollectionMemberPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: uuid.UUID
    position: int
    note: str | None
    added_at: datetime


class CollectionMemberDetail(CollectionMemberPublic):
    document: DocumentSummary


class CollectionDetail(CollectionPublic):
    members: Annotated[
        list[CollectionMemberDetail], Field(description="Library rows in reading order.")
    ]


class CollectionOrder(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_ids: Annotated[
        list[uuid.UUID],
        Field(max_length=MAX_MEMBERS, description="Every current member, in the new order."),
    ]
