"""Citation intents (`citation_intents` → `paper_references.intent`), a materializer (P5).

`classify-citations` says why the paper cites each reference; once a human approves the
artifact, the verdicts are copied onto the bibliography rows, where recommendation scoring
(`papers.scoring`, intent term) and the citation graph (`papers.cites`, edge weight) read
them. Rebuilt from scratch on every call, from the latest *approved* version only
(`materialize.effective`): no approved version left, no intents.

A verdict lands only on a reference that exists, and keeps only the cites that are among
that reference's in-text citations (`cited_at`); a verdict left with none is dropped (after
a re-parse its evidence no longer holds). Registered in `materialize.MATERIALIZERS`.
"""

import uuid
from typing import Any

from sqlmodel import Session, select

from app.jobs.queue import JobSpec
from app.models import Document, PaperReference
from app.models.enums import ArtifactType, CitationIntent
from app.papers import cites


def verdicts(body: dict[str, Any] | None) -> dict[int, tuple[CitationIntent, list[str]]]:
    """`{ordinal: (intent, cites)}` from a citation_intents body; the first verdict wins."""
    out: dict[int, tuple[CitationIntent, list[str]]] = {}
    items = body.get("citations", []) if isinstance(body, dict) else []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("ordinal"), int):
            continue
        try:
            intent = CitationIntent(str(item.get("intent")))
        except ValueError:
            continue
        found = [c for c in item.get("cites", []) if isinstance(c, str)]
        out.setdefault(item["ordinal"], (intent, found))
    return out


def sync_intents(session: Session, document_id: uuid.UUID) -> int:
    """Make the document's references carry exactly the approved verdicts. Returns how many
    references carry an intent. Commits."""
    from app.papers.materialize import effective  # materialize registers this module

    artifact = effective(session, document_id, ArtifactType.CITATION_INTENTS)
    found = verdicts(artifact.body if artifact is not None else None)
    rows = session.exec(
        select(PaperReference).where(PaperReference.document_id == document_id)
    ).all()
    tagged = 0
    for ref in rows:
        intent, cited = found.get(ref.ordinal, (None, []))
        kept = [c for c in cited if c in ref.cited_at]
        if intent is None or not kept:
            intent, kept = None, []
        else:
            tagged += 1
        if ref.intent is not intent or ref.intent_cites != kept:
            ref.intent, ref.intent_cites = intent, kept
            session.add(ref)
    session.commit()
    return tagged


def materialize_intents(session: Session, document: Document) -> list[JobSpec]:
    """`sync_intents`, then the paper's cites edges, whose weights follow the intents."""
    sync_intents(session, document.id)
    cites.seed_document(session, document.id)
    session.commit()
    return []
