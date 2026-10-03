"""Settings: reading and changing the study material a distilled document makes itself."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Job
from app.models.enums import ArtifactType, JobKind, Review
from app.pipeline import orchestrator
from tests.conftest import AUTH
from tests.papers.paper_fixtures import add_paper
from tests.papers.paper_fixtures import store as store_paper
from tests.pipeline.runtime.conftest import add_document
from tests.pipeline.runtime.test_orchestrator import store


def choices(client: TestClient, group: str) -> dict[str, bool]:
    body = client.get("/api/v1/settings").json()
    return {c["skill"]: c["enabled"] for c in body["auto_derive"][group]}


def change(client: TestClient, **lists: list[str]):
    return client.patch("/api/v1/settings", json={"auto_derive": lists}, headers=AUTH)


def derived(session: Session) -> set[str]:
    jobs = session.exec(select(Job).where(Job.kind == JobKind.DERIVE)).all()
    return {j.skill for j in jobs if j.skill}


def test_a_new_install_makes_nothing_for_books_and_everything_for_papers(client):
    assert not any(choices(client, "book").values())
    assert choices(client, "paper")["assess-paper"] is True
    assert "make-quiz" in choices(client, "book")
    assert "write-guide" not in choices(client, "book")  # a fixed stage, not a choice
    assert "write-audio-summary" not in choices(client, "book")  # needs a cast per run


def test_a_paper_skill_is_not_offered_for_books(client):
    assert "assess-paper" not in choices(client, "book")


def test_choices_are_saved_and_other_groups_left_alone(client):
    assert change(client, book=["make-quiz", "make-faq"]).status_code == 200

    assert {s for s, on in choices(client, "book").items() if on} == {"make-quiz", "make-faq"}
    assert choices(client, "paper")["assess-paper"] is True


def test_a_skill_the_group_cannot_run_is_refused(client):
    for name in ("write-guide", "assess-paper", "no-such-skill"):
        assert change(client, book=[name]).status_code == 422


def test_changing_settings_needs_the_api_key(client):
    response = client.patch("/api/v1/settings", json={"auto_derive": {"book": []}})

    assert response.status_code == 401


def test_an_approved_brief_queues_the_chosen_book_material(client, session):
    change(client, book=["make-quiz", "make-glossary"])
    book = add_document(session)

    orchestrator.on_review(
        session, store(session, book, ArtifactType.BOOK_BRIEF, None, Review.APPROVED)
    )

    assert derived(session) == {"make-quiz", "make-glossary"}


def test_an_approved_brief_queues_no_study_material_by_default(session):
    book = add_document(session)

    orchestrator.on_review(
        session, store(session, book, ArtifactType.BOOK_BRIEF, None, Review.APPROVED)
    )

    assert derived(session) == set()


def test_an_approved_card_queues_only_the_chosen_paper_material(client, session):
    change(client, paper=["assess-paper"])
    paper = add_paper(session)

    orchestrator.on_review(
        session, store_paper(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED)
    )

    assert derived(session) == {"assess-paper"}


def test_auto_approve_is_off_until_changed_and_leaves_auto_derive_alone(client):
    assert client.get("/api/v1/settings").json()["auto_approve"] == "off"
    change(client, book=["make-quiz"])

    response = client.patch("/api/v1/settings", json={"auto_approve": "all"}, headers=AUTH)

    assert response.json()["auto_approve"] == "all"
    assert client.get("/api/v1/settings").json()["auto_approve"] == "all"
    assert choices(client, "book")["make-quiz"] is True


def test_an_unknown_auto_approve_mode_is_refused(client):
    response = client.patch("/api/v1/settings", json={"auto_approve": "yes"}, headers=AUTH)

    assert response.status_code == 422
