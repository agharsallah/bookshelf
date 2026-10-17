"""Search by intent: two-tier hybrid, filters, addressed tree fetches, Postgres lexical."""

from collections.abc import Sequence
from typing import Any

import pytest
from qdrant_client import QdrantClient
from sqlmodel import Session

from app.core.config import get_settings
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


def test_with_vector_search_off_discovery_is_unavailable_without_embedding(
    session: Session, indexed: Shelf, monkeypatch: pytest.MonkeyPatch
) -> None:
    off = get_settings().model_copy(update={"vector_search": False})
    monkeypatch.setattr(search, "get_settings", lambda: off)

    response = _search(session, NoVectors(), "balancing feedback loops stabilize a stock")

    assert (response.intent, response.index_state, response.groups) == (
        "discovery",
        "unavailable",
        [],
    )


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


def test_the_cross_encoder_decides_the_order_across_both_tiers(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    # The Senge passage names both terms; its chapter distillation only one of them.
    response = _search(session, embedder, "delays organizations")

    top = response.groups[0]
    assert top.document.slug == "senge-fifth-discipline"
    assert [(h.kind, h.anchor) for h in top.hits] == [
        ("block", "ch02/p001"),
        ("distillation", "ch02"),
    ]
    assert top.hits[0].score > top.hits[1].score


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


@pytest.mark.parametrize(
    "quoted",
    ['"outflow exceeds inflow"', '"inflow outflow"', '"inflows exceed outflows"'],
    ids=["order", "adjacency", "exact-words-not-stems"],
)
def test_quoted_phrases_match_only_the_exact_words_in_order(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, quoted: str
) -> None:
    assert _search(session, embedder, quoted).groups == []


def test_unquoted_lexical_mode_matches_all_terms_in_any_order(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(session, embedder, "outflows exceed inflow", mode="lexical")

    assert _hits(response) == [("meadows-systems", "block", "ch01/s01/p002")]


def test_lexical_respects_tag_filters(
    session: Session, shelf: Shelf, embedder: FakeEmbedder
) -> None:
    response = _search(
        session, embedder, '"feedback loops"', filters=SearchFilters(tags=["management"])
    )

    assert {g.document.slug for g in response.groups} == {"senge-fifth-discipline"}


def test_a_deleted_document_never_comes_back_from_vector_search(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    from app.services.documents import delete_document

    delete_document(session, indexed.meadows)
    response = _search(session, embedder, "balancing feedback loops stabilize a stock")

    assert {g.document.slug for g in response.groups} == {"senge-fifth-discipline"}


def test_an_archived_document_is_left_out_of_vector_and_lexical_search(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    """Its points stay in the index until the purge job runs; search must not wait for it."""
    from app.services.archive import archive

    archive(session, indexed.meadows)
    vector = _search(session, embedder, "balancing feedback loops stabilize a stock")
    lexical = _search(session, embedder, 'find "inflow exceeds outflow"')

    assert {g.document.slug for g in vector.groups} == {"senge-fifth-discipline"}
    assert lexical.groups == []


def test_vector_hits_carry_the_document_metadata_postgres_has_now(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
) -> None:
    indexed.meadows.title = "Thinking in Systems: A Primer"  # edited after indexing
    session.add(indexed.meadows)
    session.commit()

    response = _search(session, embedder, "balancing feedback loops stabilize a stock")

    assert response.groups[0].document.title == "Thinking in Systems: A Primer"
