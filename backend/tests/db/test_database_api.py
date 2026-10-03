"""`/database`: the settings page's view of both databases, the switch and the sync."""

from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.database import get_database_service
from app.core.config import Environment, get_settings
from app.db import session as db_session
from app.db.targets import DatabaseTarget
from app.services.database import DatabaseService
from tests.api.factories import make_document
from tests.conftest import AUTH


@pytest.fixture
def two_databases(client: TestClient, peer_url: str, peer, tmp_path: Path) -> Iterator[None]:
    settings = get_settings().model_copy(
        update={
            "environment": Environment.LOCAL,
            "local_database_url": peer_url,
            "database_target_file": tmp_path / "database-target",
        }
    )
    service = DatabaseService(settings)
    app = cast(FastAPI, client.app)
    app.dependency_overrides[get_database_service] = lambda: service
    yield
    app.dependency_overrides.pop(get_database_service)
    db_session.use_target(DatabaseTarget.REMOTE, get_settings().database_url)


def test_with_one_database_the_page_says_so(client):
    body = client.get("/api/v1/database").json()

    assert body["available"] is False
    assert [t["target"] for t in body["targets"]] == ["remote"]


def test_changing_anything_needs_the_api_key(client):
    assert client.put("/api/v1/database/active", json={"target": "local"}).status_code == 401
    assert client.post("/api/v1/database/sync", json={"source": "local"}).status_code == 401


def test_with_one_database_switching_is_a_conflict(client):
    response = client.put("/api/v1/database/active", json={"target": "local"}, headers=AUTH)

    assert response.status_code == 409
    assert "Only one database" in response.json()["error"]["message"]


def test_switch_then_sync_back(client, two_databases, session, peer):
    make_document(session, title="Thinking in Systems")

    switched = client.put("/api/v1/database/active", json={"target": "local"}, headers=AUTH)
    assert switched.status_code == 200 and switched.json()["active"] == "local"
    assert client.get("/api/v1/documents").json()["items"] == []  # the empty local one

    started = client.post(
        "/api/v1/database/sync", json={"source": "remote", "backup": False}, headers=AUTH
    )
    assert started.status_code == 202 and started.json()["state"] == "running"
    service = cast(FastAPI, client.app).dependency_overrides[get_database_service]()
    assert service.wait(timeout=30).state == "done"

    titles = [d["title"] for d in client.get("/api/v1/documents").json()["items"]]
    assert titles == ["Thinking in Systems"]
