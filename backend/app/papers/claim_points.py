"""A paper's claims as Qdrant points (docs/PAPERS.md §5 "Claim tracker").

Each row of `claims` becomes one point of the `claims` collection, synced by the `embed`
job with the document's other points (`retrieval.indexing.index_document`): new or reworded
claims are embedded, removed ones deleted, unchanged ones cost a hash comparison. The point
id is the claim id, which is already stable across claim-set versions (`papers.claims`), so
a claim kept by a new version keeps its vector.

Pure reads from Postgres, no vectors (like `retrieval.points`).
"""

import uuid

from sqlmodel import Session, col, select

from app.models import Claim
from app.retrieval.points import PointSpec, content_hash

# BM25 `avg_len` of the collection, in words: a claim is one sentence.
CLAIMS_AVG_LEN = 30.0


def claim_text(claim: Claim) -> str:
    """What a claim's vector encodes: its sentence (self-contained by the skill's rules)."""
    return claim.text


def document_claims(session: Session, document_id: uuid.UUID) -> list[Claim]:
    rows = session.exec(
        select(Claim).where(Claim.document_id == document_id).order_by(col(Claim.key))
    ).all()
    return list(rows)


def claim_points(session: Session, document_id: uuid.UUID, *, model_id: str) -> list[PointSpec]:
    """One point per claim of the document."""
    specs = []
    for claim in document_claims(session, document_id):
        text = claim_text(claim)
        specs.append(
            PointSpec(
                id=str(claim.id),
                text=text,
                payload={
                    "document_id": str(document_id),
                    "claim_id": str(claim.id),
                    "key": claim.key,
                    "kind": claim.kind.value,
                    "strength": claim.strength.value,
                    "unit": claim.unit,
                    "text": text,
                    "model_id": model_id,
                    "content_hash": content_hash(text, CLAIMS_AVG_LEN),
                },
            )
        )
    return specs
