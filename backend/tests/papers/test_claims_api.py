"""The claim tracker's API (docs/PAPERS.md §7): claims with relation counts, one claim's
relations, the reader's margin marks, and queueing the cross-paper pass."""

import uuid

from sqlmodel import Session, select

from app.models import Edge, Job
from app.models.enums import EdgeStatus, EntityKind, JobKind, Relation
from tests.conftest import AUTH
from tests.papers.claim_fixtures import ATTENTION, PARALLEL, RECURRENT, claims_of, two_papers


def relate_by_hand(session: Session, src: str, dst: str, relation: Relation, status: EdgeStatus,
                   evidence: list[str]) -> Edge:  # fmt: skip
    edge = Edge(src_kind=EntityKind.CLAIM, src_id=src, dst_kind=EntityKind.CLAIM, dst_id=dst,
                relation=relation, status=status, evidence=evidence, origin="skill:relate-claims@1",
                meta={"confidence": "high", "rationale": "Same benchmark."})  # fmt: skip
    session.add(edge)
    session.commit()
    return edge


def shelf(session: Session):  # type: ignore[no-untyped-def]
    a, b = two_papers(session)
    attention, parallel = claims_of(session, a)[ATTENTION], claims_of(session, a)[PARALLEL]
    recurrent = claims_of(session, b)[RECURRENT]
    evidence = [f"{b.id}#ch03/p001", f"{a.id}#ch03/p001"]
    relate_by_hand(session, str(recurrent.id), str(attention.id), Relation.SUPPORTS,
                   EdgeStatus.ACCEPTED, evidence)  # fmt: skip
    relate_by_hand(session, str(attention.id), str(recurrent.id), Relation.CONTRADICTS,
                   EdgeStatus.PROPOSED, evidence)  # fmt: skip
    relate_by_hand(session, str(parallel.id), str(recurrent.id), Relation.EXTENDS,
                   EdgeStatus.REJECTED, evidence)  # fmt: skip
    return a, b, attention, recurrent


def test_a_papers_claims_come_grouped_by_unit_with_relation_counts(client, session):
    a, _, attention, _ = shelf(session)

    response = client.get(f"/api/v1/papers/{a.slug}/claims")

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["total"] == 2 and data["artifact_id"] is not None
    assert [(g["unit"], g["role"]) for g in data["units"]] == [
        ("ch01", "introduction"), ("ch03", "results"),
    ]  # fmt: skip
    results = data["units"][1]["claims"][0]
    assert results["id"] == str(attention.id)
    assert results["relations"] == {"supported_by": 1, "contradicted_by": 0, "extended_by": 0,
                                    "supports": 0, "extends": 0, "proposed": 1}  # fmt: skip
    assert data["units"][0]["claims"][0]["relations"]["extended_by"] == 0  # rejected: uncounted


def test_deleting_a_paper_withdraws_its_claim_edges(client, session):
    """Regression: edges have no foreign key, so the claims' cascade left them behind and
    the other paper kept counting relations to claims that no longer exist."""
    a, b, _, _ = shelf(session)

    assert client.delete(f"/api/v1/documents/{b.slug}", headers=AUTH).status_code == 204

    session.expire_all()
    assert session.exec(select(Edge).where(Edge.src_kind == EntityKind.CLAIM)).all() == []
    data = client.get(f"/api/v1/papers/{a.slug}/claims").json()
    for group in data["units"]:
        for claim in group["claims"]:
            assert set(claim["relations"].values()) == {0}


def test_a_book_has_no_paper_claims(client, session):
    from tests.pipeline.runtime.conftest import add_document

    book = add_document(session, slug="a-book")
    assert client.get(f"/api/v1/papers/{book.slug}/claims").status_code == 404


def test_a_claims_relations_name_the_other_paper_and_its_evidence(client, session):
    _, b, attention, recurrent = shelf(session)

    response = client.get(f"/api/v1/claims/{attention.id}/relations")

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["claim"]["text"] == ATTENTION
    assert [(r["relation"], r["direction"], r["status"]) for r in data["relations"]] == [
        ("supports", "in", "accepted"), ("contradicts", "out", "proposed"),
    ]  # fmt: skip
    first = data["relations"][0]
    assert first["other"]["id"] == str(recurrent.id)
    assert first["other_document"]["slug"] == b.slug
    assert [p["anchor"] for p in first["evidence"]] == ["ch03/p001", "ch03/p001"]
    assert first["rationale"] == "Same benchmark."
    assert client.get(f"/api/v1/claims/{uuid.uuid4()}/relations").status_code == 404


def test_margin_marks_map_evidence_anchors_to_claims_and_counts(client, session):
    a, _, attention, _ = shelf(session)

    whole = client.get(f"/api/v1/documents/{a.slug}/claims/marks").json()
    unit = client.get(f"/api/v1/documents/{a.slug}/claims/marks", params={"unit": "ch03"}).json()

    assert [m["anchor"] for m in whole["marks"]] == ["ch01/p002", "ch03/p001", "ch03/t001"]
    assert [m["anchor"] for m in unit["marks"]] == ["ch03/p001", "ch03/t001"]
    mark = unit["marks"][0]
    assert mark["claims"] == [{"id": str(attention.id), "key": "C1", "strength": "measured"}]
    assert (mark["supported_by"], mark["contradicted_by"]) == (1, 0)


def test_relate_queues_one_job_per_paper_and_needs_the_key(client, session):
    a, b = two_papers(session)
    before = len(session.exec(select(Job).where(Job.kind == JobKind.RELATE_CLAIMS)).all())

    assert client.post("/api/v1/papers/claims/relate").status_code == 401
    response = client.post("/api/v1/papers/claims/relate", headers=AUTH)
    again = client.post("/api/v1/papers/claims/relate", headers=AUTH)
    one = client.post("/api/v1/papers/claims/relate", params={"document": a.slug}, headers=AUTH)

    assert response.status_code == 202, response.text
    assert len(response.json()["jobs"]) == 2
    assert again.json()["jobs"] == [] and one.json()["jobs"] == []  # already queued
    after = session.exec(select(Job).where(Job.kind == JobKind.RELATE_CLAIMS)).all()
    assert len(after) == before + 2
    assert {j.document_id for j in after} >= {a.id, b.id}
