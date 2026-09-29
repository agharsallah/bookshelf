"""`/collections`: hand-gathered groups of books, papers and articles, their order and notes,
and the `?collection=` filter on the document list."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.enums import Genre
from tests.api.factories import make_book, make_document
from tests.conftest import AUTH

URL = "/api/v1/collections"


def create(client: TestClient, name: str = "Fine-tuning", *ids: object, **extra) -> dict:
    body = {"name": name, "document_ids": [str(i) for i in ids], **extra}
    response = client.post(URL, json=body, headers=AUTH)
    assert response.status_code == 201, response.text
    return response.json()


def test_a_collection_mixes_genres_in_reading_order_and_drops_duplicates(
    client: TestClient, session: Session
):
    book = make_book(session, title="Deep Learning")
    paper = make_document(session, title="LoRA", genre=Genre.PAPER)
    article = make_document(session, title="A blog post", genre=Genre.ARTICLE)

    made = create(client, "Fine-tuning", paper.id, book.id, article.id, paper.id)

    assert made["slug"] == "fine-tuning"
    assert made["document_ids"] == [str(paper.id), str(book.id), str(article.id)]
    detail = client.get(f"{URL}/fine-tuning").json()
    assert [m["document"]["title"] for m in detail["members"]] == [
        "LoRA",
        "Deep Learning",
        "A blog post",
    ]
    assert [m["position"] for m in detail["members"]] == [0, 1, 2]
    assert detail["members"][1]["document"]["counts"]["chapters"] >= 1


def test_writes_need_the_api_key(client: TestClient):
    assert client.post(URL, json={"name": "x"}).status_code == 401


def test_unknown_documents_are_refused(client: TestClient):
    response = client.post(
        URL,
        json={"name": "x", "document_ids": ["00000000-0000-0000-0000-000000000001"]},
        headers=AUTH,
    )

    assert response.status_code == 422
    assert "00000000-0000-0000-0000-000000000001" in response.json()["error"]["message"]


def test_slugs_are_unique_and_survive_a_rename(client: TestClient):
    first = create(client, "Fine-tuning")
    second = create(client, "Fine tuning")

    renamed = client.patch(
        f"{URL}/{first['id']}", json={"name": "RLHF and friends"}, headers=AUTH
    ).json()

    assert second["slug"] == "fine-tuning-2"
    assert renamed["name"] == "RLHF and friends" and renamed["slug"] == "fine-tuning"


def test_patch_changes_only_what_is_sent_and_null_clears(client: TestClient):
    made = create(client, "Fine-tuning", description="Adapters first", colour="ochre")

    kept = client.patch(f"{URL}/{made['slug']}", json={"colour": "teal"}, headers=AUTH).json()
    cleared = client.patch(
        f"{URL}/{made['slug']}", json={"description": None, "name": None}, headers=AUTH
    ).json()

    assert kept["description"] == "Adapters first" and kept["colour"] == "teal"
    assert cleared["description"] is None and cleared["name"] == "Fine-tuning"


def test_members_join_at_the_end_keep_their_note_and_close_gaps_on_removal(
    client: TestClient, session: Session
):
    a, b, c = (make_book(session, title=t) for t in "ABC")
    made = create(client, "Fine-tuning", a.id, b.id)
    member = f"{URL}/{made['slug']}/members"

    added = client.put(f"{member}/{c.id}", json={"note": "the survey"}, headers=AUTH).json()
    again = client.put(f"{member}/{c.id}", headers=AUTH).json()  # no body: note stays
    assert client.delete(f"{member}/{a.id}", headers=AUTH).status_code == 204
    assert client.delete(f"{member}/{a.id}", headers=AUTH).status_code == 204  # idempotent

    assert added["position"] == 2 and again["note"] == "the survey"
    detail = client.get(f"{URL}/{made['slug']}").json()
    assert [(m["document"]["title"], m["position"]) for m in detail["members"]] == [
        ("B", 0),
        ("C", 1),
    ]


def test_reorder_needs_every_member_exactly_once(client: TestClient, session: Session):
    a, b = make_book(session), make_book(session)
    made = create(client, "Fine-tuning", a.id, b.id)
    order = f"{URL}/{made['slug']}/order"

    partial = client.put(order, json={"document_ids": [str(a.id)]}, headers=AUTH)
    swapped = client.put(order, json={"document_ids": [str(b.id), str(a.id)]}, headers=AUTH)

    assert partial.status_code == 422
    assert swapped.json()["document_ids"] == [str(b.id), str(a.id)]


def test_deleting_a_document_or_a_collection_tidies_memberships(
    client: TestClient, session: Session
):
    a, b = make_book(session), make_book(session)
    made = create(client, "Fine-tuning", a.id, b.id)

    assert client.delete(f"/api/v1/documents/{a.id}", headers=AUTH).status_code == 204
    assert client.get(f"{URL}/{made['slug']}").json()["document_ids"] == [str(b.id)]

    assert client.delete(f"{URL}/{made['slug']}", headers=AUTH).status_code == 204
    assert client.get(f"{URL}/{made['slug']}").status_code == 404
    assert client.get(f"/api/v1/documents/{b.id}").status_code == 200


def test_list_is_by_name_and_can_ask_which_collections_hold_a_document(
    client: TestClient, session: Session
):
    a, b = make_book(session), make_book(session)
    create(client, "rlhf", a.id)
    create(client, "Adapters", a.id, b.id)
    create(client, "Empty")

    everything = client.get(URL).json()
    holding_b = client.get(URL, params={"document_id": str(b.id)}).json()

    assert [c["name"] for c in everything] == ["Adapters", "Empty", "rlhf"]
    assert [c["name"] for c in holding_b] == ["Adapters"]
    assert holding_b[0]["document_ids"] == [str(a.id), str(b.id)]


def test_the_document_list_filters_by_collection(client: TestClient, session: Session):
    inside, _outside = make_book(session, title="Inside"), make_book(session, title="Outside")
    create(client, "Fine-tuning", inside.id)
    create(client, "Empty")

    scoped = client.get("/api/v1/documents", params={"collection": "fine-tuning"}).json()
    empty = client.get("/api/v1/documents", params={"collection": "empty"}).json()
    missing = client.get("/api/v1/documents", params={"collection": "nope"})

    assert [d["title"] for d in scoped["items"]] == ["Inside"] and scoped["total"] == 1
    assert empty["total"] == 0
    assert missing.status_code == 404
