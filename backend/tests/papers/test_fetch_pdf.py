"""Open-access PDF download: arXiv first, PDFs only, size-capped, never overwriting."""

from pathlib import Path

import httpx
import pytest

from app.core.errors import ConflictError
from app.papers.fetch_pdf import (
    NotAPdfError,
    PdfTooLargeError,
    PdfUnavailableError,
    fetch_pdf,
    pdf_is_taken,
)
from app.services.errors import InvalidInputError
from app.services.fetch import make_client

PDF = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def serve(routes: dict[str, httpx.Response]) -> tuple[httpx.Client, list[str]]:
    sent: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return routes.get(str(request.url), httpx.Response(404))

    return httpx.Client(transport=httpx.MockTransport(handler)), sent


def pdf_response(body: bytes = PDF, content_type: str = "application/pdf") -> httpx.Response:
    return httpx.Response(200, content=body, headers={"content-type": content_type})


def test_prefers_arxiv_and_writes_under_library_papers(tmp_path: Path):
    library = tmp_path / "library"
    client, sent = serve({"https://arxiv.org/pdf/1706.03762": pdf_response()})
    path = fetch_pdf(
        client, library, slug="attention", arxiv_id="1706.03762v5", pdf_url="https://oa.test/x.pdf"
    )
    assert path == "library/papers/attention.pdf"
    assert (library / "papers" / "attention.pdf").read_bytes() == PDF
    assert sent == ["https://arxiv.org/pdf/1706.03762"]
    assert [p.name for p in (library / "papers").iterdir()] == ["attention.pdf"]  # no temp left


def test_falls_back_to_the_open_access_url_when_arxiv_fails(tmp_path: Path):
    client, sent = serve({"https://oa.test/x.pdf": pdf_response(content_type="")})
    path = fetch_pdf(
        client, tmp_path, slug="p", arxiv_id="2101.00001", pdf_url="https://oa.test/x.pdf"
    )
    assert path.endswith("papers/p.pdf")
    assert sent == ["https://arxiv.org/pdf/2101.00001", "https://oa.test/x.pdf"]


def test_a_source_the_ssrf_guard_refuses_does_not_stop_the_next_one(tmp_path: Path):
    """The production client refuses unresolvable or private hosts with InvalidInputError;
    that is one failed source, not the end of the fetch."""

    def resolver(host: str) -> list[str]:
        if host == "arxiv.org":
            raise InvalidInputError("Cannot resolve arxiv.org.")
        return ["93.184.216.34"]

    transport = httpx.MockTransport(lambda request: pdf_response())
    client = make_client(transport, resolver=resolver)
    path = fetch_pdf(
        client, tmp_path, slug="p", arxiv_id="2101.00001", pdf_url="https://oa.test/x.pdf"
    )
    assert path.endswith("papers/p.pdf")

    blocked = make_client(transport, resolver=lambda host: ["10.0.0.1"])
    with pytest.raises(InvalidInputError):  # every source refused: the last reason surfaces
        fetch_pdf(blocked, tmp_path, slug="q", pdf_url="https://intranet.test/x.pdf")


@pytest.mark.parametrize(
    "response",
    [
        pdf_response(b"<html>landing page</html>", "text/html; charset=utf-8"),
        pdf_response(b"PK\x03\x04 a zip, not a pdf", "application/octet-stream"),
    ],
)
def test_rejects_anything_that_is_not_a_pdf(tmp_path: Path, response: httpx.Response):
    client, _ = serve({"https://oa.test/x.pdf": response})
    with pytest.raises(NotAPdfError):
        fetch_pdf(client, tmp_path, slug="p", pdf_url="https://oa.test/x.pdf")
    assert not (tmp_path / "papers" / "p.pdf").exists()


def test_rejects_an_oversized_pdf_by_header_and_by_streamed_size(tmp_path: Path):
    big = PDF + b"0" * 2048
    declared = pdf_response(big)  # httpx sets Content-Length
    streamed = httpx.Response(200, content=iter([big[:900], big[900:]]))  # chunked, no length
    assert "content-length" not in streamed.headers
    for response in (declared, streamed):
        client, _ = serve({"https://oa.test/x.pdf": response})
        with pytest.raises(PdfTooLargeError):
            fetch_pdf(client, tmp_path, slug="p", pdf_url="https://oa.test/x.pdf", max_bytes=1024)
    assert not (tmp_path / "papers").exists() or not any((tmp_path / "papers").iterdir())


def test_never_overwrites_an_existing_file(tmp_path: Path):
    existing = tmp_path / "papers" / "p.pdf"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"mine")
    client, sent = serve({"https://oa.test/x.pdf": pdf_response()})
    with pytest.raises(ConflictError):
        fetch_pdf(client, tmp_path, slug="p", pdf_url="https://oa.test/x.pdf")
    assert existing.read_bytes() == b"mine"
    assert sent == []  # refused before downloading
    assert pdf_is_taken(tmp_path)("p") and not pdf_is_taken(tmp_path)("q")


def test_no_source_http_errors_and_bad_slugs_are_typed(tmp_path: Path):
    client, _ = serve({})
    with pytest.raises(PdfUnavailableError):
        fetch_pdf(client, tmp_path, slug="p")
    with pytest.raises(PdfUnavailableError):
        fetch_pdf(client, tmp_path, slug="p", pdf_url="https://oa.test/missing.pdf")
    with pytest.raises(InvalidInputError):
        fetch_pdf(client, tmp_path, slug="../escape", pdf_url="https://oa.test/x.pdf")
