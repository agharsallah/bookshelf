"""The pills migration: vocabularies mirror their enums, and the tables hold their rules."""

import re
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models.enums import PillEventKind, PillKind, ReviewSource, Surface
from app.models.pill import PillEvent

MIRRORS: list[tuple[str, str, set[str]]] = [
    ("pills", "pills_kind_check", {k.value for k in PillKind if k.is_stored}),
    ("pill_events", "pill_events_kind_check", {k.value for k in PillEventKind}),
    ("review_items", "review_items_source_check", {s.value for s in ReviewSource}),
    ("activity_minutes", "activity_minutes_surface_check", {s.value for s in Surface}),
]


@pytest.mark.parametrize(("table", "name", "values"), MIRRORS, ids=[m[1] for m in MIRRORS])
def test_each_check_constraint_mirrors_its_enum(
    session: Session, table: str, name: str, values: set[str]
):
    definition = session.execute(
        text(
            "select pg_get_constraintdef(oid) from pg_constraint "
            "where conrelid = cast(:t as regclass) and conname = :n"
        ),
        {"t": table, "n": name},
    ).scalar_one()

    assert set(re.findall(r"'([a-z_]+)'::text", definition)) == values


def test_new_vocabulary_members_exist():
    assert "pill" in {s.value for s in ReviewSource}
    assert "pills" in {s.value for s in Surface}


def test_an_event_must_point_at_a_pill_or_a_review_item(session: Session):
    session.add(PillEvent(id=uuid.uuid4(), kind=PillEventKind.SEEN, at=datetime.now(UTC)))

    with pytest.raises(IntegrityError):
        session.commit()
