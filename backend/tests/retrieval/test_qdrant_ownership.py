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
        runner = app.state.embed_runner
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


def test_vector_search_is_503_while_qdrant_is_unreachable(
    client: TestClient, unreachable: QdrantClient, embedder: FakeEmbedder
):
    response = client.post("/api/v1/search", json={"query": "what about feedback loops?"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


def test_first_search_creates_the_collections(
    client: TestClient, qdrant: QdrantClient, embedder: FakeEmbedder
):
    response = client.post("/api/v1/search", json={"query": "what about feedback loops?"})

    assert response.status_code == 200
    assert response.json()["groups"] == []
    assert qdrant.collection_exists("distillations")
