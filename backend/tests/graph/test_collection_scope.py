"""`?collection=` narrows the atlas, the concept list and neighborhoods to its documents."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.graph import apply
from app.models import Document
from tests.conftest import AUTH
from tests.graph.conftest import c, concept, concept_named, edge, links, n, store


@pytest.fixture
def shelf(session: Session, queueing: Document, systems: Document) -> None:
    """`little's law` in both books; `wip limit` only in queueing, tied to little's law by a
    concept-to-concept edge."""
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
                    edge(c("wip limit"), "supports", c("little's law"), "ch01/p002"),
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


@pytest.fixture
def only_systems(client: TestClient, shelf: None, systems: Document) -> str:
    response = client.post(
        "/api/v1/collections",
        json={"name": "Systems", "document_ids": [str(systems.id)]},
        headers=AUTH,
    )
    return response.json()["slug"]


def labels(view: dict, kind: str) -> set[str]:
    return {node["label"] for node in view["nodes"] if node["kind"] == kind}


def test_the_atlas_keeps_the_collections_books_and_the_concepts_they_touch(
    client: TestClient, only_systems: str
):
    whole = client.get("/api/v1/graph/atlas").json()
    scoped = client.get("/api/v1/graph/atlas", params={"collection": only_systems}).json()

    assert labels(whole, "concept") == {"little's law", "wip limit"}
    assert labels(scoped, "document") == {"Meadows Systems"}
    # wip limit reaches in only through a concept-to-concept edge: it stays out.
    assert labels(scoped, "concept") == {"little's law"}
    assert {node["sublabel"] for node in scoped["nodes"] if node["kind"] == "chapter"} == {
        "Meadows Systems"
    }


def test_the_concept_list_keeps_concepts_linked_to_the_collection(
    client: TestClient, only_systems: str
):
    scoped = client.get("/api/v1/concepts", params={"collection": only_systems}).json()

    assert [item["canonical"] for item in scoped["items"]] == ["little's law"]


def test_a_neighborhood_drops_passages_outside_the_collection(
    client: TestClient, session: Session, only_systems: str, systems: Document
):
    focus = f"concept:{concept_named(session, "little's law").id}"

    whole = client.get("/api/v1/graph/neighborhood", params={"node": focus}).json()
    scoped = client.get(
        "/api/v1/graph/neighborhood", params={"node": focus, "collection": only_systems}
    ).json()

    whole_refs = {node["id"] for node in whole["nodes"]}
    scoped_refs = {node["id"] for node in scoped["nodes"]}
    assert scoped_refs < whole_refs
    assert all(r.startswith(("concept:", f"node:{systems.id}#")) for r in scoped_refs), scoped_refs
    assert all(e["src"] in scoped_refs and e["dst"] in scoped_refs for e in scoped["edges"])
