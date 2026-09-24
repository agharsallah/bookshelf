"""Ingest by URL against a fake web (`httpx.MockTransport`): no network in tests."""

from collections.abc import Callable
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.services import fetch
from tests.conftest import AUTH

URL = "/api/v1/documents"
ARTICLE = b"""<html><head><title>Leverage Points</title>
<meta name="author" content="Donella Meadows">
<meta property="article:published_time" content="1999-12-01"></head>
<body><h1>Leverage Points</h1><p>Places to intervene in a system.</p></body></html>"""

Web = Callable[[Callable[[httpx.Request], httpx.Response]], None]


def html(content: bytes = ARTICLE, **headers: str) -> httpx.Response:
    return httpx.Response(200, content=content, headers={"content-type": "text/html", **headers})


def test_url_ingest_keeps_the_original_html_and_reads_page_metadata(
    client: TestClient, web: Web, library_dir: Path
):
    web(lambda request: html())

    response = client.post(URL, json={"url": "https://example.com/leverage"}, headers=AUTH)

    assert response.status_code == 202
    document = response.json()["document"]
    assert document["kind"] == "article"
    assert document["slug"] == "leverage-points"
    assert document["authors"] == ["Donella Meadows"]
    assert document["year"] == 1999
    assert document["source_uri"] == "https://example.com/leverage"
    assert document["source_path"] == "library/articles/leverage-points.html"
    assert (library_dir / "articles" / "leverage-points.html").read_bytes() == ARTICLE
    assert response.json()["job"]["kind"] == "parse"


def test_same_article_twice_is_409(client: TestClient, web: Web):
    web(lambda request: html())
    client.post(URL, json={"url": "https://example.com/a"}, headers=AUTH)

    response = client.post(URL, json={"url": "https://example.com/b"}, headers=AUTH)

    assert response.status_code == 409


def test_redirects_are_followed_up_to_the_limit(client: TestClient, web: Web):
    def responder(request: httpx.Request) -> httpx.Response:
        hop = int(request.url.params.get("hop", "0"))
        if hop < fetch.MAX_REDIRECTS:
            return httpx.Response(302, headers={"location": f"/r?hop={hop + 1}"})
        return html()

    web(responder)

    response = client.post(URL, json={"url": "https://example.com/r"}, headers=AUTH)

    assert response.status_code == 202
    assert response.json()["document"]["source_uri"] == "https://example.com/r"


def test_too_many_redirects_is_422(client: TestClient, web: Web):
    web(lambda request: httpx.Response(302, headers={"location": "/loop"}))

    response = client.post(URL, json={"url": "https://example.com/loop"}, headers=AUTH)

    assert response.status_code == 422
    assert "redirects" in response.json()["error"]["message"]


def test_pages_over_the_size_cap_are_rejected_without_saving(
    client: TestClient, web: Web, library_dir: Path
):
    big = b"<html>" + b"x" * fetch.MAX_BYTES + b"</html>"
    web(lambda request: html(big))

    response = client.post(URL, json={"url": "https://example.com/big"}, headers=AUTH)

    assert response.status_code == 422
    assert "MiB" in response.json()["error"]["message"]
    assert not (library_dir / "articles").exists()


def test_streamed_pages_without_a_length_are_cut_off_at_the_cap(client: TestClient, web: Web):
    chunk = b"x" * (1024 * 1024)
    chunks = [chunk] * (fetch.MAX_BYTES // len(chunk) + 1)
    web(
        lambda request: httpx.Response(
            200, content=iter(chunks), headers={"content-type": "text/html"}
        )
    )

    response = client.post(URL, json={"url": "https://example.com/stream"}, headers=AUTH)

    assert response.status_code == 422
    assert "MiB" in response.json()["error"]["message"]


def test_non_html_and_client_errors_are_422_server_errors_502(client: TestClient, web: Web):
    responses = {
        "/pdf": httpx.Response(200, content=b"%PDF", headers={"content-type": "application/pdf"}),
        "/gone": httpx.Response(404),
        "/down": httpx.Response(503),
    }
    web(lambda request: responses[request.url.path])

    statuses = [
        client.post(URL, json={"url": f"https://example.com{p}"}, headers=AUTH).status_code
        for p in responses
    ]

    assert statuses == [422, 422, 502]


def test_timeouts_are_502(client: TestClient, web: Web):
    def responder(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    web(responder)

    response = client.post(URL, json={"url": "https://example.com/slow"}, headers=AUTH)

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_error"


def test_only_http_urls_are_accepted(client: TestClient):
    response = client.post(URL, json={"url": "file:///etc/passwd"}, headers=AUTH)

    assert response.status_code == 422


@pytest.mark.parametrize("url", ["http://💥/", "http://exa mple.com/", "https://a\x00b/"])
def test_urls_httpx_cannot_parse_are_422(client: TestClient, web: Web, url: str):
    web(lambda request: html())

    response = client.post(URL, json={"url": url}, headers=AUTH)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.url"
