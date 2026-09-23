"""Shutdown ends long-lived responses: SSE streams stop at once instead of holding a
`fastapi dev` reload (or Ctrl-C) until their own timers run out."""

import json
import signal
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.core import lifecycle
from app.core.docs import TAGS_METADATA


@pytest.fixture
def shutting_down() -> Iterator[None]:
    lifecycle.stopping.set()
    yield
    lifecycle.stopping.clear()


def test_the_job_stream_ends_as_soon_as_shutdown_begins(client: TestClient, shutting_down):
    with client.stream("GET", "/api/v1/jobs/stream", params={"max_seconds": 3600}) as response:
        text = "".join(response.iter_text())

    last = text.strip().split("\n\n")[-1].splitlines()
    assert last[0] == "event: end"
    assert json.loads(last[1].removeprefix("data: ")) == {"reason": "shutdown"}


def test_shutdown_signals_set_the_flag_and_still_reach_the_server():
    received: list[int] = []
    previous = signal.signal(signal.SIGTERM, lambda signum, frame: received.append(signum))
    restore = lifecycle.install()
    try:
        signal.raise_signal(signal.SIGTERM)
    finally:
        restore()
        signal.signal(signal.SIGTERM, previous)
    stopped = lifecycle.stopping.is_set()
    lifecycle.stopping.clear()

    assert stopped and received == [signal.SIGTERM]


def test_every_route_tag_is_documented(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    used = {tag for path in paths.values() for op in path.values() for tag in op.get("tags", [])}

    assert used <= {str(t["name"]) for t in TAGS_METADATA}


def test_openapi_lists_resume_and_confirm(client: TestClient):
    paths = json.dumps(client.get("/openapi.json").json()["paths"])

    assert "/outline/confirm" in paths and "/resume" in paths
