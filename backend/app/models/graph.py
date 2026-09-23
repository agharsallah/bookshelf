"""CONNECTION layer: concepts and polymorphic typed edges (§6, §11, D9)."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, text_array, timestamptz, utcnow
from app.models.enums import ConceptKind, EdgeStatus, EntityKind, Origin, Relation


class Concept(SQLModel, table=True):
    __tablename__ = "concepts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    canonical: str
    aliases: list[str] = Field(default_factory=list, sa_column=text_array())
    kind: ConceptKind = Field(sa_type=enum_type(ConceptKind))
    blurb: str | None = None
    blurb_cites: list[str] = Field(default_factory=list, sa_column=text_array())
    merged_into: uuid.UUID | None = Field(
        default=None, foreign_key="concepts.id", ondelete="SET NULL"
    )
    origin: Origin = Field(default=Origin.SKILL, sa_type=enum_type(Origin))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class Edge(SQLModel, table=True):
    """`*_id` is a uuid string, or `<document_id>#<anchor>` when the kind is `node`."""

    __tablename__ = "edges"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    src_kind: EntityKind = Field(sa_type=enum_type(EntityKind))
    src_id: str
    dst_kind: EntityKind = Field(sa_type=enum_type(EntityKind))
    dst_id: str
    relation: Relation = Field(sa_type=enum_type(Relation))
    weight: float = 1.0
    evidence: list[str] = Field(default_factory=list, sa_column=text_array())
    origin: str  # 'human' | 'skill:link-concepts@2'
    status: EdgeStatus = Field(default=EdgeStatus.ACCEPTED, sa_type=enum_type(EdgeStatus))
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


def node_ref(document_id: uuid.UUID, anchor: str) -> str:
    """Edge endpoint id for a node, stable across re-parses (anchors are, row ids are not)."""
    return f"{document_id}#{anchor}"
