"""Outline, reading-order blocks, single nodes, and the outline override."""

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.models import Document, Job
from app.models.enums import JobKind, NodeKind
from app.services import tree
from tests.api.factories import make_book, make_document, make_node
from tests.conftest import AUTH

URL = "/api/v1/documents"


def outline(nodes: list[dict[str, Any]]) -> list[Any]:
    """`[(anchor, [children...]), ...]`: the shape of a tree, nothing else."""
    return [(n["anchor"], outline(n["children"])) for n in nodes]


def test_tree_defaults_to_two_container_levels_in_sibling_order(
    client: TestClient, session: Session
):
    book = make_book(session)

    body = client.get(f"{URL}/{book.slug}/tree").json()

    assert body["depth"] == 2
    assert outline(body["nodes"]) == [
        ("ch01", [("ch01/s01", []), ("ch01/s02", [])]),
        ("ch02", []),
    ]
    assert body["nodes"][0]["heading"] == "Heading ch01"


def test_tree_depth_one_returns_top_level_only(client: TestClient, session: Session):
    book = make_book(session)

    body = client.get(f"{URL}/{book.slug}/tree", params={"depth": 1}).json()

    assert outline(body["nodes"]) == [("ch01", []), ("ch02", [])]


def test_tree_with_blocks_includes_leaves(client: TestClient, session: Session):
    book = make_book(session)

    body = client.get(f"{URL}/{book.slug}/tree", params={"depth": 3, "include": "blocks"}).json()

    assert outline(body["nodes"]) == [
        (
            "ch01",
            [
                ("ch01/s01", [("ch01/s01/p001", []), ("ch01/s01/p002", [])]),
                ("ch01/s02", [("ch01/s02/t001", [])]),
            ],
        ),
        ("ch02", [("ch02/f001", []), ("ch02/p001", [])]),
    ]
    assert body["nodes"][1]["children"][0]["meta"]["caption"] == "Figure 2.1 A bathtub"


def test_blocks_are_leaves_in_reading_order_across_chapters(client: TestClient, session: Session):
    book = make_book(session)

    page = client.get(f"{URL}/{book.slug}/blocks").json()

    assert [b["anchor"] for b in page["items"]] == [
        "ch01/s01/p001",
        "ch01/s01/p002",
        "ch01/s02/t001",
        "ch02/f001",
        "ch02/p001",
    ]
    assert page["total"] == 5


def test_blocks_paginate_in_reading_order(client: TestClient, session: Session):
    book = make_book(session)

    page = client.get(f"{URL}/{book.slug}/blocks", params={"limit": 2, "offset": 2}).json()

    assert [b["anchor"] for b in page["items"]] == ["ch01/s02/t001", "ch02/f001"]
    assert page["total"] == 5


def test_anchor_prefix_respects_segment_boundaries(client: TestClient, session: Session):
    document = make_document(session)
    ch03 = make_node(session, document, "ch03", NodeKind.CHAPTER, ordinal=0)
    ch030 = make_node(session, document, "ch030", NodeKind.CHAPTER, ordinal=1)
    make_node(session, document, "ch03/p001", NodeKind.PARAGRAPH, parent=ch03)
    make_node(session, document, "ch030/p001", NodeKind.PARAGRAPH, parent=ch030)

    def anchors(prefix: str) -> list[str]:
        items = client.get(f"{URL}/{document.slug}/blocks", params={"anchor_prefix": prefix})
        return [b["anchor"] for b in items.json()["items"]]

    assert anchors("ch03") == ["ch03/p001"]
    assert anchors("ch030") == ["ch030/p001"]
    assert anchors("ch03/p001") == ["ch03/p001"]
    assert anchors("ch0") == []


def test_node_endpoint_returns_a_container_with_its_subtree(client: TestClient, session: Session):
    book = make_book(session)

    body = client.get(f"/api/v1/nodes/{book.slug}/ch01/s01").json()

    assert outline([body["node"]]) == [("ch01/s01", [("ch01/s01/p001", []), ("ch01/s01/p002", [])])]
    assert body["truncated"] is False
    assert body["node"]["children"][0]["text"] == "Text of ch01/s01/p001."


def test_node_endpoint_returns_a_leaf_alone(client: TestClient, session: Session):
    book = make_book(session)

    body = client.get(f"/api/v1/nodes/{book.id}/ch01/s02/t001").json()

    assert body["node"]["kind"] == "table"
    assert body["node"]["children"] == []
    assert client.get(f"/api/v1/nodes/{book.id}/ch09").status_code == 404


def test_subtree_is_capped_to_a_connected_reading_order_prefix(session: Session):
    book = make_book(session)
    ch01 = tree.get_node(session, book.id, "ch01")

    subtree, truncated = tree.load_subtree(session, ch01, cap=3)

    assert truncated is True
    assert [i.node.anchor for i in subtree.walk()] == ["ch01", "ch01/s01", "ch01/s01/p001"]


OUTLINE = {
    "chapters": [
        {
            "title": "One",
            "page_from": 1,
            "page_to": 10,
            "sections": [{"title": "A", "page_from": 2}],
        },
        {"title": "Two", "page_from": 10, "page_to": 20},
    ]
}


def test_outline_override_is_stored_and_forces_a_reparse(client: TestClient, session: Session):
    document = make_document(session, page_count=20)

    response = client.patch(f"{URL}/{document.slug}/outline", json=OUTLINE, headers=AUTH)

    assert response.status_code == 202
    assert response.json()["job"]["kind"] == "parse"
    session.refresh(document)
    assert document.outline_override is not None
    assert [c["title"] for c in document.outline_override] == ["One", "Two"]
    assert document.outline_override[0]["sections"] == [{"title": "A", "page_from": 2}]
    job = session.exec(select(Job)).one()
    assert (job.kind, job.payload) == (JobKind.PARSE, {"force": True})


def test_empty_outline_clears_the_override(client: TestClient, session: Session):
    document = make_document(session, outline_override=[{"title": "Old"}])

    client.patch(f"{URL}/{document.slug}/outline", json={"chapters": []}, headers=AUTH)

    cleared = session.exec(
        select(Document.id).where(
            Document.id == document.id, col(Document.outline_override).is_(None)
        )
    ).all()
    assert cleared == [document.id]


def chapter(title: str, page_from: int, page_to: int, **extra: Any) -> dict[str, Any]:
    return {"title": title, "page_from": page_from, "page_to": page_to, **extra}


def test_outline_pages_must_increase_and_fit_the_document(client: TestClient, session: Session):
    document = make_document(session, page_count=20)
    invalid = {
        "ends-before-start": [chapter("A", 5, 4)],
        "overlapping-chapters": [chapter("A", 1, 10), chapter("B", 9, 12)],
        "section-outside-chapter": [chapter("A", 1, 5, sections=[{"title": "s", "page_from": 6}])],
        "sections-out-of-order": [
            chapter(
                "A", 1, 9, sections=[{"title": "s", "page_from": 5}, {"title": "t", "page_from": 3}]
            )
        ],
        "past-page-count": [chapter("A", 1, 21)],
    }

    statuses = {
        name: client.patch(
            f"{URL}/{document.slug}/outline", json={"chapters": chapters}, headers=AUTH
        ).status_code
        for name, chapters in invalid.items()
    }

    assert statuses == dict.fromkeys(invalid, 422)
    assert session.exec(select(Job)).all() == []
