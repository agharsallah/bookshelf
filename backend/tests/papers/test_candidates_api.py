"""`/papers/candidates` and `/papers/watch`: ranked reads, status rules, jobs for slow work."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import ReadingCandidate
from app.models.enums import CandidateStatus, JobKind
from tests.conftest import AUTH

URL = "/api/v1/papers"


def seed(session: Session, **fields) -> ReadingCandidate:
    row = ReadingCandidate(**({"title": "A paper", "score": 1.0} | fields))
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def test_the_queue_lists_live_candidates_best_first_with_their_breakdown(
    client: TestClient, session: Session
):
    low = seed(session, title="Low", score=0.5)
    high = seed(session, title="High", score=2.5, score_parts={"source": 1.0, "shelf": 1.5})
    seed(session, title="Queued", score=1.0, status=CandidateStatus.QUEUED)
    seed(session, title="Dismissed", score=9.0, status=CandidateStatus.DISMISSED)

    page = client.get(f"{URL}/candidates").json()
    assert [c["title"] for c in page["items"]] == ["High", "Queued", "Low"]
    assert page["total"] == 3 and page["items"][0]["score_parts"] == {"source": 1.0, "shelf": 1.5}
    assert page["items"][0]["id"] == str(high.id) and page["items"][2]["id"] == str(low.id)

    dismissed = client.get(f"{URL}/candidates", params={"status": "dismissed"}).json()
    assert [c["title"] for c in dismissed["items"]] == ["Dismissed"]
    assert client.get(f"{URL}/candidates", params={"status": "bogus"}).status_code == 422


def test_patch_queues_or_dismisses_but_never_marks_ingested(client: TestClient, session: Session):
    row = seed(session)
    url = f"{URL}/candidates/{row.id}"
    assert client.patch(url, json={"status": "dismissed"}).status_code == 401
    response = client.patch(url, json={"status": "dismissed"}, headers=AUTH)
    assert response.status_code == 200 and response.json()["status"] == "dismissed"
    assert client.patch(url, json={"status": "ingested"}, headers=AUTH).status_code == 422
    on_shelf = seed(session, status=CandidateStatus.INGESTED)
    blocked = client.patch(
        f"{URL}/candidates/{on_shelf.id}", json={"status": "queued"}, headers=AUTH
    )
    assert blocked.status_code == 409
    missing = "00000000-0000-0000-0000-000000000000"
    assert (
        client.patch(
            f"{URL}/candidates/{missing}", json={"status": "queued"}, headers=AUTH
        ).status_code
        == 404
    )


def test_ingest_queues_one_fetch_job_per_candidate_and_needs_an_open_pdf(
    client: TestClient, session: Session
):
    row = seed(session, arxiv_id="1706.03762")
    first = client.post(f"{URL}/candidates/{row.id}/ingest", headers=AUTH)
    again = client.post(f"{URL}/candidates/{row.id}/ingest", headers=AUTH)
    assert first.status_code == 202 and first.json()["kind"] == JobKind.PAPER_FETCH
    assert again.json()["id"] == first.json()["id"]
    other = client.post(
        f"{URL}/candidates/{seed(session, pdf_url='https://oa.test/x.pdf').id}/ingest", headers=AUTH
    )
    assert other.json()["id"] != first.json()["id"]
    closed = seed(session)
    assert client.post(f"{URL}/candidates/{closed.id}/ingest", headers=AUTH).status_code == 422
    done = seed(session, arxiv_id="1", status=CandidateStatus.INGESTED)
    assert client.post(f"{URL}/candidates/{done.id}/ingest", headers=AUTH).status_code == 409
    assert client.post(f"{URL}/candidates/{row.id}/ingest").status_code == 401


def test_refresh_and_watch_return_their_jobs(client: TestClient):
    refresh = client.post(f"{URL}/candidates/refresh", headers=AUTH)
    assert refresh.status_code == 202 and refresh.json()["kind"] == JobKind.PAPER_CANDIDATES
    watch = client.post(f"{URL}/watch/refresh", params={"force": "true"}, headers=AUTH)
    assert watch.status_code == 202 and watch.json()["kind"] == JobKind.PAPER_WATCH
    assert client.post(f"{URL}/watch/refresh").status_code == 401
