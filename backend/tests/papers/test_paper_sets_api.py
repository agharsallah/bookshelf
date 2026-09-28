"""`/paper-sets`: sets of papers, the synthesis job, versions, review and cite sources."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import PaperSynthesis
from app.models.enums import JobKind, Review
from tests.api.factories import make_book
from tests.conftest import AUTH
from tests.papers.conftest import make_paper

URL = "/api/v1/paper-sets"


def create(client: TestClient, *ids: object, name: str = "Readers") -> dict:
    response = client.post(URL, json={"name": name, "document_ids": [str(i) for i in ids]},
                           headers=AUTH)  # fmt: skip
    assert response.status_code == 201, response.text
    return response.json()


def synthesis(session: Session, set_id: str, version: int, **fields) -> PaperSynthesis:
    row = PaperSynthesis(
        set_id=set_id, version=version, origin="skill:synthesize-papers@1",
        input_hash=f"h{version}", body={"blocks": [], "table": {}}, **fields,
    )  # fmt: skip
    session.add(row)
    session.commit()
    return row


def test_a_set_keeps_its_order_drops_duplicates_and_lists_its_members(
    client: TestClient, session: Session
):
    a, b = make_paper(session, "A", stars=4), make_paper(session, "B")

    made = create(client, b.id, a.id, b.id)

    assert made["document_ids"] == [str(b.id), str(a.id)]
    detail = client.get(f"{URL}/{made['id']}").json()
    assert [m["title"] for m in detail["members"]] == ["B", "A"]
    assert detail["members"][1]["rating"]["stars"] == 4 and detail["synthesis"] is None
    listing = client.get(URL).json()
    assert listing["total"] == 1 and listing["items"][0]["name"] == "Readers"


def test_a_set_takes_only_papers_on_the_shelf(client: TestClient, session: Session):
    book = make_book(session)
    paper = make_paper(session, "A")

    response = client.post(URL, json={"name": "x", "document_ids": [str(paper.id), str(book.id)]},
                           headers=AUTH)  # fmt: skip

    assert response.status_code == 422
    assert str(book.id) in response.json()["error"]["message"]


def test_synthesis_is_a_job_deduplicated_while_queued(client: TestClient, session: Session):
    made = create(client, make_paper(session, "A").id, make_paper(session, "B").id)

    first = client.post(f"{URL}/{made['id']}/synthesis", headers=AUTH)
    again = client.post(f"{URL}/{made['id']}/synthesis", headers=AUTH)

    assert first.status_code == 202 and first.json()["kind"] == JobKind.SYNTHESIZE_PAPERS
    assert again.json()["id"] == first.json()["id"]
    assert first.json()["payload"] == {"set_id": made["id"]}


def test_a_forced_synthesis_is_not_folded_into_a_queued_plain_one(
    client: TestClient, session: Session
):
    made = create(client, make_paper(session, "A").id, make_paper(session, "B").id)

    plain = client.post(f"{URL}/{made['id']}/synthesis", headers=AUTH).json()
    forced = client.post(f"{URL}/{made['id']}/synthesis?force=true", headers=AUTH).json()

    assert forced["id"] != plain["id"] and forced["payload"]["force"] is True


def test_a_one_paper_set_cannot_be_synthesized(client: TestClient, session: Session):
    made = create(client, make_paper(session, "A").id)
    assert client.post(f"{URL}/{made['id']}/synthesis", headers=AUTH).status_code == 422


def test_the_latest_approved_synthesis_is_served_with_its_sources(
    client: TestClient, session: Session
):
    a, b = make_paper(session, "A"), make_paper(session, "B")
    made = create(client, a.id, b.id)
    assert client.get(f"{URL}/{made['id']}/synthesis").status_code == 404
    synthesis(session, made["id"], 1, citations=[f"{a.slug}:ch01/p001", "gone:ch01/p001"])
    synthesis(session, made["id"], 2)

    latest = client.get(f"{URL}/{made['id']}/synthesis").json()
    assert latest["version"] == 2 and latest["review"] == "draft"

    approved = client.post(f"{URL}/{made['id']}/synthesis/1/review", json={"verdict": "approve"},
                           headers=AUTH)  # fmt: skip
    assert approved.status_code == 200 and approved.json()["review"] == Review.APPROVED
    served = client.get(f"{URL}/{made['id']}/synthesis").json()
    assert served["version"] == 1
    assert served["sources"] == {
        f"{a.slug}:ch01/p001": {
            "document": {"id": str(a.id), "slug": a.slug, "title": "A", "authors": []},
            "anchor": "ch01/p001",
        }
    }
    assert client.get(f"{URL}/{made['id']}").json()["synthesis"]["version"] == 1

    client.post(f"{URL}/{made['id']}/synthesis/2/review", json={"verdict": "reject"}, headers=AUTH)
    assert client.get(f"{URL}/{made['id']}/synthesis?version=2").json()["review"] == "rejected"
    missing = client.post(f"{URL}/{made['id']}/synthesis/9/review", json={"verdict": "approve"},
                          headers=AUTH)  # fmt: skip
    assert missing.status_code == 404


def test_deleting_a_set_deletes_its_syntheses_but_not_its_papers(
    client: TestClient, session: Session
):
    a, b = make_paper(session, "A"), make_paper(session, "B")
    made = create(client, a.id, b.id)
    row_id = synthesis(session, made["id"], 1).id

    assert client.delete(f"{URL}/{made['id']}", headers=AUTH).status_code == 204
    assert client.delete(f"{URL}/{made['id']}", headers=AUTH).status_code == 204

    assert client.get(f"{URL}/{made['id']}").status_code == 404
    session.expire_all()
    assert session.get(PaperSynthesis, row_id) is None
    assert client.get(f"/api/v1/papers/{a.slug}").status_code == 200


def test_writes_need_the_api_key(client: TestClient):
    assert client.post(URL, json={"name": "x", "document_ids": []}).status_code == 401
