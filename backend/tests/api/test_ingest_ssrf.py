"""SSRF guard on URL ingest: internal addresses are refused, on the first request and on
every redirect hop, before anything is sent. A fake resolver and transport: no network."""

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.documents import get_http_client
from app.services import fetch
from tests.conftest import AUTH

URL = "/api/v1/documents"
DNS = {"blog.example": ["93.184.216.34"], "intranet.example": ["93.184.216.34", "10.0.0.7"]}


@pytest.fixture
def requested(client: TestClient):
    """Serve a redirect to the intranet from `blog.example`; record every request sent."""
    sent: list[str] = []

    def responder(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://intranet.example/admin"})

    transport = httpx.MockTransport(responder)
    app = client.app
    assert isinstance(app, FastAPI)
    app.dependency_overrides[get_http_client] = lambda: fetch.make_client(
        transport, resolver=lambda host: DNS.get(host, [])
    )
    yield sent
    app.dependency_overrides.pop(get_http_client, None)


INTERNAL = [
    *("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1"),
    *("224.0.0.1", "240.0.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fc00::1", "ff02::1"),  # noqa: S104
    *("::ffff:127.0.0.1", "::ffff:10.0.0.1"),
]


@pytest.mark.parametrize("address", INTERNAL)
def test_internal_addresses_are_not_public(address: str):
    assert fetch.is_public_address(address) is False


@pytest.mark.parametrize("address", ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])
def test_routable_addresses_are_public(address: str):
    assert fetch.is_public_address(address) is True


@pytest.mark.parametrize(
    "url",
    ["http://127.0.0.1/", "http://[::ffff:169.254.169.254]/latest", "https://intranet.example/"],
)
def test_urls_to_internal_hosts_are_refused_before_any_request(
    client: TestClient, requested: list[str], url: str
):
    response = client.post(URL, json={"url": url}, headers=AUTH)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.url"
    assert requested == []


def test_a_redirect_into_the_intranet_is_refused_at_that_hop(
    client: TestClient, requested: list[str]
):
    response = client.post(URL, json={"url": "https://blog.example/post"}, headers=AUTH)

    assert response.status_code == 422
    assert requested == ["https://blog.example/post"]  # the intranet was never contacted
