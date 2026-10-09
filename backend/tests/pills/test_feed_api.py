"""The feed endpoints: sessions, finish, supply, generate and saved feeds."""

import json
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Document, Job, ReviewItem
from app.models.enums import ArtifactType, JobKind, PillKind
from app.pills.contract import PILL_SCHEMA_ID
from app.pipeline.gates import schema_errors
from tests.api.factories import make_artifact
from tests.conftest import AUTH
from tests.pills.conftest import make_shelf_book
from tests.pills.feed_factories import event, make_pill, make_review_item, read

URL = "/api/v1/pills"
EXPLORE = {"mode": "explore", "length": 10}


def start(client: TestClient, body: dict[str, object]) -> dict[str, Any]:
    response = client.post(f"{URL}/sessions", json=body, headers=AUTH)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_session_starts_with_a_page_of_wire_pills(
    client: TestClient, session: Session, book: Document
):
    for i in range(12):
        make_pill(session, book, f"ch0{i % 6 + 1}", PillKind.QUIZ if i % 4 else PillKind.INSIGHT)

    config = {"sources": {"documents": [book.slug]}, **EXPLORE, "length": 20}
    body = start(client, {"config": config})

    assert set(body) == {"session", "page", "supply", "notice"}
    assert body["notice"] is None
    assert body["session"]["config"]["sources"]["documents"] == [book.slug]
    assert body["session"]["position"] == 0 and body["session"]["finished_at"] is None
    page = body["page"]
    assert len(page["pills"]) == 10 and page["next_cursor"] == "10"
    assert all(schema_errors({"$ref": PILL_SCHEMA_ID}, p) == [] for p in page["pills"])
    assert body["supply"]["unseen"] == 12 and body["supply"]["low"] is True


def test_a_session_pages_and_ends(client: TestClient, session: Session, book: Document):
    for i in range(14):
        make_pill(session, book, f"ch0{i % 6 + 1}")
    first = start(client, {"config": {**EXPLORE, "length": 20}})
    session_id = first["session"]["id"]

    again = client.get(f"{URL}/sessions/{session_id}", params={"cursor": "0", "limit": 5}).json()
    rest = client.get(f"{URL}/sessions/{session_id}", params={"cursor": "10"}).json()

    assert [p["id"] for p in again["pills"]] == [p["id"] for p in first["page"]["pills"][:5]]
    assert (len(rest["pills"]), rest["next_cursor"], rest["done"]) == (4, None, True)
    assert set(rest) == {"pills", "next_cursor", "supply", "done", "notice"}


def test_a_session_from_a_saved_feed_and_the_nothing_read_notice(
    client: TestClient, session: Session, book: Document
):
    make_pill(session, book)
    feed = client.post(
        f"{URL}/feeds", json={"name": "Mine", "config": {"length": 10}}, headers=AUTH
    ).json()

    body = start(client, {"feed_id": feed["id"]})

    assert body["notice"] == "nothing read yet"
    assert body["session"]["config"]["mode"] == "consolidate"
    assert len(body["page"]["pills"]) == 1


def test_starting_needs_one_of_config_or_feed_and_known_sources(client: TestClient):
    assert client.post(f"{URL}/sessions", json={}, headers=AUTH).status_code == 422
    both = {"config": {}, "feed_id": str(uuid.uuid4())}
    assert client.post(f"{URL}/sessions", json=both, headers=AUTH).status_code == 422
    missing = client.post(f"{URL}/sessions", json={"feed_id": str(uuid.uuid4())}, headers=AUTH)
    assert missing.status_code == 404
    unknown = {"config": {"sources": {"documents": ["nope"]}}}
    assert client.post(f"{URL}/sessions", json=unknown, headers=AUTH).status_code == 404
    bad_mode = {"config": {"mode": "binge"}}
    assert client.post(f"{URL}/sessions", json=bad_mode, headers=AUTH).status_code == 422
    assert client.post(f"{URL}/sessions", json={"config": {}}).status_code == 401
    assert client.get(f"{URL}/sessions/{uuid.uuid4()}").status_code == 404


def test_finishing_sums_the_session_up(client: TestClient, session: Session, book: Document):
    quizzes = [make_pill(session, book, f"ch0{i}", PillKind.QUIZ) for i in (1, 2, 3)]
    read(session, book, "ch03", 0.5)
    body = start(client, {"config": EXPLORE})
    sid = body["session"]["id"]
    events = [
        *(event("seen", p.id, session_id=sid) for p in quizzes),
        event("dwell", quizzes[0].id, session_id=sid, value={"ms": 90_000}),
        event("answer", quizzes[0].id, session_id=sid, value={"correct": True}),
        event("answer", quizzes[1].id, session_id=sid, value={"correct": False}),
        event("save", quizzes[2].id, session_id=sid),
    ]
    client.post(f"{URL}/events", json={"events": events}, headers=AUTH)

    response = client.post(f"{URL}/sessions/{sid}/finish", headers=AUTH)

    assert response.status_code == 200
    summary = response.json()["summary"]
    assert {k: summary[k] for k in ("seen", "saved", "answered", "correct", "minutes")} == {
        "seen": 3,
        "saved": 1,
        "answered": 2,
        "correct": 1,
        "minutes": 2,
    }
    assert summary["due_tomorrow"] == len(session.exec(select(ReviewItem)).all()) == 2
    assert summary["next_read"] == {
        "document": {"id": str(book.id), "slug": book.slug, "title": book.title},
        "anchor": "ch03/p001",
        "title": "Heading ch03",
    }
    again = client.post(f"{URL}/sessions/{sid}/finish", headers=AUTH).json()
    assert again["summary"]["seen"] == 3


