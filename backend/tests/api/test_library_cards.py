"""Library cards on `GET /documents`: each document's preferred catalogue_entry, if any."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.enums import ArtifactType, Review
from tests.api.factories import make_artifact, make_document

URL = "/api/v1/documents"


def entry(theme: str, **facts: object) -> dict:
    return {
        "theme": {"name": theme, "new": False},
        "subjects": ["Interviews", "Storytelling"],
        "form": "practical guide",
        "audience": "Engineers preparing for interviews",
        "level": "introductory",
        "description": "How to tell your work as stories that interviewers can score.",
        "facts": {
            "publisher": None,
            "published": 2025,
            "edition": None,
            "isbn": None,
            "language": "en",
            "series": None,
            **facts,
        },
        "cites": ["ch00/p001"],
    }


def test_the_list_carries_each_documents_card_and_none_without_one(
    client: TestClient, session: Session
):
    carded, bare = make_document(session), make_document(session)
    kind = ArtifactType.CATALOGUE_ENTRY
    make_artifact(session, carded, type=kind, body=entry("Career", isbn="9781234567897"),
                  skill="catalogue-document")  # fmt: skip
    make_artifact(session, carded, type=kind, body=entry("Careers"), version=2,
                  review=Review.DRAFT, skill="catalogue-document")  # fmt: skip

    cards = {d["slug"]: d["catalogue"] for d in client.get(URL).json()["items"]}

    assert cards[bare.slug] is None
    assert cards[carded.slug] == {
        "theme": "Career",  # the approved version, over the newer draft
        "subjects": ["Interviews", "Storytelling"],
        "form": "practical guide",
        "audience": "Engineers preparing for interviews",
        "level": "introductory",
        "description": "How to tell your work as stories that interviewers can score.",
        "publisher": None,
        "published": 2025,
        "edition": None,
        "isbn": "9781234567897",
        "language": "en",
        "series": None,
        "draft": False,
    }
    assert client.get(f"{URL}/{carded.slug}").json()["catalogue"]["theme"] == "Career"
