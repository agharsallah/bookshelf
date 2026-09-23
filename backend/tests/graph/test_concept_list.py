"""`GET /concepts`: `edge_count` (merged concepts folded in) and `sort`."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Concept, Edge
from app.models.enums import ConceptKind, EdgeStatus, EntityKind, Relation

URL = "/api/v1/concepts"
T0 = datetime(2026, 1, 1, tzinfo=UTC)


def concept(session: Session, name: str, age_days: int, **fields: object) -> Concept:
    row = Concept(canonical=name, kind=ConceptKind.CONCEPT, created_at=T0 - timedelta(age_days),
                  **fields)  # fmt: skip
    session.add(row)
    session.commit()
    return row


def link(session: Session, src: str, relation: Relation, dst: str, *, src_kind=EntityKind.CONCEPT,
         status=EdgeStatus.ACCEPTED) -> None:  # fmt: skip
    session.add(Edge(src_kind=src_kind, src_id=src, dst_kind=EntityKind.CONCEPT, dst_id=dst,
                     relation=relation, origin="human", status=status))  # fmt: skip
    session.commit()


def graph(session: Session) -> None:
    zeta = concept(session, "zeta", age_days=3)
    beta = concept(session, "beta", age_days=1)
    gamma = concept(session, "gamma", age_days=2)
    merged = concept(session, "beta prime", age_days=0, merged_into=beta.id)
    node = EntityKind.NODE
    link(session, "doc#ch01/p001", Relation.MENTIONS, str(zeta.id), src_kind=node)
    link(session, "doc#ch01/p002", Relation.MENTIONS, str(zeta.id), src_kind=node)
    link(session, str(zeta.id), Relation.SUPPORTS, str(beta.id))
    link(session, "doc#ch02/p001", Relation.MENTIONS, str(merged.id), src_kind=node)
    link(session, str(merged.id), Relation.SAME_AS, str(beta.id))  # the merge record
    link(session, "doc#ch03/p001", Relation.MENTIONS, str(gamma.id), src_kind=node,
         status=EdgeStatus.PROPOSED)  # fmt: skip


def listed(client: TestClient, **params: str) -> list[tuple[str, int]]:
    items = client.get(URL, params=params).json()["items"]
    return [(item["canonical"], item["edge_count"]) for item in items]


def test_edge_counts_fold_in_merged_concepts_and_skip_the_merge_record(client, session):
    graph(session)

    assert listed(client) == [("beta", 2), ("gamma", 0), ("zeta", 3)]


def test_concepts_sort_by_connections_or_recency(client, session):
    graph(session)

    assert [n for n, _ in listed(client, sort="connected")] == ["zeta", "beta", "gamma"]
    assert [n for n, _ in listed(client, sort="recent")] == ["beta", "gamma", "zeta"]
    assert client.get(URL, params={"sort": "random"}).status_code == 422
