"""Writes on one paper (meta fix-up, enrich, ratings, passes) and its bibliography."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Job, PaperMeta, PaperReference, ReadingCandidate
from app.models.enums import CandidateStatus, CitationIntent, JobKind
from tests.api.factories import make_document
from tests.conftest import AUTH
from tests.papers.conftest import make_paper

URL = "/api/v1/papers"


def test_meta_fix_up_normalizes_ids_and_marks_the_row_human(client: TestClient, session: Session):
    paper = make_paper(session, "Attention", meta={"venue": "arXiv", "fields": ["ML"]})
    url = f"{URL}/{paper.slug}/meta"
    assert client.patch(url, json={"venue": "NeurIPS"}).status_code == 401

    response = client.patch(
        url,
        json={
            "doi": "https://doi.org/10.5555/ABC",
            "arxiv_id": "arXiv:1706.03762v5",
            "venue": "NeurIPS",
            "fields": None,
        },
        headers=AUTH,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["doi"], body["arxiv_id"], body["venue"]) == (
        "10.5555/abc",
        "1706.03762",
        "NeurIPS",
    )
    assert body["fields"] == [] and body["source"] == "human"
    assert client.get(f"{URL}/{paper.slug}").json()["meta_source"] == "human"


def test_meta_fix_up_creates_the_row_and_rejects_bad_input(client: TestClient, session: Session):
    paper = make_paper(session, "Bare", year=2011)
    url = f"{URL}/{paper.slug}/meta"

    created = client.patch(url, json={"venue": "ICML"}, headers=AUTH)
    assert created.status_code == 200
    row = session.get(PaperMeta, paper.id)
    assert row is not None and (row.venue, row.year, row.source) == ("ICML", 2011, "human")

    bad_doi = client.patch(url, json={"doi": "not a doi"}, headers=AUTH)
    assert bad_doi.status_code == 422
    assert bad_doi.json()["error"]["details"][0]["field"] == "body.doi"
    assert client.patch(url, json={}, headers=AUTH).status_code == 422
    assert client.patch(url, json={"stars": 3}, headers=AUTH).status_code == 422
    book = make_document(session)
    assert (
        client.patch(f"{URL}/{book.slug}/meta", json={"venue": "X"}, headers=AUTH).status_code
        == 404
    )


def test_enrich_queues_one_paper_enrich_job(client: TestClient, session: Session):
    paper = make_paper(session, "Attention")
    url = f"{URL}/{paper.slug}/enrich"
    assert client.post(url).status_code == 401

    first = client.post(url, headers=AUTH)
    again = client.post(url, headers=AUTH)

    assert first.status_code == 202
    assert first.json()["kind"] == "paper_enrich"
    assert first.json()["document_id"] == str(paper.id)
    assert again.json()["id"] == first.json()["id"]  # the live job, not a second one
    jobs = session.exec(select(Job).where(Job.kind == JobKind.PAPER_ENRICH)).all()
    assert len(jobs) == 1
    book = make_document(session)
    assert client.post(f"{URL}/{book.slug}/enrich", headers=AUTH).status_code == 404


def test_ratings_append_and_the_latest_is_the_papers_rating(client: TestClient, session: Session):
    paper = make_paper(session, "Attention")
    url = f"{URL}/{paper.slug}/ratings"
    assert client.post(url, json={"stars": 4}).status_code == 401

    first = client.post(url, json={"stars": 5, "verdict": "must_read"}, headers=AUTH)
    second = client.post(url, json={"stars": 2, "note": "  Overrated.  "}, headers=AUTH)

    assert first.status_code == 201 and second.status_code == 201
    history = client.get(url).json()
    assert [(r["stars"], r["verdict"], r["note"]) for r in history] == [
        (2, None, "Overrated."),
        (5, "must_read", None),
    ]
    assert client.get(f"{URL}/{paper.slug}").json()["rating"]["id"] == second.json()["id"]
    assert client.post(url, json={"stars": 6}, headers=AUTH).status_code == 422
    assert client.post(url, json={"stars": 3, "verdict": "meh"}, headers=AUTH).status_code == 422


def test_passes_are_idempotent_both_ways(client: TestClient, session: Session):
    paper = make_paper(session, "Attention")
    url = f"{URL}/{paper.slug}/passes"
    assert client.put(f"{url}/1", json={}).status_code == 401

    first = client.put(f"{url}/1", json={"note": "Skimmed."}, headers=AUTH)
    again = client.put(f"{url}/1", json={"note": "Skimmed twice."}, headers=AUTH)
    client.put(f"{url}/2", json={}, headers=AUTH)

    assert first.status_code == 200 and first.json()["pass"] == 1
    assert again.json()["completed_at"] == first.json()["completed_at"]
    assert again.json()["note"] == "Skimmed twice."
    detail = client.get(f"{URL}/{paper.slug}").json()
    assert [p["pass"] for p in detail["passes"]] == [1, 2] and detail["highest_pass"] == 2

    assert client.delete(f"{url}/2", headers=AUTH).status_code == 204
    assert client.delete(f"{url}/2", headers=AUTH).status_code == 204
    assert client.get(f"{URL}/{paper.slug}").json()["highest_pass"] == 1
    assert client.put(f"{url}/4", json={}, headers=AUTH).status_code == 422
    assert client.put(f"{url}/0", json={}, headers=AUTH).status_code == 422


def test_references_carry_shelf_match_intent_and_candidate_status(
    client: TestClient, session: Session
):
    paper = make_paper(session, "Citing paper")
    cited = make_paper(session, "Cited on the shelf")
    queued = ReadingCandidate(title="Queued", doi="10.1/q", status=CandidateStatus.QUEUED, score=2)
    dismissed = ReadingCandidate(
        title="Dismissed", openalex_id="W9", status=CandidateStatus.DISMISSED
    )
    by_arxiv = ReadingCandidate(title="Preprint", arxiv_id="2101.00001")
    session.add_all([queued, dismissed, by_arxiv])
    rows = [
        PaperReference(document_id=paper.id, ordinal=3, raw="Three", doi="10.1/Q",
                       intent=CitationIntent.USES),
        PaperReference(document_id=paper.id, ordinal=1, raw="One", target_document_id=cited.id,
                       intent=CitationIntent.EXTENDS),
        PaperReference(document_id=paper.id, ordinal=2, raw="Two", openalex_id="W9",
                       arxiv_id="2101.00001"),
        PaperReference(document_id=paper.id, ordinal=4, raw="Four", arxiv_id="2101.00001"),
        PaperReference(document_id=paper.id, ordinal=5, raw="Five"),
    ]  # fmt: skip
    session.add_all(rows)
    session.commit()
    url = f"{URL}/{paper.slug}/references"

    refs = client.get(url).json()

    assert [r["ordinal"] for r in refs] == [1, 2, 3, 4, 5]
    assert refs[0]["target"] == {"id": str(cited.id), "slug": cited.slug, "title": cited.title}
    assert refs[0]["intent"] == "extends" and refs[0]["candidate"] is None
    assert refs[1]["candidate"]["id"] == str(dismissed.id)  # OpenAlex id before arXiv
    assert refs[1]["candidate"]["status"] == "dismissed"
    assert refs[2]["candidate"] == {"id": str(queued.id), "status": "queued", "score": 2.0}
    assert refs[3]["candidate"]["id"] == str(by_arxiv.id)
    assert refs[4]["candidate"] is None and refs[4]["target"] is None

    assert [r["ordinal"] for r in client.get(url, params={"intent": "uses"}).json()] == [3]
    assert [r["ordinal"] for r in client.get(url, params={"on_shelf": True}).json()] == [1]
    off_shelf = client.get(url, params={"on_shelf": False}).json()
    assert [r["ordinal"] for r in off_shelf] == [2, 3, 4, 5]
    assert client.get(url, params={"intent": "loves"}).status_code == 422
