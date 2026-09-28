"""The papers migration (docs/PAPERS.md §2): check constraints, the rating trigger (D11),
cascades, and the widened vocabularies, against the real schema."""

import re
from enum import StrEnum

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.models import (
    Artifact,
    Claim,
    PaperPass,
    PaperRating,
    PaperSet,
    PaperSynthesis,
    ReadingCandidate,
)
from app.models.enums import (
    ArtifactType,
    CandidateStatus,
    CitationIntent,
    ClaimKind,
    ClaimStrength,
    ConceptKind,
    EntityKind,
    Genre,
    JobKind,
    PaperMetaSource,
    PaperVerdict,
    Relation,
    Review,
)
from tests.api.factories import make_artifact, make_document

# (table, constraint) → the enum it must mirror exactly.
MIRRORS: list[tuple[str, str, type[StrEnum]]] = [
    ("documents", "documents_genre_check", Genre),
    ("artifacts", "artifacts_type_check", ArtifactType),
    ("jobs", "jobs_kind_check", JobKind),
    ("concepts", "concepts_kind_check", ConceptKind),
    ("edges", "edges_src_kind_check", EntityKind),
    ("edges", "edges_dst_kind_check", EntityKind),
    ("edges", "edges_relation_check", Relation),
    ("paper_meta", "paper_meta_source_check", PaperMetaSource),
    ("paper_references", "paper_references_intent_check", CitationIntent),
    ("claims", "claims_kind_check", ClaimKind),
    ("claims", "claims_strength_check", ClaimStrength),
    ("paper_ratings", "paper_ratings_verdict_check", PaperVerdict),
    ("reading_candidates", "reading_candidates_status_check", CandidateStatus),
    ("paper_syntheses", "paper_syntheses_review_check", Review),
]


def _values(session: Session, table: str, name: str) -> set[str]:
    definition = session.execute(
        text(
            "select pg_get_constraintdef(oid) from pg_constraint "
            "where conrelid = cast(:t as regclass) and conname = :n"
        ),
        {"t": table, "n": name},
    ).scalar_one()
    return set(re.findall(r"'([a-z_]+)'::text", definition))


@pytest.mark.parametrize(("table", "name", "enum"), MIRRORS, ids=[m[1] for m in MIRRORS])
def test_each_check_constraint_mirrors_its_enum(
    session: Session, table: str, name: str, enum: type[StrEnum]
):
    assert _values(session, table, name) == {member.value for member in enum}


def _fails(session: Session, sql: str, **params: object) -> None:
    with pytest.raises(DBAPIError):
        session.execute(text(sql), params)
    session.rollback()


def test_genre_defaults_to_book_and_rejects_other_values(session: Session):
    document = make_document(session)
    assert document.genre is Genre.BOOK
    _fails(session, "update documents set genre = 'novel' where id = :id", id=document.id)


@pytest.mark.parametrize("stars", [0, 6])
def test_stars_run_from_one_to_five(session: Session, stars: int):
    document = make_document(session)
    session.add(PaperRating(document_id=document.id, stars=stars))
    with pytest.raises(DBAPIError):
        session.commit()
    session.rollback()


def test_a_rating_is_never_edited_only_superseded_or_deleted(session: Session):
    document = make_document(session)
    rating = PaperRating(
        document_id=document.id, stars=4, verdict=PaperVerdict.USEFUL, note="Mine."
    )
    session.add(rating)
    session.commit()

    with pytest.raises(DBAPIError, match="immutable"):
        session.execute(
            text("update paper_ratings set note = 'Theirs.' where id = :id"), {"id": rating.id}
        )
    session.rollback()
    with pytest.raises(DBAPIError, match="immutable"):
        session.execute(
            text("update paper_ratings set stars = 1 where id = :id"), {"id": rating.id}
        )
    session.rollback()

    session.execute(text("delete from paper_ratings where id = :id"), {"id": rating.id})
    session.commit()
    assert session.exec(select(PaperRating)).all() == []


def test_a_claim_needs_evidence(session: Session):
    document = make_document(session)
    artifact = make_artifact(session, document, type=ArtifactType.CLAIM_SET)
    claim = Claim(
        document_id=document.id,
        artifact_id=artifact.id,
        key="C1",
        text="Attention suffices.",
        kind=ClaimKind.RESULT,
        strength=ClaimStrength.MEASURED,
        evidence=[],
    )
    session.add(claim)
    with pytest.raises(DBAPIError):
        session.commit()
    session.rollback()


def test_claims_go_with_their_claim_set(session: Session):
    document = make_document(session)
    artifact = make_artifact(session, document, type=ArtifactType.CLAIM_SET)
    session.add(
        Claim(
            document_id=document.id,
            artifact_id=artifact.id,
            key="C1",
            text="Attention suffices.",
            kind=ClaimKind.RESULT,
            strength=ClaimStrength.MEASURED,
            evidence=["ch02/p003"],
        )
    )
    session.commit()

    session.delete(session.get(Artifact, artifact.id))
    session.commit()
    assert session.exec(select(Claim)).all() == []


def test_passes_run_from_one_to_three_and_map_the_pass_column(session: Session):
    document = make_document(session)
    session.add(PaperPass(document_id=document.id, pass_=2, note="Body read."))
    session.commit()
    assert session.execute(text("select pass from paper_passes")).scalar_one() == 2

    session.add(PaperPass(document_id=document.id, pass_=4))
    with pytest.raises(DBAPIError):
        session.commit()
    session.rollback()


def test_candidate_sources_must_be_a_list_and_updates_touch_updated_at(session: Session):
    candidate = ReadingCandidate(title="BERT", sources=[{"kind": "reference"}])
    session.add(candidate)
    session.commit()
    before = candidate.updated_at

    session.execute(
        text("update reading_candidates set status = 'queued' where id = :id"), {"id": candidate.id}
    )
    session.commit()
    session.refresh(candidate)
    assert candidate.status is CandidateStatus.QUEUED
    assert candidate.updated_at > before

    _fails(
        session,
        "update reading_candidates set sources = '{}'::jsonb where id = :id",
        id=candidate.id,
    )


def test_a_synthesis_belongs_to_its_set(session: Session):
    ids = [make_document(session).id, make_document(session).id]
    paper_set = PaperSet(name="Attention", document_ids=ids)
    session.add(paper_set)
    session.commit()
    session.add(
        PaperSynthesis(
            set_id=paper_set.id, version=1, body={"blocks": []}, origin="skill:x@1", input_hash="h"
        )
    )
    session.commit()
    session.refresh(paper_set)
    assert paper_set.document_ids == ids

    session.delete(paper_set)
    session.commit()
    assert session.exec(select(PaperSynthesis)).all() == []
