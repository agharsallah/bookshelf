"""Attention reports: minutes add up and cap at 60 s, unknown books are dropped, bad
clocks are refused; the reader statistics read them back."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from tests.api.factories import make_book, make_note
from tests.conftest import AUTH

NOW = datetime.now(UTC).replace(second=0, microsecond=0)


def entry(**overrides: object) -> dict[str, object]:
    return {"at": NOW.isoformat(), "surface": "read", "seconds": 30} | overrides


def report(client: TestClient, *entries: dict[str, object]):
    return client.post("/api/v1/activity", json={"entries": list(entries)}, headers=AUTH)


def rows(session: Session) -> list[tuple[object, ...]]:
    return [
        tuple(r)
        for r in session.execute(
            text("select surface, unit, anchor, detail, seconds from activity_minutes order by 1")
        ).all()
    ]


def test_reports_in_one_minute_add_up_and_cap_at_a_minute(client: TestClient, session: Session):
    book = make_book(session)
    where = {"document": book.slug, "unit": "ch01", "anchor": "ch01/s01/p001"}

    first = report(
        client, entry(**where), entry(**where, at=(NOW + timedelta(seconds=20)).isoformat())
    )
    report(client, entry(**where, seconds=45))

    assert first.status_code == 200
    assert first.json() == {"recorded": 1}
    assert rows(session) == [("read", "ch01", "ch01/s01/p001", "", 60)]


def test_places_and_surfaces_keep_their_own_rows(client: TestClient, session: Session):
    book = make_book(session)

    report(
        client,
        entry(document=str(book.id), unit="ch01", anchor="ch01/s01/p001"),
        entry(document=book.slug, unit="ch01", anchor="ch01/s01/p002", seconds=10),
        entry(surface="explore", detail="search", seconds=5),
    )

    assert rows(session) == [
        ("explore", "", "", "search", 5),
        ("read", "ch01", "ch01/s01/p001", "", 30),
        ("read", "ch01", "ch01/s01/p002", "", 10),
    ]


def test_a_report_on_a_deleted_book_is_dropped(client: TestClient, session: Session):
    response = report(client, entry(document="no-such-book"))

    assert response.json() == {"recorded": 0}
    assert rows(session) == []


def test_a_report_from_a_bad_clock_is_refused(client: TestClient, session: Session):
    old = report(client, entry(at=(NOW - timedelta(days=8)).isoformat()))
    future = report(client, entry(at=(NOW + timedelta(hours=1)).isoformat()))
    too_long = report(client, entry(seconds=61))

    assert [r.status_code for r in (old, future, too_long)] == [422, 422, 422]
    assert rows(session) == []


def test_reporting_needs_the_api_key(client: TestClient):
    assert client.post("/api/v1/activity", json={"entries": [entry()]}).status_code == 401


def test_reader_stats_read_the_tracked_time_back(client: TestClient, session: Session):
    book = make_book(session)
    make_note(session, book, "ch01/s01/p001")
    at = NOW - timedelta(minutes=5)
    report(
        client,
        entry(
            at=at.isoformat(), document=book.slug, unit="ch01", anchor="ch01/s01/p001", seconds=50
        ),
        entry(at=NOW.isoformat(), surface="listen", document=book.slug, unit="ch01", seconds=40),
    )

    library = client.get("/api/v1/reader-stats", params={"tz": "Europe/Berlin"}).json()
    one = client.get(f"/api/v1/documents/{book.slug}/reader-stats").json()

    assert library["totals"]["seconds"] == 90
    assert library["totals"]["reading_seconds"] == 50
    assert library["totals"]["notes"] == 1
    assert library["totals"]["sessions"] == 1
    assert library["passages"][0]["anchor"] == "ch01/s01/p001"
    assert library["passages"][0]["notes"] == 1
    assert [b["slug"] for b in library["books"]] == [book.slug]
    assert one["book"]["total_seconds"] == 90
    assert one["book"]["seconds"] == {"read": 50, "listen": 40}
    assert [c["anchor"] for c in one["chapters"]] == ["ch01"]


def test_reader_stats_refuse_an_unknown_time_zone(client: TestClient):
    response = client.get("/api/v1/reader-stats", params={"tz": "Mars/Olympus"})

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "query.tz"
