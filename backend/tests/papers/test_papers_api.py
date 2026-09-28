"""`GET /papers` and `GET /papers/{ref}`: the shelf row, filters, sorts, facets, 404s."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.db.session import engine
from app.models import Claim, Document, PaperPass, PaperRating, PaperReference
from app.models.enums import (
    ArtifactType,
    ClaimKind,
    ClaimStrength,
    DocumentStatus,
    PaperVerdict,
    Review,
)
from tests.api.factories import make_artifact, make_document
from tests.papers.conftest import make_paper

URL = "/api/v1/papers"


def rate(session: Session, paper: Document, stars: int, *, days_ago: int, **fields) -> None:
    created = datetime.now(UTC) - timedelta(days=days_ago)
    session.add(PaperRating(document_id=paper.id, stars=stars, created_at=created, **fields))
    session.commit()


def passed(session: Session, paper: Document, *numbers: int) -> None:
    session.add_all(PaperPass(document_id=paper.id, pass_=n) for n in numbers)
    session.commit()


def titles(response) -> list[str]:
    assert response.status_code == 200, response.text
    return [p["title"] for p in response.json()["items"]]


@contextmanager
def counting_queries() -> Iterator[list[str]]:
    statements: list[str] = []

    def record(_conn, _cursor, statement, *_args) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def test_a_shelf_row_carries_meta_latest_rating_pass_artifacts_and_counts(
    client: TestClient, session: Session
):
    paper = make_paper(
        session,
        "Attention",
        meta={"venue": "NeurIPS", "year": 2017, "doi": "10.1/attn", "cited_by_count": 90},
        year=2016,
    )
    make_document(session, title="A book")  # genre book: not on the paper shelf
    rate(session, paper, 5, days_ago=3, verdict=PaperVerdict.MUST_READ)
    rate(session, paper, 3, days_ago=1, verdict=PaperVerdict.SKIM, note="Less than I hoped.")
    passed(session, paper, 1, 2)
    approved = make_artifact(session, paper, type=ArtifactType.PAPER_CARD)
    make_artifact(session, paper, type=ArtifactType.PAPER_CARD, review=Review.DRAFT, version=2)
    make_artifact(session, paper, type=ArtifactType.CLAIM_SET, review=Review.REJECTED)
    for level in ("newcomer", "expert"):
        make_artifact(
            session, paper, type=ArtifactType.PAPER_EXPLAINER, variant=level, review=Review.DRAFT
        )
    make_artifact(session, paper, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch01")
    claim_set = make_artifact(session, paper, type=ArtifactType.CLAIM_SET, version=2)
    session.add(
        Claim(
            document_id=paper.id,
            artifact_id=claim_set.id,
            key="C1",
            text="Attention suffices.",
            kind=ClaimKind.RESULT,
            strength=ClaimStrength.MEASURED,
            evidence=["ch01/p001"],
        )
    )
    session.add_all(
        PaperReference(document_id=paper.id, ordinal=n, raw=f"Ref {n}") for n in (1, 2, 3)
    )
    session.commit()

    page = client.get(URL).json()

    assert page["total"] == 1 and len(page["items"]) == 1
    row = page["items"][0]
    assert row["slug"] == paper.slug and row["year"] == 2017  # meta year wins
    assert (row["venue"], row["doi"], row["cited_by_count"]) == ("NeurIPS", "10.1/attn", 90)
    assert row["meta_source"] == "parsed"
    assert row["rating"]["stars"] == 3 and row["rating"]["verdict"] == "skim"
    assert row["highest_pass"] == 2
    states = {(a["type"], a["variant"]): a for a in row["artifacts"]}
    assert set(states) == {
        ("paper_card", None),
        ("paper_explainer", "expert"),
        ("paper_explainer", "newcomer"),
        ("claim_set", None),
    }
    assert states[("paper_card", None)]["artifact_id"] == str(approved.id)
    assert states[("paper_card", None)]["review"] == "approved"
    assert states[("claim_set", None)]["artifact_id"] == str(claim_set.id)
    assert row["counts"] == {"references": 3, "references_on_shelf": 0, "claims": 1}


def test_the_listing_reads_a_fixed_number_of_queries_whatever_the_page_size(
    client: TestClient, session: Session
):
    def queries() -> int:
        with counting_queries() as statements:
            assert client.get(URL).status_code == 200
        return len(statements)

    for n in range(2):
        paper = make_paper(session, f"Paper {n}", stars=4)
        make_artifact(session, paper, type=ArtifactType.PAPER_CARD)
    few = queries()
    for n in range(6):
        paper = make_paper(session, f"More {n}", stars=2)
        make_artifact(session, paper, type=ArtifactType.PAPER_CARD)
        passed(session, paper, 1)

    assert queries() == few


def test_filters_narrow_the_shelf(client: TestClient, session: Session):
    vaswani = make_paper(session, "Attention is all you need", meta={"venue": "NeurIPS"})
    vaswani.authors = ["Ashish Vaswani"]
    session.add(vaswani)
    session.commit()
    bert = make_paper(session, "BERT", meta={"venue": "NAACL", "year": 2019}, year=2018)
    unrated = make_paper(session, "Unrated", year=2019)
    unrated.status = DocumentStatus.DISTILLED
    session.add(unrated)
    session.commit()
    rate(session, vaswani, 5, days_ago=2, verdict=PaperVerdict.MUST_READ)
    rate(session, bert, 5, days_ago=5)
    rate(session, bert, 2, days_ago=1, verdict=PaperVerdict.SKIP)  # latest wins
    passed(session, vaswani, 1, 3)
    passed(session, bert, 1)

    def only(**params) -> list[str]:
        return sorted(titles(client.get(URL, params=params)))

    assert only(q="vaswani") == ["Attention is all you need"]  # author
    assert only(q="bert") == ["BERT"]  # title
    assert only(venue="neurips") == ["Attention is all you need"]
    assert only(year=2019) == ["BERT", "Unrated"]  # meta year, else the document's
    assert only(min_stars=4) == ["Attention is all you need"]
    assert only(verdict="skip") == ["BERT"]
    assert only(**{"pass": 3}) == ["Attention is all you need"]
    assert only(**{"pass": 1}) == ["BERT"]  # the highest pass, not any pass
    assert only(**{"pass": 0}) == ["Unrated"]
    assert only(status="distilled") == ["Unrated"]
    assert client.get(URL, params={"pass": 4}).status_code == 422
    assert client.get(URL, params={"verdict": "meh"}).status_code == 422

    narrowed = client.get(URL, params={"min_stars": 4}).json()
    assert narrowed["total"] == 1
    assert narrowed["facets"]["venues"] == [
        {"value": "NAACL", "count": 1},
        {"value": "NeurIPS", "count": 1},
    ]  # facets span the whole shelf, not the filter
    assert narrowed["facets"]["years"] == [
        {"value": 2020, "count": 1},
        {"value": 2019, "count": 2},
    ]


def test_sorts_order_the_shelf_with_unknowns_last(client: TestClient, session: Session):
    old = make_paper(session, "b old", year=2001, meta={"cited_by_count": 5})
    new = make_paper(session, "C new", year=2024, meta={"cited_by_count": 500})
    unknown = make_paper(session, "a unknown", year=None)
    rate(session, old, 4, days_ago=1)
    rate(session, new, 2, days_ago=1)

    def order(sort: str) -> list[str]:
        return titles(client.get(URL, params={"sort": sort}))

    assert order("recent") == ["a unknown", "C new", "b old"]
    assert order("title") == ["a unknown", "b old", "C new"]
    assert order("year") == ["C new", "b old", "a unknown"]
    assert order("stars") == ["b old", "C new", "a unknown"]
    assert order("cited_by") == ["C new", "b old", "a unknown"]
    assert client.get(URL, params={"sort": "random"}).status_code == 422

    page = client.get(URL, params={"sort": "title", "limit": 1, "offset": 1}).json()
    assert [p["title"] for p in page["items"]] == ["b old"] and page["total"] == 3
    assert unknown.id  # listed despite no year and no meta


def test_one_paper_by_slug_or_id_with_full_meta_and_passes(client: TestClient, session: Session):
    paper = make_paper(
        session,
        "Attention",
        meta={
            "abstract": "We propose the Transformer.",
            "fields": ["Machine learning"],
            "code_urls": ["https://github.com/x/y"],
        },
    )
    passed(session, paper, 2, 1)

    by_slug = client.get(f"{URL}/{paper.slug}").json()
    by_id = client.get(f"{URL}/{paper.id}").json()

    assert by_slug == by_id
    assert by_slug["meta"]["abstract"] == "We propose the Transformer."
    assert by_slug["meta"]["fields"] == ["Machine learning"]
    assert by_slug["meta"]["code_urls"] == ["https://github.com/x/y"]
    assert [p["pass"] for p in by_slug["passes"]] == [1, 2]
    assert by_slug["highest_pass"] == 2 and by_slug["rating"] is None


def test_a_paper_without_meta_still_reads(client: TestClient, session: Session):
    paper = make_paper(session, "Bare", year=1999)

    body = client.get(f"{URL}/{paper.slug}").json()

    assert body["meta"] is None and body["meta_source"] is None and body["year"] == 1999
    assert body["counts"] == {"references": 0, "references_on_shelf": 0, "claims": 0}


def test_a_book_or_a_missing_ref_is_not_a_paper(client: TestClient, session: Session):
    book = make_document(session)

    for ref in (book.slug, str(book.id), "no-such-paper"):
        response = client.get(f"{URL}/{ref}")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"
    for path in ("ratings", "references"):
        assert client.get(f"{URL}/{book.slug}/{path}").status_code == 404
