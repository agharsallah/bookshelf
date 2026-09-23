"""Applying and withdrawing `concept_links` artifacts (§11), against the real database."""

from sqlmodel import select

from app.graph import apply
from app.models import Concept, Document, Edge, node_ref
from app.models.enums import EdgeStatus, EntityKind, Origin, Relation, Review
from tests.graph.conftest import (
    MakeConcept,
    c,
    concept,
    concept_named,
    edge,
    edges_of,
    links,
    n,
    relations,
    store,
)

LITTLE = links(
    [concept("little's law", "ch01/p001", kind="framework"), concept("wip limit", "ch01/p002")],
    [
        edge(n("ch01/p001"), "defines", c("little's law"), "ch01/p001"),
        edge(c("little's law"), "supports", c("wip limit"), "ch01/p002", weight=0.7),
        edge(c("wip limit"), "same_as", c("little's law"), "ch01/p002", weight=0.4),
    ],
)


def test_apply_creates_concepts_and_qualified_edges_with_the_artifact_origin(session, queueing):
    artifact = store(session, queueing, LITTLE)

    result = apply.apply(session, artifact)

    law = concept_named(session, "little's law")
    assert law.kind.value == "framework"
    assert law.blurb == "What little's law means."
    assert law.blurb_cites == [node_ref(queueing.id, "ch01/p001")]
    assert relations(session) == {
        ("ch01/p001", "defines", "little's law", "accepted"),
        ("little's law", "supports", "wip limit", "accepted"),
        ("wip limit", "same_as", "little's law", "proposed"),
    }
    defines = session.exec(select(Edge).where(Edge.relation == Relation.DEFINES)).one()
    assert (defines.src_kind, defines.src_id) == (EntityKind.NODE, f"{queueing.id}#ch01/p001")
    assert defines.evidence == [f"{queueing.id}#ch01/p001"]
    assert {e.origin for e in edges_of(session)} == {f"skill:link-concepts@1#{artifact.id}"}
    assert sorted(result.created) == sorted(x.id for x in session.exec(select(Concept)).all())


def test_applying_twice_changes_nothing(session, queueing):
    artifact = store(session, queueing, LITTLE)
    apply.apply(session, artifact)
    before = {(e.id, tuple(e.evidence), e.weight) for e in edges_of(session)}

    again = apply.apply(session, artifact)

    assert {(e.id, tuple(e.evidence), e.weight) for e in edges_of(session)} == before
    assert again.created == []
    assert len(session.exec(select(Concept)).all()) == 2


def test_a_known_alias_or_case_variant_reuses_the_existing_concept(
    session, queueing, make_concept: MakeConcept
):
    wip = make_concept("work in progress limit", aliases=["wip limit"])
    body = links(
        [concept("WIP Limit", "ch01/p002", aliases=["wip cap"])],
        [edge(n("ch01/p002"), "mentions", c("wip limit"), "ch01/p002")],
    )

    result = apply.apply(session, store(session, queueing, body))

    assert result.created == []
    assert [x.canonical for x in session.exec(select(Concept)).all()] == [wip.canonical]
    session.refresh(wip)
    assert wip.aliases == ["wip limit", "wip cap"]
    assert relations(session) == {("ch01/p002", "mentions", "work in progress limit", "accepted")}


def test_anchors_missing_from_the_document_are_dropped_and_reported(session, queueing):
    body = links(
        [concept("slack", "ch01/p002")],
        [
            edge(n("ch09/p001"), "defines", c("slack"), "ch01/p002"),  # unknown endpoint
            edge(n("ch01/p002"), "mentions", c("slack"), "ch09/p404", "ch01/p002"),
            edge(n("ch01/p001"), "mentions", c("slack"), "ch09/p404"),  # no valid evidence
            edge(n("ch01/p001"), "supports", c("nothing known"), "ch01/p001"),
        ],
    )

    result = apply.apply(session, store(session, queueing, body))

    assert relations(session) == {("ch01/p002", "mentions", "slack", "accepted")}
    assert edges_of(session)[0].evidence == [f"{queueing.id}#ch01/p002"]
    assert sorted(p.split(":")[0] for p in result.problems) == [f"edges[{i}]" for i in range(4)]


