"""Answer synthesis: qualified cites checked against the evidence, streamed in order."""

import json
from typing import Any

from pydantic import BaseModel
from sqlmodel import Session

from app.pipeline.runner import FakeRunner
from app.retrieval import answer
from app.retrieval.embedding import FakeEmbedder
from app.retrieval.router import QueryRouter
from app.schemas.search import AnswerEvent, ErrorEvent, SearchRequest
from tests.retrieval.conftest import Shelf, para

VALID = "meadows-systems:ch02/p001"
DISTILLED_SCOPE = "meadows-systems:ch02"
INVENTED = "meadows-systems:ch09/p001"


def _reply(*cites: str) -> str:
    return json.dumps({"blocks": [para("Balancing loops seek a goal.", *cites)]})


def _stream(
    session: Session, embedder: FakeEmbedder, runner: FakeRunner, query: str
) -> list[tuple[str, BaseModel]]:
    events = answer.stream(
        session, SearchRequest(query=query), router=QueryRouter(), embedder=embedder, runner=runner
    )
    return list(events)


def _answer(events: list[tuple[str, BaseModel]]) -> AnswerEvent:
    name, payload = events[-1]
    assert name == "answer", payload
    assert isinstance(payload, AnswerEvent)
    return payload


def _spans(event: AnswerEvent) -> list[dict[str, Any]]:
    return [span for block in event.blocks for span in block["spans"]]


def test_the_stream_reports_progress_then_hits_then_the_answer(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    events = _stream(session, embedder, FakeRunner(_reply(VALID)), "balancing feedback loops")

    assert [name for name, _ in events] == ["status", "status", "hits", "status", "answer"]
    assert [getattr(p, "stage", None) for _, p in events] == [
        "routing", "searching", None, "writing", None,
    ]  # fmt: skip


def test_invented_cites_are_dropped_and_reported(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    runner = FakeRunner(_reply(VALID, INVENTED, DISTILLED_SCOPE))

    event = _answer(_stream(session, embedder, runner, "balancing feedback loops"))

    assert _spans(event)[0]["cites"] == [VALID, DISTILLED_SCOPE]
    assert event.dropped_cites == [INVENTED]
    assert sorted(event.sources) == [DISTILLED_SCOPE, VALID]
    assert (event.sources[VALID].document.id, event.sources[VALID].anchor) == (
        indexed.meadows.id,
        "ch02/p001",
    )


def test_the_prompt_carries_qualified_evidence_keys(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    runner = FakeRunner(_reply(VALID))

    _stream(session, embedder, runner, "balancing feedback loops")

    prompt = runner.calls[0]["prompt"]
    assert "## Question\n\nbalancing feedback loops" in prompt
    assert f"[{DISTILLED_SCOPE}] chapter_distillation" in prompt
    assert f"Balancing feedback loops stabilize a stock. [{VALID}]" in prompt


def test_a_bare_anchor_is_qualified_when_one_document_is_in_play(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    event = _answer(
        _stream(session, embedder, FakeRunner(_reply("ch02/p001")), "chapter 2 of Meadows")
    )

    assert _spans(event)[0]["cites"] == [VALID]
    assert event.dropped_cites == []


def test_a_malformed_reply_is_retried_once(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    runner = FakeRunner('{"blocks": [{"type": "essay"}]}', _reply(VALID))

    event = _answer(_stream(session, embedder, runner, "balancing feedback loops"))

    assert len(runner.calls) == 2
    assert "Your previous reply was rejected" in runner.calls[1]["prompt"]
    assert _spans(event)[0]["cites"] == [VALID]


def test_a_reply_still_malformed_after_the_retry_ends_in_an_error_event(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    events = _stream(session, embedder, FakeRunner("no json here"), "balancing feedback loops")

    name, payload = events[-1]
    assert name == "error"
    assert isinstance(payload, ErrorEvent)
    assert payload.code == "invalid_output"


def test_no_evidence_means_no_model_call(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    runner = FakeRunner(_reply(VALID))

    events = _stream(session, embedder, runner, '"a phrase that is nowhere"')

    name, payload = events[-1]
    assert (name, getattr(payload, "code", None)) == ("error", "no_evidence")
    assert runner.calls == []
