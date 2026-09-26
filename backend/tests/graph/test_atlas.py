"""The atlas: the whole shelf at chapter grain, with derived structure and shared-idea lines."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.graph import apply, merge
from app.graph.atlas import atlas, chapter_anchor, share_weight
from app.models import Document
from tests.graph.conftest import c, concept, concept_named, edge, links, n, store


def lines(session: Session, **kw) -> set[tuple[str, str, str]]:
    """(src, relation, dst) by label; `shares` is undirected, so its ends come sorted."""
    view = atlas(session, **kw)
    label = {node.ref: node.label for node in view.nodes}
    out = set()
    for e in view.edges:
        a, b = label[e.src], label[e.dst]
        if e.relation == "shares":
            a, b = sorted((a, b))
        out.add((a, e.relation, b))
    return out


@pytest.fixture
def shelf(session: Session, queueing: Document, systems: Document) -> None:
    """`little's law` in both books; `wip limit` only in queueing; one proposed same_as."""
    apply.apply(
        session,
        store(
            session,
            queueing,
            links(
                [concept("little's law", "ch01/p001"), concept("wip limit", "ch01/p002")],
                [
                    edge(n("ch01/p001"), "defines", c("little's law"), "ch01/p001"),
                    edge(n("ch01/p002"), "mentions", c("wip limit"), "ch01/p002"),
                    edge(n("ch02/s01/p001"), "mentions", c("wip limit"), "ch02/s01/p001"),
                    edge(c("wip limit"), "supports", c("little's law"), "ch01/p002"),
                    edge(c("wip limit"), "same_as", c("little's law"), "ch01/p002"),
                ],
            ),
        ),
    )
    apply.apply(
        session,
        store(
            session,
            systems,
            links(
                [concept("little's law", "ch01/p002")],
                [edge(n("ch01/p002"), "mentions", c("little's law"), "ch01/p002")],
            ),
        ),
    )


def test_passages_fold_into_chapters_under_their_books(session, shelf):
    assert lines(session) == {
        ("Okafor Queueing", "contains", "Queues"),
        ("Okafor Queueing", "contains", "Flow"),
        ("Meadows Systems", "contains", "Stocks"),
        ("Queues", "defines", "little's law"),
        ("Queues", "mentions", "wip limit"),
        ("Flow", "mentions", "wip limit"),  # ch02/s01/p001 folds up to ch02, past its section
        ("Stocks", "mentions", "little's law"),
        ("wip limit", "supports", "little's law"),
        ("Queues", "shares", "Stocks"),  # both lean on little's law, across books
        ("Flow", "shares", "Queues"),  # both lean on wip limit
    }


def test_nodes_say_where_they_belong_and_how_far_they_reach(session, shelf, queueing):
    view = atlas(session)
    by_label = {node.label: node for node in view.nodes}
    law = by_label["little's law"]
    assert (law.kind, len(law.books), law.passages) == ("concept", 2, 2)
    assert len(by_label["wip limit"].books) == 1
    queues = by_label["Queues"]
    assert (queues.kind, queues.ref, queues.anchor) == (
        "chapter",
        f"node:{queueing.id}#ch01",
        "ch01",
    )
    assert [node.kind for node in view.nodes][:2] == ["document", "document"]
    assert view.truncated is False


def test_proposed_edges_only_on_request(session, shelf):
    assert ("wip limit", "same_as", "little's law") not in lines(session)
    assert ("wip limit", "same_as", "little's law") in lines(session, include_proposed=True)


def test_merged_concepts_leave_the_map(session, shelf):
    loser = concept_named(session, "wip limit")
    merge.merge(session, loser.id, concept_named(session, "little's law").id)

    labels = {node.label for node in atlas(session).nodes}
    assert "wip limit" not in labels
    assert ("Flow", "mentions", "little's law") in lines(session)


def test_a_rare_shared_idea_binds_harder_than_a_common_one():
    assert share_weight(2) > share_weight(10)
    assert chapter_anchor("ch02/s01/p001", {"ch01", "ch02"}) == "ch02"
    assert chapter_anchor("pt01/ch03/p001", {"pt01/ch03"}) == "pt01/ch03"
    assert chapter_anchor("fm01/p002", set()) == "fm01"


def test_the_atlas_endpoint(client: TestClient, shelf):
    body = client.get("/api/v1/graph/atlas").json()
    kinds = {node["kind"] for node in body["nodes"]}
    assert kinds == {"document", "chapter", "concept"}
    shares = [e for e in body["edges"] if e["relation"] == "shares"]
    assert shares and all(e["concepts"] for e in shares)
    chapter = next(node for node in body["nodes"] if node["kind"] == "chapter")
    assert chapter["document"]["slug"] and chapter["anchor"]
