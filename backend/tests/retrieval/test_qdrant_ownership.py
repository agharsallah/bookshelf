"""Who opens Qdrant, and what happens when it is not there (§18 "API-owned Qdrant").

Embedded Qdrant locks its directory to one process, so the API runs `embed` jobs itself
on a background thread; the API never touches Qdrant at startup, reports it separately
in readiness, and answers vector searches with `503` while it is unreachable.
"""

import time
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.embedded import EmbedRunner
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult
from app.main import create_app
from app.models import Job
from app.models.enums import JobKind, JobState
from app.retrieval.client import set_client
from app.retrieval.embedding import FakeEmbedder
from tests.retrieval.conftest import Shelf


def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return predicate()


def state_of(session: Session, job: Job) -> JobState:
    session.expire_all()
    fresh = session.get(Job, job.id)
    assert fresh is not None
    return fresh.state


@pytest.fixture
def unreachable() -> Iterator[QdrantClient]:
    """A Qdrant server that is not running (a closed local port: refused at once)."""
    client = QdrantClient(url="http://127.0.0.1:9", timeout=1, check_compatibility=False)
    set_client(client)
    yield client
    set_client(None)


def test_embed_runner_runs_only_embed_jobs_and_stops_cleanly(session: Session):
    embed = queue.enqueue(session, JobSpec(kind=JobKind.EMBED, anchor="vectors"))
    parse = queue.enqueue(session, JobSpec(kind=JobKind.PARSE, anchor="tree"))
    assert embed is not None and parse is not None
    handler = {JobKind.EMBED: lambda ctx: HandlerResult(result={"points": 3})}
    runner = EmbedRunner(poll_seconds=0.01, handlers=handler, on_done=lambda db, job: None)

    runner.start()
    try:
        assert wait_until(lambda: state_of(session, embed) is JobState.DONE)
    finally:
        stopped = runner.stop(timeout=5)

    assert stopped and not runner.running
    assert state_of(session, parse) is JobState.QUEUED  # the standalone worker's job


@pytest.mark.parametrize(
    ("qdrant_url", "runs_embed"), [(None, True), ("http://qdrant.internal:6333", False)]
)
def test_api_lifespan_runs_embed_jobs_only_for_embedded_qdrant(qdrant_url, runs_embed):
    settings = get_settings().model_copy(
        update={"api_embed_runner": True, "qdrant_url": qdrant_url}
    )
    app = create_app(settings)

    with TestClient(app):
        runner = app.state.runners.embed
        assert (runner is not None and runner.running) is runs_embed

    assert runner is None or not runner.running


def test_readiness_reports_qdrant_separately_and_degrades_without_it(
    client: TestClient, unreachable: QdrantClient
):
    response = client.get("/health/ready")

    assert response.status_code == 200
    body = response.json()
    assert (body["status"], body["database"], body["qdrant"]) == ("degraded", "ok", "unavailable")
    assert body["qdrant_error"]


def test_readiness_is_ready_when_qdrant_answers(client: TestClient, qdrant: QdrantClient):
    body = client.get("/health/ready").json()

    assert (body["status"], body["qdrant"], body["qdrant_error"]) == ("ready", "ok", None)


def search(client: TestClient, query: str) -> dict:
    response = client.post("/api/v1/search", json={"query": query})
    assert response.status_code == 200
    return response.json()


def test_vector_search_degrades_to_unavailable_while_qdrant_is_unreachable(
    client: TestClient, unreachable: QdrantClient, embedder: FakeEmbedder
):
    body = search(client, "what about feedback loops?")

    assert (body["intent"], body["groups"], body["index_state"]) == (
        "discovery", [], "unavailable",
    )  # fmt: skip


def test_lexical_and_addressed_queries_need_no_qdrant(
    client: TestClient, unreachable: QdrantClient, embedder: FakeEmbedder, shelf: Shelf
):
    lexical = search(client, '"memory of flows"')
    addressed = search(client, "summarize chapter 2 of Meadows")

    assert lexical["intent"] == "lexical" and lexical["groups"]
    assert addressed["intent"] == "addressed" and addressed["groups"]
    assert (lexical["index_state"], addressed["index_state"]) == (None, None)


def test_the_first_search_creates_the_collections_and_reports_an_empty_index(
    client: TestClient, qdrant: QdrantClient, embedder: FakeEmbedder
):
    body = search(client, "what about feedback loops?")

    assert (body["groups"], body["index_state"]) == ([], "empty")
    assert qdrant.collection_exists("distillations")


def test_collections_that_vanish_are_recreated_instead_of_failing(
    client: TestClient, indexed: Shelf, collections: QdrantClient
):
    assert search(client, "balancing feedback loops")["index_state"] == "ready"
    for name in ("blocks", "distillations"):
        collections.delete_collection(name)

    assert search(client, "balancing feedback loops")["index_state"] == "empty"
