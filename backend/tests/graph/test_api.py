"""Concept and graph endpoints against the real app and database."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.graph import apply
from app.models import Concept, Document, Edge
from app.models.enums import EdgeStatus
from tests.conftest import AUTH
from tests.graph.conftest import MakeConcept, c, concept, concept_named, edge, links, n, store

API = "/api/v1"


@pytest.fixture
def linked(session: Session, queueing: Document, systems: Document) -> Concept:
    """`little's law`, defined in one book and used in another, plus a proposed same_as."""
    apply.apply(
        session,
        store(
            session,
            queueing,
            links(
                [
                    concept("little's law", "ch01/p001", kind="framework"),
                    concept("wip cap", "ch01/p002"),
                ],
                [
                    edge(n("ch01/p001"), "defines", c("little's law"), "ch01/p001"),
                    edge(c("wip cap"), "same_as", c("little's law"), "ch01/p002", weight=0.5),
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
    return concept_named(session, "little's law")


def test_typeahead_ranks_exact_then_prefix_then_alias_then_substring(
    client: TestClient, make_concept: MakeConcept
):
    make_concept("flow efficiency")
    make_concept("flow")
    make_concept("cumulative flow", aliases=["cfd"])
    make_concept("throughput", aliases=["flow rate"])
    make_concept("slack")

    page = client.get(f"{API}/concepts", params={"q": "Flow"}).json()

    assert [i["canonical"] for i in page["items"]] == [
        "flow",
        "flow efficiency",
        "throughput",
        "cumulative flow",
    ]
    assert page["total"] == 4


def test_a_concept_page_carries_evidence_from_every_book(
    client: TestClient, linked: Concept, queueing: Document, systems: Document
):
    body = client.get(f"{API}/concepts/{linked.id}").json()

    groups = {g["relation"]: g["edges"] for g in body["relations"]}
    assert set(groups) == {"defines", "mentions", "same_as"}
    [mention] = groups["mentions"]
    assert mention["direction"] == "in"
    assert mention["other"]["id"] == f"node:{systems.id}#ch01/p002"
    [passage] = mention["evidence"]
    assert passage["document"] == {
        "id": str(systems.id),
        "slug": systems.slug,
        "title": systems.title,
    }
    assert (passage["anchor"], passage["heading"]) == ("ch01/p002", "Stocks")
    assert passage["snippet"] == "Little's law holds for any stable stock."
    assert groups["defines"][0]["evidence"][0]["document"]["slug"] == queueing.slug
    assert [p["document"]["slug"] for p in body["blurb_passages"]] == [queueing.slug]


def test_neighborhood_returns_labelled_nodes_and_ranked_edges(
    client: TestClient, linked: Concept, systems: Document
):
    body = client.get(f"{API}/graph/neighborhood", params={"node": str(linked.id)}).json()

    assert body["focus"] == f"concept:{linked.id}"
    assert body["truncated"] is False
    nodes = {n["id"]: n for n in body["nodes"]}
    passage = nodes[f"node:{systems.id}#ch01/p002"]
    assert (passage["kind"], passage["anchor"], passage["document"]["slug"]) == (
        "node",
        "ch01/p002",
        systems.slug,
    )
    assert {e["relation"] for e in body["edges"]} == {"defines", "mentions"}  # same_as is proposed
    missing = client.get(f"{API}/graph/neighborhood", params={"node": f"concept:{uuid.uuid4()}"})
    assert missing.status_code == 404


WRITES = [
    ("post", "/concepts", {"canonical": "x"}),
    ("patch", "/concepts/{id}", {"canonical": "y"}),
    ("post", "/concepts/{id}/merge", {"into": "{id}"}),
    ("post", "/edges", {}),
    ("patch", "/edges/{edge}", {"status": "rejected"}),
    ("delete", "/edges/{edge}", None),
]


@pytest.mark.parametrize(("method", "path", "payload"), WRITES)
def test_writes_without_the_api_key_are_401_and_change_nothing(
    client: TestClient, session: Session, linked: Concept, method: str, path: str, payload
):
    an_edge = session.exec(select(Edge)).first()
    assert an_edge is not None
    url = API + path.format(id=linked.id, edge=an_edge.id)

    response = client.request(method, url, json=payload)

    assert response.status_code == 401
    session.refresh(an_edge)
    assert an_edge.status is EdgeStatus.ACCEPTED
    assert concept_named(session, "little's law").merged_into is None


def test_human_concepts_cannot_take_an_existing_name_and_renames_keep_the_old_one(
    client: TestClient, linked: Concept
):
    clash = client.post(f"{API}/concepts", json={"canonical": "Little's Law"}, headers=AUTH)
    assert clash.status_code == 409

    renamed = client.patch(
        f"{API}/concepts/{linked.id}", json={"canonical": "law of queues"}, headers=AUTH
    ).json()
    assert (renamed["canonical"], renamed["aliases"]) == ("law of queues", ["little's law"])


def test_a_hand_drawn_edge_needs_real_evidence_and_is_deleted_outright(
    client: TestClient, linked: Concept, systems: Document, make_concept: MakeConcept
):
    stock = make_concept("stock")
    draft = {"src": f"concept:{linked.id}", "dst": str(stock.id), "relation": "extends"}

    bad = client.post(
        f"{API}/edges", json={**draft, "evidence": [f"{systems.id}#ch09/p001"]}, headers=AUTH
    )
    made = client.post(
        f"{API}/edges", json={**draft, "evidence": [f"{systems.id}#ch01/p001"]}, headers=AUTH
    )

    assert bad.status_code == 422
    assert made.status_code == 201
    assert made.json()["dst"]["label"] == "stock"
    assert made.json()["evidence"][0]["snippet"].startswith("A stock is")
    edge_id = made.json()["id"]
    assert client.delete(f"{API}/edges/{edge_id}", headers=AUTH).status_code == 204
    assert client.get(f"{API}/edges/{edge_id}").status_code == 404


def test_deleting_a_machine_edge_rejects_it(client: TestClient, session: Session, linked: Concept):
    machine = session.exec(select(Edge).where(Edge.status == EdgeStatus.ACCEPTED)).first()
    assert machine is not None

    assert client.delete(f"{API}/edges/{machine.id}", headers=AUTH).status_code == 204

    assert client.get(f"{API}/edges/{machine.id}").json()["status"] == "rejected"


def test_a_merge_proposal_is_listed_then_applied_by_a_human(
    client: TestClient, session: Session, linked: Concept
):
    [proposal] = client.get(f"{API}/concepts/merge-proposals").json()
    assert {proposal["a"]["canonical"], proposal["b"]["canonical"]} == {"wip cap", "little's law"}
    assert proposal["similarity"] is None  # a skill proposal, not a dedup verdict

    survivor = client.post(
        f"{API}/concepts/{proposal['a']['id']}/merge",
        json={"into": proposal["b"]["id"]},
        headers=AUTH,
    ).json()

    assert survivor["id"] == str(linked.id)
    assert "wip cap" in survivor["aliases"]
    assert client.get(f"{API}/concepts/merge-proposals").json() == []
    again = client.post(
        f"{API}/concepts/{proposal['a']['id']}/merge",
        json={"into": proposal["b"]["id"]},
        headers=AUTH,
    )
    assert again.status_code == 409
