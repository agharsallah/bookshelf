"""Search by intent: two-tier hybrid, filters, addressed tree fetches, Postgres lexical."""

from collections.abc import Sequence
from typing import Any

from qdrant_client import QdrantClient
from sqlmodel import Session

from app.models.enums import ArtifactType
from app.retrieval import search
from app.retrieval.embedding import FakeEmbedder
from app.retrieval.router import QueryRouter
from app.schemas.search import SearchFilters, SearchRequest, SearchResponse
from tests.retrieval.conftest import Shelf


def _search(session: Session, embedder: FakeEmbedder, query: str, **request: Any) -> SearchResponse:
    body = SearchRequest(query=query, **request)
    return search.run(session, body, router=QueryRouter(), embedder=embedder).response


def _hits(response: SearchResponse) -> list[tuple[str, str, str | None]]:
    return [(g.document.slug, h.kind, h.anchor) for g in response.groups for h in g.hits]


class NoVectors(FakeEmbedder):
    """Fails the test if anything is embedded or reranked."""

    def dense_query(self, text: str) -> list[float]:
        raise AssertionError("addressed queries must not embed")

    def rerank(self, query: str, docs: Sequence[str]) -> list[float]:
        raise AssertionError("addressed queries must not rerank")


def test_discovery_groups_distillations_with_their_scoped_evidence(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(session, embedder, "balancing feedback loops stabilize a stock")

    assert response.intent == "discovery"
    top = response.groups[0]
    assert (top.document.slug, top.document.title) == ("meadows-systems", "Thinking in Systems")
    assert top.document.authors == ["Donella Meadows"]
    assert top.hits[0].kind == "distillation"
    assert top.hits[0].type is ArtifactType.CHAPTER_DISTILLATION
    evidence = [h.anchor for h in top.hits if h.kind == "block"]
    assert evidence  # tier 2 found blocks, and only under the distilled chapter
    assert all(a is not None and a.startswith("ch02/") for a in evidence)


def test_hits_are_ordered_by_reranker_score(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(session, embedder, "feedback loops delays oscillation organizations")

    assert response.groups[0].document.slug == "senge-fifth-discipline"
    scores = [h.score for h in response.groups[0].hits]
    assert scores == sorted(scores, reverse=True)


def test_document_and_tag_filters_restrict_the_groups(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    by_id = _search(
        session, embedder, "feedback loops", filters=SearchFilters(document_ids=[indexed.senge.id])
    )
    by_tag = _search(session, embedder, "feedback loops", filters=SearchFilters(tags=["systems"]))

    assert {g.document.slug for g in by_id.groups} == {"senge-fifth-discipline"}
    assert {g.document.slug for g in by_tag.groups} == {"meadows-systems"}


def test_without_matching_distillations_blocks_are_searched_directly(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    only_summaries = SearchFilters(types=[ArtifactType.CHAPTER_SUMMARY])  # none approved
    response = _search(session, embedder, "bathtub inflow outflow", filters=only_summaries)

    assert ("meadows-systems", "block", "ch01/s01/p002") in _hits(response)
    assert all(kind == "block" for _, kind, _ in _hits(response))


def test_synthesis_returns_every_named_book(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(session, embedder, "compare Meadows and Senge on feedback loops", limit=1)

    assert response.intent == "synthesis"
    assert {g.document.slug for g in response.groups} == {
        "meadows-systems",
        "senge-fifth-discipline",
    }


def test_addressed_returns_the_node_and_its_approved_artifacts_without_vectors(
    session: Session, shelf: Shelf, qdrant: QdrantClient
) -> None:
    response = _search(session, NoVectors(), "summarize chapter 2 of Meadows")

    assert response.intent == "addressed"
    assert response.resolved is not None
    assert (response.resolved.document.slug, response.resolved.anchor) == (
        "meadows-systems",
        "ch02",
    )
    node, artifact = response.groups[0].hits
    assert (node.kind, node.anchor, node.heading) == ("block", "ch02", "Feedback Loops")
    assert (artifact.kind, artifact.type, artifact.artifact_id) == (
        "distillation",
        ArtifactType.CHAPTER_DISTILLATION,
        shelf.distillation.id,
    )
    assert artifact.blocks == shelf.distillation.body["blocks"]


def test_lexical_finds_the_exact_phrase_with_highlight_ranges(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(session, embedder, 'find "inflow exceeds outflow"')

    assert response.intent == "lexical"
    assert _hits(response) == [("meadows-systems", "block", "ch01/s01/p002")]
    hit = response.groups[0].hits[0]
    assert [hit.snippet[a:b] for a, b in hit.highlights or []] == ["inflow", "exceeds", "outflow"]


def test_lexical_quotes_require_the_words_in_order(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    quoted = _search(session, embedder, '"outflow exceeds inflow"')
    any_order = _search(session, embedder, "outflow exceeds inflow", mode="lexical")

    assert quoted.groups == []
    assert _hits(any_order) == [("meadows-systems", "block", "ch01/s01/p002")]


def test_lexical_respects_tag_filters(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(
        session, embedder, '"feedback loops"', filters=SearchFilters(tags=["management"])
    )

    assert {g.document.slug for g in response.groups} == {"senge-fifth-discipline"}
