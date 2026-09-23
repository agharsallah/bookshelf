"""Human-confirmed merges repoint edges, combine collisions, and can be undone."""

import pytest
from sqlmodel import select

from app.graph import apply, merge
from app.models import Edge
from app.models.enums import EdgeStatus, Relation
from tests.graph.conftest import c, concept, concept_named, edge, links, n, relations, store


@pytest.fixture
def two_names(session, queueing):
    """`wip cap` and `wip limit` both mentioned by ch01/p002, a proposed same_as between them."""
    body = links(
        [
            concept("wip cap", "ch01/p002", aliases=["cap"]),
            concept("wip limit", "ch01/p002"),
            concept("little's law", "ch01/p001"),
        ],
        [
            edge(n("ch01/p002"), "mentions", c("wip cap"), "ch01/p002", weight=0.5),
            edge(n("ch01/p001"), "mentions", c("wip limit"), "ch01/p001", weight=0.9),
            edge(n("ch01/p002"), "mentions", c("wip limit"), "ch01/p001", weight=0.4),
            edge(c("little's law"), "supports", c("wip cap"), "ch01/p001"),
            edge(c("wip cap"), "extends", c("wip limit"), "ch01/p002"),
            edge(c("wip cap"), "same_as", c("wip limit"), "ch01/p002"),
        ],
    )
    apply.apply(session, store(session, queueing, body))
    return concept_named(session, "wip cap"), concept_named(session, "wip limit")


def test_merge_repoints_edges_and_combines_the_ones_that_collide(session, queueing, two_names):
    loser, survivor = two_names

    merge.merge(session, loser.id, survivor.id)

    assert relations(session) == {
        ("ch01/p001", "mentions", "wip limit", "accepted"),
        ("ch01/p002", "mentions", "wip limit", "accepted"),
        ("little's law", "supports", "wip limit", "accepted"),
        ("wip cap", "same_as", "wip limit", "accepted"),  # the record; `extends` became a loop
    }
    collided = session.exec(
        select(Edge).where(
            Edge.src_id == f"{queueing.id}#ch01/p002", Edge.relation == Relation.MENTIONS
        )
    ).one()
    assert collided.weight == pytest.approx(0.5)
    assert sorted(collided.evidence) == sorted(
        f"{queueing.id}#{a}" for a in ("ch01/p001", "ch01/p002")
    )
    session.refresh(loser)
    session.refresh(survivor)
    assert loser.merged_into == survivor.id
    assert survivor.aliases == ["wip cap", "cap"]


def test_later_skill_output_naming_the_loser_lands_on_the_survivor(session, queueing, two_names):
    loser, survivor = two_names
    merge.merge(session, loser.id, survivor.id)

    body = links(
        [concept("cap", "ch01/p002")], [edge(n("ch01/p002"), "defines", c("cap"), "ch01/p002")]
    )
    apply.apply(session, store(session, queueing, body, version=2))

    assert ("ch01/p002", "defines", "wip limit", "accepted") in relations(session)


def test_a_concept_cannot_be_merged_twice_or_into_itself(session, two_names):
    loser, survivor = two_names
    with pytest.raises(merge.MergeError):
        merge.merge(session, loser.id, loser.id)
    merge.merge(session, loser.id, survivor.id)
    with pytest.raises(merge.MergeError):
        merge.merge(session, loser.id, survivor.id)


def test_unmerge_restores_the_concept_and_its_skill_edges(session, two_names):
    loser, survivor = two_names
    merge.merge(session, loser.id, survivor.id)

    merge.unmerge(session, loser.id)

    session.refresh(survivor)
    assert concept_named(session, "wip cap").merged_into is None
    assert survivor.aliases == []
    assert ("little's law", "supports", "wip cap", "accepted") in relations(session)
    same_as = session.exec(select(Edge).where(Edge.relation == Relation.SAME_AS)).one()
    assert same_as.status is EdgeStatus.PROPOSED
