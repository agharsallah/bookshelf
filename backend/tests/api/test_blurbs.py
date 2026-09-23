"""Library-card blurbs on `GET /documents`: summary, else thesis, else first chapter."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Document
from app.models.enums import ArtifactType, Review
from tests.api.factories import make_artifact, make_book

URL = "/api/v1/documents"


def para(text: str) -> dict:
    return {"type": "paragraph", "spans": [{"text": text, "cites": []}]}


def blurbs(client: TestClient) -> dict[str, str | None]:
    return {d["slug"]: d["blurb"] for d in client.get(URL).json()["items"]}


def summary(session: Session, doc: Document, kind: ArtifactType, *blocks: dict, **kw) -> None:
    make_artifact(session, doc, type=kind, body={"blocks": list(blocks)}, **kw)


def test_each_card_takes_the_best_approved_source(client: TestClient, session: Session):
    summarized, briefed, chaptered, bare = (make_book(session) for _ in range(4))
    summary(session, summarized, ArtifactType.BOOK_SUMMARY, {"type": "heading", "text": "x"},
            para("Stocks and flows,"), para("second paragraph"))  # fmt: skip
    summary(session, summarized, ArtifactType.BOOK_SUMMARY, para("A newer draft."), version=2,
            review=Review.DRAFT)  # fmt: skip
    thesis = {"key": "thesis", "blocks": [para("Structure drives behaviour.")]}
    brief = {"sections": [{"key": "ideas", "blocks": [para("no")]}, thesis]}
    make_artifact(session, briefed, type=ArtifactType.BOOK_BRIEF, body=brief)
    summary(session, chaptered, ArtifactType.CHAPTER_SUMMARY, para("Chapter two."), anchor="ch02")
    summary(session, chaptered, ArtifactType.CHAPTER_SUMMARY, para("Chapter one."), anchor="ch01")

    assert blurbs(client) == {
        summarized.slug: "Stocks and flows,",
        briefed.slug: "Structure drives behaviour.",
        chaptered.slug: "Chapter one.",  # the first chapter in reading order
        bare.slug: None,
    }


def test_long_blurbs_are_clipped_at_a_word(client: TestClient, session: Session):
    doc = make_book(session)
    summary(session, doc, ArtifactType.BOOK_SUMMARY, para("feedback " * 60))

    blurb = client.get(f"{URL}/{doc.slug}").json()["blurb"]

    assert len(blurb) <= 280 and blurb.endswith("feedback…")
