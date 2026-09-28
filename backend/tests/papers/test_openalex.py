"""OpenAlex client against an `httpx.MockTransport` serving documented shapes: no network."""

import json
from collections.abc import Callable
from datetime import date
from pathlib import Path

import httpx
import pytest

from app.papers.openalex import (
    OpenAlex,
    OpenAlexError,
    OpenAlexNotFoundError,
    OpenAlexRateLimitedError,
    OpenAlexUnavailableError,
)
from app.papers.works import parse_work

WORK = json.loads((Path(__file__).parent / "fixtures" / "work_transformer.json").read_text())

Handler = Callable[[httpx.Request], httpx.Response]


def stub(id_: str, title: str = "A paper") -> dict:
    return {"id": f"https://openalex.org/{id_}", "display_name": title}


def page(*results: dict) -> httpx.Response:
    return httpx.Response(200, json={"meta": {"count": len(results)}, "results": list(results)})


def make(handler: Handler, **kwargs) -> tuple[OpenAlex, list[httpx.Request], list[float]]:
    sent: list[httpx.Request] = []
    slept: list[float] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return handler(request)

    client = httpx.Client(transport=httpx.MockTransport(record))
    api = OpenAlex(client, base_url="https://oa.test", sleep=slept.append, **kwargs)
    return api, sent, slept


def test_work_by_id_sends_select_and_polite_pool_params():
    api, sent, _ = make(lambda r: httpx.Response(200, json=WORK), mailto="me@example.org")
    work = api.work("https://openalex.org/W2626778328")
    assert work.openalex_id == "W2626778328"
    assert sent[0].url.path == "/works/W2626778328"
    assert sent[0].url.params["mailto"] == "me@example.org"
    assert "abstract_inverted_index" in sent[0].url.params["select"].split(",")
    assert "api_key" not in sent[0].url.params


def test_a_404_raises_not_found_and_by_doi_turns_it_into_none():
    api, sent, _ = make(lambda r: httpx.Response(404, text="<h1>Not Found</h1>"))
    with pytest.raises(OpenAlexNotFoundError):
        api.work("W1")
    assert api.by_doi("https://doi.org/10.1/X") is None
    assert sent[-1].url.path == "/works/doi:10.1/x"


def test_by_ids_batches_fifty_per_call_and_keeps_input_order():
    ids = [f"W{n}" for n in range(1, 121)]

    def handler(request: httpx.Request) -> httpx.Response:
        wanted = request.url.params["filter"].removeprefix("ids.openalex:").split("|")
        assert len(wanted) <= 50
        found = [stub(i) for i in reversed(wanted) if i != "W7"]  # W7 is unknown upstream
        return page(*found)

    api, sent, _ = make(handler)
    works = api.works_by_ids([*ids, "W1"])  # duplicate dropped
    assert len(sent) == 3
    assert [w.openalex_id for w in works] == [i for i in ids if i != "W7"]


def test_references_and_related_resolve_the_work_s_id_lists():
    def handler(request: httpx.Request) -> httpx.Response:
        wanted = request.url.params["filter"].removeprefix("ids.openalex:").split("|")
        return page(*(stub(i) for i in wanted))

    api, _, _ = make(handler)
    transformer = parse_work(WORK)
    assert [w.openalex_id for w in api.references(transformer)] == ["W1632114991", "W1810943226"]
    assert [w.openalex_id for w in api.related(transformer)] == ["W2965373594", "W2964308564"]


def test_no_ids_means_no_request():
    api, sent, _ = make(lambda r: page())
    assert api.works_by_ids([]) == []
    assert sent == []


def test_citing_filters_by_cites_and_publication_date_newest_first():
    api, sent, _ = make(lambda r: page(stub("W9", "Newer")))
    works = api.citing("W2626778328", since=date(2026, 9, 1), limit=500)
    params = sent[0].url.params
    assert params["filter"] == "cites:W2626778328,from_publication_date:2026-09-01"
    assert params["sort"] == "publication_date:desc"
    assert params["per_page"] == "100"  # capped at the OpenAlex maximum
    assert [w.title for w in works] == ["Newer"]


def test_a_429_is_retried_once_after_retry_after():
    responses = iter(
        [httpx.Response(429, headers={"Retry-After": "3"}), httpx.Response(200, json=WORK)]
    )
    api, sent, slept = make(lambda r: next(responses))
    assert api.work("W2626778328").title == "Attention Is All You Need"
    assert (len(sent), slept) == (2, [3.0])


def test_a_second_429_raises_rate_limited_with_the_wait():
    body = {"error": "Rate limit exceeded", "retryAfter": 5}
    api, sent, slept = make(lambda r: httpx.Response(429, json=body))
    with pytest.raises(OpenAlexRateLimitedError) as caught:
        api.work("W1")
    assert (len(sent), slept, caught.value.retry_after) == (2, [5.0], 5.0)


def test_a_retry_after_above_the_cap_fails_fast_without_sleeping():
    api, sent, slept = make(
        lambda r: httpx.Response(429, headers={"Retry-After": "34"}), max_retry_wait=10
    )
    with pytest.raises(OpenAlexRateLimitedError):
        api.work("W1")
    assert (len(sent), slept) == (1, [])


def test_timeouts_5xx_and_bad_requests_are_typed():
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    cases: list[tuple[Handler, type[Exception]]] = [
        (timeout, OpenAlexUnavailableError),
        (lambda r: httpx.Response(503), OpenAlexUnavailableError),
        (lambda r: httpx.Response(400, json={"error": "bad filter"}), OpenAlexError),
        (lambda r: httpx.Response(200, text="not json"), OpenAlexUnavailableError),
    ]
    for handler, error in cases:
        api, _, _ = make(handler)
        with pytest.raises(error):
            api.work("W1")


def test_resolve_tries_doi_then_arxiv_landing_page():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/works/doi:"):
            return httpx.Response(404)
        assert request.url.params["filter"] == (
            "locations.landing_page_url:"
            "http://arxiv.org/abs/1706.03762|https://arxiv.org/abs/1706.03762"
        )
        return page(WORK)

    api, sent, _ = make(handler)
    work = api.resolve(doi="10.9/missing", arxiv_id="arXiv:1706.03762v5", title="ignored")
    assert work is not None and work.openalex_id == "W2626778328"
    assert len(sent) == 2


def test_title_search_keeps_only_a_close_title_match_and_filters_by_year():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["search"] == "Attention is all you need!"
        assert request.url.params["filter"] == "publication_year:2017"
        return page(
            stub("W5", "Attention in vision: a survey"), stub("W6", "Attention Is All You Need")
        )

    api, _, _ = make(handler)
    found = api.search_title("Attention is all you need!", 2017)
    assert found is not None and found.openalex_id == "W6"

    api, _, _ = make(lambda r: page(stub("W5", "Something else entirely")))
    assert api.resolve(title="Attention is all you need") is None
