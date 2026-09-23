"""Intent routing: rules resolve addresses against the real tree; the model is optional."""

import json

import pytest
from sqlmodel import Session

from app.pipeline.runner import FakeRunner, Reply, RunnerError
from app.retrieval.router import QueryRouter, Route, parse_number
from app.schemas.search import SearchMode
from tests.retrieval.conftest import Shelf


def _route(session: Session, query: str, mode: SearchMode = "auto") -> Route:
    return QueryRouter().route(session, query, mode)


@pytest.mark.parametrize(
    ("query", "slug", "anchor"),
    [
        ("summarize chapter 2 of Meadows", "meadows-systems", "ch02"),
        ("what does Senge say in chapter 1?", "senge-fifth-discipline", "ch01"),
        ("chapter two of the Fifth Discipline", "senge-fifth-discipline", "ch02"),
        ("section 1.1 of Thinking in Systems", "meadows-systems", "ch01/s01"),
        ("Thinkng in Systms chapter II", "meadows-systems", "ch02"),
        ("open meadows-systems/ch01/s01/p002", "meadows-systems", "ch01/s01/p002"),
        ("summarize Thinking in Systems", "meadows-systems", None),
    ],
)
def test_addressed_queries_resolve_to_a_real_node(
    session: Session, shelf: Shelf, query: str, slug: str, anchor: str | None
) -> None:
    route = _route(session, query)

    assert (route.intent, route.source) == ("addressed", "rules")
    assert route.document is not None
    assert (route.document.slug, route.anchor) == (slug, anchor)


def test_a_missing_chapter_searches_inside_the_named_book(session: Session, shelf: Shelf) -> None:
    route = _route(session, "summarize chapter 9 of Meadows")

    assert route.intent == "discovery"
    assert route.document_ids == (shelf.meadows.id,)


@pytest.mark.parametrize(
    ("query", "phrase"),
    [
        ('find "inflow exceeds outflow"', "inflow exceeds outflow"),
        ("where does it say “memory of flows”", "memory of flows"),
        ("exact phrase: stock and flow", "stock and flow"),
    ],
)
def test_quotes_and_exact_wording_route_to_lexical(
    session: Session, shelf: Shelf, query: str, phrase: str
) -> None:
    route = _route(session, query)

    assert (route.intent, route.phrase) == ("lexical", phrase)


def test_comparisons_route_to_synthesis_scoped_to_the_named_books(
    session: Session, shelf: Shelf
) -> None:
    route = _route(session, "how do Meadows and Senge disagree about feedback?")

    assert route.intent == "synthesis"
    assert set(route.document_ids) == {shelf.meadows.id, shelf.senge.id}


def test_open_questions_fall_back_to_discovery_without_a_model(
    session: Session, shelf: Shelf
) -> None:
    route = _route(session, "what do I know about feedback loops?")

    assert (route.intent, route.source) == ("discovery", "fallback")


def test_an_explicit_mode_overrides_the_rules(session: Session, shelf: Shelf) -> None:
    assert _route(session, "chapter 2 of Meadows", mode="discovery").intent == "discovery"
    assert _route(session, "feedback loops", mode="lexical").phrase == "feedback loops"


def test_the_model_classifies_what_no_rule_catches_and_is_cached(
    session: Session, shelf: Shelf
) -> None:
    reply = json.dumps({"intent": "addressed", "document": "Donella Meadows", "chapter": 1})
    runner = FakeRunner(reply)
    router = QueryRouter(runner)

    first = router.route(session, "the bit about stocks in Donella's book")
    second = router.route(session, "The bit about stocks in  Donella's book")

    assert (first.intent, first.source, first.anchor) == ("addressed", "model", "ch01")
    assert second.anchor == "ch01"
    assert len(runner.calls) == 1


def _raise(prompt: str) -> str:
    raise RunnerError("claude timed out after 20s")


@pytest.mark.parametrize("reply", [_raise, "not json at all", '{"intent": "addressed"}'])
def test_any_model_failure_means_discovery(session: Session, shelf: Shelf, reply: Reply) -> None:
    router = QueryRouter(FakeRunner(reply))

    route = router.route(session, "the bit about stocks in Donella's book")

    assert (route.intent, route.source) == ("discovery", "fallback")


@pytest.mark.parametrize(
    ("token", "value"), [("3", 3), ("iv", 4), ("xii", 12), ("seven", 7), ("chapter", None)]
)
def test_chapter_numbers_parse_from_digits_roman_and_words(token: str, value: int | None) -> None:
    assert parse_number(token) == value
