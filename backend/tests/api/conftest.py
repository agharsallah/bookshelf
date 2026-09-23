"""Fixtures for the API tests: empty `library/` and media folders at the start of each test."""

import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.documents import get_http_client
from app.core.config import get_settings
from app.services import fetch


def _empty(folder: Path) -> Path:
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True)
    return folder


@pytest.fixture(autouse=True)
def library_dir() -> Path:
    return _empty(get_settings().library_dir)


@pytest.fixture(autouse=True)
def media_dir() -> Path:
    return _empty(get_settings().media_dir)


@pytest.fixture
def exports_dir() -> Path:
    return _empty(get_settings().exports_dir)


Responder = Callable[[httpx.Request], httpx.Response]


def public_dns(host: str) -> list[str]:
    """Every test host resolves to one public address (a former example.com IP)."""
    return ["93.184.216.34"]


@pytest.fixture
def web(client: TestClient) -> Iterator[Callable[[Responder], None]]:
    """Route URL-ingest fetches to a fake web: `web(lambda request: httpx.Response(...))`."""

    app = cast(FastAPI, client.app)

    def install(responder: Responder) -> None:
        transport = httpx.MockTransport(responder)
        app.dependency_overrides[get_http_client] = lambda: fetch.make_client(
            transport, resolver=public_dns
        )

    yield install
    app.dependency_overrides.pop(get_http_client, None)
