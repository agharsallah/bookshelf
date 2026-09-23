"""The search endpoints over HTTP: request validation, response shape, SSE framing."""

import json
from collections.abc import Iterator
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.routes.search import get_answer_router, get_answer_runner
from app.models import Concept
from app.models.enums import ConceptKind
from app.pipeline.runner import FakeRunner
from app.retrieval.router import QueryRouter
from tests.conftest import AUTH
from tests.retrieval.conftest import Shelf, para

URL = "/api/v1/search"


def _events(body: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse an SSE body into (event, data) pairs, skipping keep-alive comments."""
    events = []
    for frame in body.strip().split("\n\n"):
        fields = dict(
            line.split(": ", 1) for line in frame.splitlines() if not line.startswith(":")
        )
        if "data" in fields:
            events.append((fields.get("event", "message"), json.loads(fields["data"])))
    return events


@pytest.fixture
def runner(client: TestClient) -> Iterator[FakeRunner]:
    fake = FakeRunner(
        json.dumps({"blocks": [para("Loops seek goals.", "meadows-systems:ch02/p001")]})
    )
    app = cast(FastAPI, client.app)
    app.dependency_overrides[get_answer_runner] = lambda: fake
    app.dependency_overrides[get_answer_router] = lambda: QueryRouter()
    yield fake
    app.dependency_overrides.clear()


def test_search_returns_grouped_hits_with_intent_and_timing(
    client: TestClient, indexed: Shelf
) -> None:
    response = client.post(URL, json={"query": "balancing feedback loops", "limit": 2})

    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "discovery"
    assert body["resolved"] is None
    assert isinstance(body["took_ms"], int)
    group = body["groups"][0]
    assert group["document"] == {
        "id": str(indexed.meadows.id),
        "slug": "meadows-systems",
        "title": "Thinking in Systems",
        "authors": ["Donella Meadows"],
    }
    assert group["hits"][0]["kind"] == "distillation"
    assert group["hits"][0]["type"] == "chapter_distillation"


def test_search_resolves_addressed_queries(client: TestClient, indexed: Shelf) -> None:
    body = client.post(URL, json={"query": "chapter 2 of Meadows"}).json()

    assert body["intent"] == "addressed"
    assert body["resolved"]["anchor"] == "ch02"
    assert body["resolved"]["document"]["slug"] == "meadows-systems"


@pytest.mark.parametrize(
    "payload",
    [{"query": ""}, {"query": "x", "mode": "fuzzy"}, {"query": "x", "limit": 0}, {"q": "x"}],
)
def test_search_rejects_invalid_requests(client: TestClient, payload: dict[str, Any]) -> None:
    response = client.post(URL, json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_answer_requires_the_api_key(client: TestClient, runner: FakeRunner) -> None:
    assert client.post(f"{URL}/answer", json={"query": "loops"}).status_code == 401


def test_answer_streams_status_hits_and_a_cited_answer(
    client: TestClient, indexed: Shelf, runner: FakeRunner
) -> None:
    response = client.post(
        f"{URL}/answer", json={"query": "balancing feedback loops"}, headers=AUTH
    )

    assert response.headers["content-type"].startswith("text/event-stream")
    events = _events(response.text)
    assert [name for name, _ in events] == ["status", "status", "hits", "status", "answer"]
    assert events[2][1]["intent"] == "discovery"
    answer = events[-1][1]
    assert answer["blocks"][0]["spans"][0]["cites"] == ["meadows-systems:ch02/p001"]
    assert answer["sources"]["meadows-systems:ch02/p001"]["anchor"] == "ch02/p001"
    assert answer["dropped_cites"] == []


def test_suggest_items_carry_the_ids_and_addresses_to_navigate_to(
    client: TestClient, session: Session, shelf: Shelf
) -> None:
    loop = Concept(canonical="feedback loop", kind=ConceptKind.CONCEPT)
    session.add(loop)
    session.commit()

    items = client.get(f"{URL}/suggest", params={"q": "feedback"}).json()["items"]
    [title] = client.get(f"{URL}/suggest", params={"q": "fifth"}).json()["items"]

    chapter, concept = items
    assert (chapter["document"]["slug"], chapter["anchor"]) == ("meadows-systems", "ch02")
    assert concept["id"] == str(loop.id)
    assert (title["id"], title["document"]["slug"]) == (
        str(shelf.senge.id), "senge-fifth-discipline",
    )  # fmt: skip


def test_suggest_offers_titles_chapters_and_concepts(
    client: TestClient, session: Session, shelf: Shelf
) -> None:
    session.add(Concept(canonical="feedback loop", aliases=["loop"], kind=ConceptKind.CONCEPT))
    session.commit()

    items = client.get(f"{URL}/suggest", params={"q": "feedback"}).json()["items"]
    titles = client.get(f"{URL}/suggest", params={"q": "fifth"}).json()["items"]

    assert [(i["kind"], i["label"], i["anchor"]) for i in items] == [
        ("chapter", "Feedback Loops", "ch02"),
        ("concept", "feedback loop", None),
    ]
    assert [(i["kind"], i["label"]) for i in titles] == [("document", "The Fifth Discipline")]
