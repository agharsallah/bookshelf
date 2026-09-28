"""Two papers with approved claim sets, for the claim tracker tests (helpers, not fixtures).

Both use the fixture paper's tree (`paper_fixtures.PAPER`): units ch01 introduction, ch02
method (with a figure), ch03 results (with a table).
"""

from collections.abc import Sequence
from typing import Any

from sqlmodel import Session, select

from app.models import Artifact, Claim, Document
from app.models.enums import ArtifactType, DocumentStatus
from app.pipeline import authoring
from tests.papers.paper_fixtures import add_paper, store

ATTENTION = "Self-attention alone reaches 28.4 BLEU on WMT 2014 English-German."
PARALLEL = "Recurrent models cannot be parallelised across the positions of a sequence."
RECURRENT = "A recurrent encoder with attention reaches 24.6 BLEU on WMT 2014 English-German."
UNRELATED = "Dropout reduces overfitting in large neural networks."


def claim(key: str, text: str, strength: str = "measured", *cites: str) -> dict[str, Any]:
    kind = "result" if strength == "measured" else "method"
    return {"key": key, "text": text, "kind": kind, "strength": strength,
            "cites": list(cites) or ["ch03/p001"]}  # fmt: skip


def claim_set(*claims: dict[str, Any]) -> dict[str, Any]:
    return {"claims": list(claims)}


def approve_claims(
    session: Session, doc: Document, body: dict[str, Any], *, version: int = 1
) -> Artifact:
    """A skill claim_set approved through the review flow (so the profile materializes)."""
    artifact = store(session, doc, ArtifactType.CLAIM_SET, None, content=body, version=version)
    artifact.input_hash = f"claims-{doc.id}-{version}"
    session.add(artifact)
    session.commit()
    return authoring.review(session, artifact, "approve")


def claims_of(session: Session, doc: Document) -> dict[str, Claim]:
    rows = session.exec(select(Claim).where(Claim.document_id == doc.id)).all()
    return {c.text: c for c in rows}


def two_papers(
    session: Session,
    a_claims: Sequence[dict[str, Any]] | None = None,
    b_claims: Sequence[dict[str, Any]] | None = None,
    status: DocumentStatus = DocumentStatus.PARSED,
) -> tuple[Document, Document]:
    """`vaswani` claims ATTENTION (measured) and PARALLEL (argued); `bahdanau` claims
    RECURRENT (measured) and UNRELATED (argued), unless given."""
    a = add_paper(session, slug="vaswani", status=status)
    b = add_paper(session, slug="bahdanau", status=status)
    a_body = claim_set(*(a_claims or [claim("C1", ATTENTION, "measured", "ch03/p001",
                                           "ch03/t001"),
                                     claim("C2", PARALLEL, "argued", "ch01/p002")]))  # fmt: skip
    b_body = claim_set(*(b_claims or [claim("C1", RECURRENT), claim("C2", UNRELATED, "argued",
                                                                   "ch02/p001")]))  # fmt: skip
    approve_claims(session, a, a_body)
    approve_claims(session, b, b_body)
    return a, b
