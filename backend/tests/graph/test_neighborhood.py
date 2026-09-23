"""Neighborhoods: one focus, depth ≤ 2, accepted edges, ranked, capped, merged concepts hidden."""

import uuid

from sqlmodel import Session

from app.graph.merge import merge
from app.graph.neighborhood import neighborhood
from app.graph.refs import Ref
from app.models import Concept, Document, Edge
from app.models.enums import EdgeStatus, EntityKind, Relation
from tests.graph.conftest import MakeConcept


def link(
    session: Session,
    src: Ref,
    dst: Ref,
    *,
    weight: float = 1.0,
    evidence: int = 1,
    status: EdgeStatus = EdgeStatus.ACCEPTED,
    relation: Relation = Relation.SUPPORTS,
) -> Edge:
    doc = uuid.uuid4()
    row = Edge(
        src_kind=src.kind,
        src_id=src.id,
        dst_kind=dst.kind,
        dst_id=dst.id,
        relation=relation,
        weight=weight,
        status=status,
        origin="human",
        evidence=[f"{doc}#ch01/p{i:03d}" for i in range(evidence)],
    )
    session.add(row)
    session.commit()
    return row


def ref(concept: Concept) -> Ref:
    return Ref.concept(concept.id)


def ids(refs: list) -> set[str]:
    return {str(r.ref if hasattr(r, "ref") else r) for r in refs}


def test_depth_bounds_the_walk_and_labels_come_from_concepts(session, make_concept: MakeConcept):
    a, b, z = make_concept("a"), make_concept("b"), make_concept("z")
    link(session, ref(a), ref(b))
    link(session, ref(z), ref(b))  # direction does not matter for the walk

    one = neighborhood(session, ref(a), depth=1)
    two = neighborhood(session, ref(a), depth=2)

    assert ids(one.nodes) == {str(ref(a)), str(ref(b))}
    assert ids(two.nodes) == {str(ref(a)), str(ref(b)), str(ref(z))}
    assert {n.label.label for n in two.nodes if n.label} == {"a", "b", "z"}
    assert [n.more for n in one.nodes if n.ref == ref(b)] == [1]  # z is behind "show more"


def test_proposed_edges_are_walked_only_on_request(session, make_concept: MakeConcept):
    a, b = make_concept("a"), make_concept("b")
    link(session, ref(a), ref(b), status=EdgeStatus.PROPOSED)
    link(session, ref(b), ref(a), status=EdgeStatus.REJECTED, relation=Relation.EXTENDS)

    assert ids(neighborhood(session, ref(a)).nodes) == {str(ref(a))}
    shown = neighborhood(session, ref(a), include_proposed=True)
    assert [(e.relation, e.status) for e in shown.edges] == [
        (Relation.SUPPORTS, EdgeStatus.PROPOSED)
    ]


def test_the_cap_keeps_the_strongest_neighbors_and_says_it_cut(session, make_concept: MakeConcept):
    hub = make_concept("hub")
    leaves = [make_concept(f"leaf {i}") for i in range(4)]
    for i, leaf in enumerate(leaves):  # score = weight x evidence: 0.5, 1.0, 1.5, 2.0
        link(session, ref(hub), ref(leaf), weight=0.5, evidence=i + 1)

    hood = neighborhood(session, ref(hub), cap=3)

    assert hood.truncated is True
    assert [str(n.ref) for n in hood.nodes] == [str(ref(x)) for x in (hub, leaves[3], leaves[2])]
    assert [e.score for e in hood.edges] == [2.0, 1.5]
    assert hood.nodes[0].more == 2


def test_merged_concepts_disappear_and_resolve_to_their_survivor(
    session, make_concept: MakeConcept
):
    loser, survivor, other = make_concept("wip cap"), make_concept("wip limit"), make_concept("x")
    link(session, ref(loser), ref(survivor), relation=Relation.SAME_AS)
    link(session, ref(other), ref(loser))
    merge(session, loser.id, survivor.id)

    hood = neighborhood(session, ref(survivor), depth=2)

    assert ids(hood.nodes) == {str(ref(survivor)), str(ref(other))}
    assert [(str(e.src), str(e.dst)) for e in hood.edges] == [(str(ref(other)), str(ref(survivor)))]


def test_a_document_focus_folds_its_passages_into_the_document(
    session, queueing: Document, make_concept: MakeConcept
):
    law = make_concept("little's law")
    for anchor in ("ch01/p001", "ch01/p002"):
        link(session, Ref.node(queueing.id, anchor), ref(law), relation=Relation.MENTIONS)

    hood = neighborhood(session, Ref(EntityKind.DOCUMENT, str(queueing.id)))

    assert ids(hood.nodes) == {f"document:{queueing.id}", str(ref(law))}
    [folded] = hood.edges
    assert (folded.src, folded.evidence_count, len(folded.edge_ids)) == (hood.focus, 2, 2)
    assert hood.nodes[0].label is not None and hood.nodes[0].label.label == queueing.title
