"""Mention seeds: sections link to the concepts their text names, across books."""

from sqlmodel import Session, select

from app.graph import apply, diagram_seeds, mentions
from app.graph.pipeline import refresh_document
from app.models import Concept, Edge, Node
from app.models.enums import NodeKind
from tests.graph.conftest import (
    MakeConcept,
    add_book,
    c,
    concept,
    concept_named,
    edge,
    links,
    n,
    relations,
    store,
)

FLOW = [
    ("ch01", NodeKind.CHAPTER, "Limits"),
    ("ch01/s01", NodeKind.SECTION, "Caps"),
    ("ch01/s01/p001", NodeKind.PARAGRAPH, "A WIP limit caps work in progress."),
    ("ch01/s01/p002", NodeKind.PARAGRAPH, "Set the wip limits low, then lower."),
    ("ch02", NodeKind.CHAPTER, "Stories"),
    ("ch02/p001", NodeKind.PARAGRAPH, "Stars are bright; a starter is not a framework."),
    ("ch02/p002", NodeKind.PARAGRAPH, "Answer with STAR, and keep work in progress small."),
]
INTERVIEWS = [
    ("ch01", NodeKind.CHAPTER, "Answers"),
    ("ch01/p001", NodeKind.PARAGRAPH, "The STAR method orders a story."),
    ("ch01/p002", NodeKind.PARAGRAPH, "Nothing to see here."),
]


def mention_edges(session: Session) -> dict[tuple[str, str], Edge]:
    names = {str(x.id): x.canonical for x in session.exec(select(Concept)).all()}
    return {
        (e.src_id.split("#")[1], names[e.dst_id]): e
        for e in session.exec(select(Edge)).all()
        if e.origin == mentions.MENTION_ORIGIN
    }


def test_sections_link_to_the_concepts_they_name(session, make_concept: MakeConcept):
    flow = add_book(session, "flow", FLOW)
    make_concept("work in progress limit", aliases=["wip limit"])
    make_concept("work in progress", aliases=["wip"])
    make_concept("star")

    mentions.seed_document(session, flow.id)
    mentions.seed_document(session, flow.id)  # idempotent

    found = mention_edges(session)
    assert set(found) == {
        ("ch01/s01", "work in progress limit"),  # `WIP limit`, `wip limits`: the longer name
        ("ch01/s01", "work in progress"),  # `work in progress`, not the `WIP` inside `WIP limit`
        ("ch02", "star"),  # `STAR` only: `Stars` and `starter` are words, not the acronym
        ("ch02", "work in progress"),
    }
    cap = found[("ch01/s01", "work in progress limit")]
    assert cap.evidence == [f"{flow.id}#ch01/s01/p001", f"{flow.id}#ch01/s01/p002"]
    assert cap.meta == {"count": 2}
    assert cap.weight == mentions.mention_weight(2) == 0.3
    assert found[("ch02", "star")].evidence == [f"{flow.id}#ch02/p002"]


def test_blocks_the_skill_already_linked_are_not_counted_again(session):
    flow = add_book(session, "flow", FLOW)
    apply.apply(
        session,
        store(
            session,
            flow,
            links(
                [concept("star", "ch02/p002", kind="framework")],
                [edge(n("ch02/p002"), "defines", c("star"), "ch02/p002")],
            ),
        ),
    )

    mentions.seed_document(session, flow.id)

    assert ("ch02", "star") not in mention_edges(session)


def test_a_section_that_stops_naming_a_concept_loses_its_edge(session, make_concept):
    flow = add_book(session, "flow", FLOW)
    make_concept("star")
    mentions.seed_document(session, flow.id)
    block = session.exec(select(Node).where(Node.anchor == "ch02/p002")).one()
    block.text = "Answer with a story."
    session.add(block)
    session.commit()

    mentions.seed_document(session, flow.id)

    assert mention_edges(session) == {}


def test_a_new_concept_is_found_in_the_other_books_too(session):
    flow = add_book(session, "flow", FLOW)
    interviews = add_book(session, "interviews", INTERVIEWS)
    store(
        session,
        flow,
        links(
            [concept("star", "ch02/p002", kind="framework")],
            [edge(n("ch02/p002"), "defines", c("star"), "ch02/p002")],
        ),
    )

    refresh_document(session, flow.id)

    (only,) = mention_edges(session).values()
    assert only.src_id == f"{interviews.id}#ch01"
    assert only.dst_id == str(concept_named(session, "star").id)


def test_mentions_never_keep_a_withdrawn_concept_alive(session):
    flow = add_book(session, "flow", FLOW)
    add_book(session, "interviews", INTERVIEWS)
    artifact = store(
        session,
        flow,
        links(
            [concept("star", "ch02/p002", kind="framework")],
            [edge(n("ch02/p002"), "defines", c("star"), "ch02/p002")],
        ),
    )
    refresh_document(session, flow.id)
    assert mention_edges(session)

    apply.unapply(session, artifact)

    assert session.exec(select(Concept)).all() == []
    assert relations(session) == set()


def test_diagram_seeding_leaves_mention_edges_alone(session, make_concept):
    flow = add_book(session, "flow", FLOW)
    make_concept("star")
    mentions.seed_document(session, flow.id)

    diagram_seeds.seed_document(session, flow.id)

    assert set(mention_edges(session)) == {("ch02", "star")}