def test_withdrawing_a_document_keeps_what_another_book_backs(
    session, queueing: Document, systems: Document
):
    shared = edge(c("little's law"), "supports", c("stock"), "ch01/p001")
    apply.apply(
        session,
        store(
            session,
            queueing,
            links(
                [concept("little's law", "ch01/p001"), concept("wip limit", "ch01/p002")],
                [shared, edge(n("ch01/p002"), "mentions", c("wip limit"), "ch01/p002")],
            ),
        ),
    )
    theirs = store(
        session,
        systems,
        links([concept("little's law", "ch01/p002"), concept("stock", "ch01/p001")], [shared]),
    )
    apply.apply(session, theirs)

    apply.clear(session, queueing.id)

    assert relations(session) == {("little's law", "supports", "stock", "accepted")}
    remaining = edges_of(session)[0]
    assert remaining.evidence == [f"{systems.id}#ch01/p001"]
    assert remaining.origin == f"skill:link-concepts@1#{theirs.id}"
    assert {x.canonical for x in session.exec(select(Concept)).all()} == {"little's law", "stock"}
    law = concept_named(session, "little's law")
    assert law.blurb_cites == []  # the blurb was the withdrawn book's; nothing re-wrote it


def test_a_status_set_by_a_human_survives_re_application(session, queueing):
    artifact = store(session, queueing, LITTLE)
    apply.apply(session, artifact)
    same_as = session.exec(select(Edge).where(Edge.relation == Relation.SAME_AS)).one()
    same_as.status = EdgeStatus.REJECTED
    session.add(same_as)
    session.commit()

    apply.apply(session, artifact)

    session.refresh(same_as)
    assert same_as.status is EdgeStatus.REJECTED


def test_the_approved_version_is_the_one_in_the_graph(session, queueing):
    store(session, queueing, LITTLE, version=1, review=Review.APPROVED)
    store(
        session,
        queueing,
        links(
            [concept("slack", "ch01/p002")],
            [edge(n("ch01/p002"), "defines", c("slack"), "ch01/p002")],
        ),
        version=2,
    )

    apply.sync_document(session, queueing.id)

    assert {x.canonical for x in session.exec(select(Concept)).all()} == {
        "little's law",
        "wip limit",
    }


def test_unapply_falls_back_to_the_previous_version_or_withdraws_everything(session, queueing):
    old = store(session, queueing, LITTLE, version=1)
    new = store(
        session,
        queueing,
        links(
            [concept("slack", "ch01/p002")],
            [edge(n("ch01/p002"), "defines", c("slack"), "ch01/p002")],
        ),
        version=2,
    )
    apply.sync_document(session, queueing.id)
    assert {x.canonical for x in session.exec(select(Concept)).all()} == {"slack"}

    new.review = Review.REJECTED
    apply.unapply(session, new)
    assert {x.canonical for x in session.exec(select(Concept)).all()} == {
        "little's law",
        "wip limit",
    }
    assert {e.origin for e in edges_of(session)} == {f"skill:link-concepts@1#{old.id}"}

    old.review = Review.REJECTED
    apply.unapply(session, old)
    assert edges_of(session) == []
    assert session.exec(select(Concept)).all() == []


def test_a_new_version_replaces_the_documents_evidence_rather_than_adding_to_it(session, queueing):
    def version(number: int, *evidence: str) -> None:
        body = links(
            [concept("slack", "ch01/p002")],
            [edge(n("ch01/p002"), "defines", c("slack"), *evidence)],
        )
        apply.apply(session, store(session, queueing, body, version=number))

    version(1, "ch01/p001", "ch01/p002")
    version(2, "ch01/p002")

    assert edges_of(session)[0].evidence == [f"{queueing.id}#ch01/p002"]


def test_a_concept_a_human_curated_outlives_the_links_that_used_it(
    session, queueing, make_concept: MakeConcept
):
    slack = make_concept("slack", blurb="My own words.", origin=Origin.HUMAN)
    body = links(
        [concept("slack", "ch01/p002")], [edge(n("ch01/p002"), "defines", c("slack"), "ch01/p002")]
    )
    apply.apply(session, store(session, queueing, body))

    apply.clear(session, queueing.id)

    session.refresh(slack)
    assert (slack.blurb, slack.blurb_cites) == ("My own words.", [])
    assert edges_of(session) == []