def test_supply_counts_unseen_pills_and_what_could_be_made(
    client: TestClient, session: Session, book: Document
):
    seen = make_pill(session, book, "ch01")
    make_pill(session, book, "ch02")
    client.post(f"{URL}/events", json={"events": [event("seen", seen.id)]}, headers=AUTH)
    make_artifact(session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch02")
    make_artifact(session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch01")
    make_artifact(session, book, type=ArtifactType.PILL_SET, anchor="ch01")
    bare = make_shelf_book(session, title="Undistilled")
    config = {"mode": "explore", "sources": {"documents": [book.slug, str(bare.id)]}}

    response = client.get(f"{URL}/supply", params={"config": json.dumps(config)})

    assert response.status_code == 200
    supply = response.json()
    assert (supply["unseen"], supply["low"]) == (1, True)
    by_doc = {d["document"]["id"]: d for d in supply["by_document"]}
    assert by_doc[str(book.id)] == {
        "document": {"id": str(book.id), "slug": book.slug, "title": book.title},
        "unseen": 1,
        "generatable": [{"anchor": "ch02", "title": "Heading ch02", "estimate_tokens": None}],
        "undistilled": False,
    }
    assert by_doc[str(bare.id)]["undistilled"] is True


def test_supply_takes_a_default_config_and_rejects_a_bad_one(client: TestClient, book: Document):
    assert client.get(f"{URL}/supply").status_code == 200
    bad = client.get(f"{URL}/supply", params={"config": "{not json"})
    assert bad.status_code == 422
    assert bad.json()["error"]["details"][0]["field"] == "query.config"


def test_generate_validates_and_queues(client: TestClient, session: Session, book: Document):
    make_artifact(session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch02")

    undistilled = client.post(
        f"{URL}/generate", json={"document": book.slug, "anchors": ["ch05"]}, headers=AUTH
    )
    queued = client.post(f"{URL}/generate", json={"document": book.slug}, headers=AUTH)

    assert undistilled.status_code == 422
    assert queued.status_code == 202
    jobs = session.exec(select(Job).where(Job.kind == JobKind.DERIVE)).all()
    assert queued.json() == {"jobs": [str(j.id) for j in jobs], "estimate_tokens": None}
    assert [j.anchor for j in jobs] == ["ch02"]
    missing = client.post(f"{URL}/generate", json={"document": "nope"}, headers=AUTH)
    assert missing.status_code == 404
    bad = client.post(f"{URL}/generate", json={"document": book.slug, "style": "x"}, headers=AUTH)
    assert bad.status_code == 422


def test_saved_feeds_round_trip(client: TestClient):
    config = {"sources": {"concepts": ["slack"]}, "mode": "review", "length": None}
    created = client.post(f"{URL}/feeds", json={"name": "Slack", "config": config}, headers=AUTH)
    assert created.status_code == 201
    feed = created.json()
    assert feed["config"]["sources"]["concepts"] == ["slack"]
    assert feed["config"]["length"] is None

    patched = client.patch(f"{URL}/feeds/{feed['id']}", json={"name": "Slack!"}, headers=AUTH)
    assert patched.json()["name"] == "Slack!"
    assert patched.json()["config"] == feed["config"]
    assert client.get(f"{URL}/feeds").json() == {"items": [patched.json()]}

    assert client.delete(f"{URL}/feeds/{feed['id']}", headers=AUTH).status_code == 204
    assert client.get(f"{URL}/feeds").json() == {"items": []}
    assert client.delete(f"{URL}/feeds/{feed['id']}", headers=AUTH).status_code == 404
    assert client.post(f"{URL}/feeds", json={"name": "x", "config": {}}).status_code == 401


def test_review_pills_render_on_a_session_page(
    client: TestClient, session: Session, book: Document
):
    item = make_review_item(session, book, "ch02/p001")
    body = start(client, {"config": {"mode": "review"}})
    (pill,) = body["page"]["pills"]
    assert schema_errors({"$ref": PILL_SCHEMA_ID}, pill) == []
    assert (pill["kind"], pill["review_item_id"]) == ("review", str(item.id))
