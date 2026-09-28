"""Column helpers shared by the table models."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import Column, DateTime, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID


def utcnow() -> datetime:
    return datetime.now(UTC)


def text_array(*, nullable: bool = False) -> Any:
    return Column(ARRAY(Text), nullable=nullable, server_default="{}")


def uuid_array(*, nullable: bool = False) -> Any:
    return Column(ARRAY(UUID(as_uuid=True)), nullable=nullable)


def jsonb(*, nullable: bool = False, server_default: str | None = "{}") -> Any:
    default = f"'{server_default}'::jsonb" if server_default is not None else None
    # `none_as_null`: Python None must be SQL NULL, not the JSON value `null`, or
    # `IS NULL` filters (e.g. jobs.result, documents.outline_override) silently miss rows.
    return Column(JSONB(none_as_null=True), nullable=nullable, server_default=default)


def timestamptz(*, nullable: bool = False) -> Any:
    return Column(DateTime(timezone=True), nullable=nullable)


def enum_type(enum_cls: type[StrEnum]) -> Any:  # instance; sa_type is typed as a class
    """Store a StrEnum by *value* in a text column.

    The schema constrains these columns with `check (... in (...))`, not native Postgres
    enums, so SQLAlchemy must neither create a type nor write member names.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        create_constraint=False,
        length=64,
        values_callable=lambda members: [m.value for m in members],
        validate_strings=True,
    )
