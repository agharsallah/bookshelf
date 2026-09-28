"""Input of `recommend-next` (docs/PAPERS.md §4, §5, P6): the top candidates and the shelf
passages that lead to each one.

    reading_candidates (payload order, best first)
      → facts: title, authors, year, venue, abstract, citation count, `via` kinds, score_parts
      → leads: each shelf paper in its `sources`, with your latest rating and
          citing_sentence  the sentence of `paper_references.cited_at` that cites it
          tldr             each span of that paper's card TL;DR
        every passage keyed `<document_id>#<anchor>` (the graph's qualified anchor)

A utility skill's input, so not a registered `Context` selector (`meta.yaml` `selector:
shelf_leads` is a label). `allowed[candidate_id]` holds the only cites that candidate's
reason may use: passages of papers that lead to it and that exist in the tree.
"""

import re
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.graph.evidence import clip
from app.models import Document, Node, PaperRating, PaperReference, ReadingCandidate, node_ref
from app.models.enums import ArtifactType
from app.papers.candidates import aliases
from app.pipeline import artifacts

ABSTRACT_CHARS = 1200
PASSAGE_CHARS = 500
CITING_PER_LEAD = 3
AUTHORS_SHOWN = 6
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])")


@dataclass(slots=True)
class LeadsInput:
    inputs: dict[str, Any]
    allowed: dict[str, set[str]] = field(default_factory=dict)  # candidate id → cite keys

    @property
    def candidate_ids(self) -> list[str]:
        return [c["id"] for c in self.inputs["candidates"]]


def citing_sentence(text: str, ordinal: int) -> str:
    """The sentence carrying the `[n]` marker (`[3]`, `[2, 3]`, `[1-4]` …), else the text."""
    marker = re.compile(rf"\[[^\]]*\b{ordinal}\b[^\]]*\]")
    for sentence in _SENTENCE.split(text):
        if marker.search(sentence):
            return sentence
    return text


def _latest_ratings(session: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, PaperRating]:
    rows = session.exec(
        select(PaperRating)
        .where(col(PaperRating.document_id).in_(ids))
        .order_by(col(PaperRating.created_at).desc(), col(PaperRating.id))
    )
    latest: dict[uuid.UUID, PaperRating] = {}
    for rating in rows:
        latest.setdefault(rating.document_id, rating)
    return latest


def _row_aliases(row: ReadingCandidate | PaperReference) -> set[str]:
    return set(
        aliases(openalex_id=row.openalex_id, doi=row.doi, arxiv_id=row.arxiv_id, title=row.title)
    )


def _references_to(
    session: Session, candidate: ReadingCandidate, documents: set[uuid.UUID]
) -> list[PaperReference]:
    """The bibliography entries of `documents` that are this candidate, by any alias."""
    wanted = _row_aliases(candidate)
    rows = session.exec(
        select(PaperReference)
        .where(col(PaperReference.document_id).in_(documents))
        .order_by(col(PaperReference.document_id), col(PaperReference.ordinal))
    )
    return [r for r in rows if _row_aliases(r) & wanted]


def _nodes(session: Session, keys: set[tuple[uuid.UUID, str]]) -> dict[str, Node]:
    if not keys:
        return {}
    found = session.exec(
        select(Node).where(tuple_(col(Node.document_id), col(Node.anchor)).in_(sorted(keys)))
    ).all()
    return {node_ref(n.document_id, n.anchor): n for n in found}


def _tldr_spans(session: Session, document_id: uuid.UUID) -> list[dict[str, Any]]:
    card = artifacts.preferred(session, document_id, [ArtifactType.PAPER_CARD]).get(
        (ArtifactType.PAPER_CARD, None)
    )
    if card is None:
        return []
    return [s for s in card.body.get("tldr", []) if isinstance(s, dict) and s.get("cites")]


def _sources(candidate: ReadingCandidate) -> dict[uuid.UUID, list[str]]:
    """Shelf document → the kinds of path from it to the candidate (sorted)."""
    via: dict[uuid.UUID, set[str]] = defaultdict(set)
    for source in candidate.sources:
        if (doc := source.get("document_id")) is not None:
            via[uuid.UUID(str(doc))].add(str(source.get("kind")))
    return {doc: sorted(kinds) for doc, kinds in via.items()}


def recommend_input(session: Session, candidate_ids: list[uuid.UUID]) -> LeadsInput:
    """The skill input for these candidates, in the given order (missing ones dropped)."""
    found = session.exec(
        select(ReadingCandidate).where(col(ReadingCandidate.id).in_(candidate_ids))
    )
    by_id = {c.id: c for c in found}
    ordered = [by_id[i] for i in dict.fromkeys(candidate_ids) if i in by_id]
    leads = {c.id: _sources(c) for c in ordered}
    shelf_ids = {doc for per in leads.values() for doc in per}
    documents = {
        d.id: d for d in session.exec(select(Document).where(col(Document.id).in_(shelf_ids)))
    }
    ratings = _latest_ratings(session, shelf_ids)
    tldrs = {doc: _tldr_spans(session, doc) for doc in documents}

    references = {
        c.id: _references_to(session, c, set(leads[c.id]) & set(documents)) for c in ordered
    }
    keys = {(r.document_id, a) for refs in references.values() for r in refs for a in r.cited_at}
    keys |= {(doc, s["cites"][0]) for doc, spans in tldrs.items() for s in spans}
    nodes = _nodes(session, keys)

    out = LeadsInput(inputs={"candidates": []})
    for candidate in ordered:
        cid = str(candidate.id)
        allowed: set[str] = set()
        entries: list[dict[str, Any]] = []
        via_all: set[str] = set()
        for doc, via in leads[candidate.id].items():
            document = documents.get(doc)
            if document is None:  # deleted since the rebuild
                continue
            refs = [r for r in references[candidate.id] if r.document_id == doc]
            passages = _passages(doc, refs, tldrs.get(doc, []), nodes)
            allowed |= {p["cite"] for p in passages}
            via_all |= set(via)
            entries.append(_lead(document, via, refs, ratings.get(doc), passages))
        entries.sort(key=_lead_order)
        out.inputs["candidates"].append(
            {
                "id": cid,
                "title": candidate.title,
                "authors": list(candidate.authors[:AUTHORS_SHOWN]),
                "year": candidate.year,
                "venue": candidate.venue,
                "abstract": clip(candidate.abstract, ABSTRACT_CHARS),
                "cited_by_count": candidate.cited_by_count,
                "via": sorted(via_all),
                "score_parts": {k: round(v, 3) for k, v in sorted(candidate.score_parts.items())},
                "leads": entries,
            }
        )
        out.allowed[cid] = allowed
    return out


def _lead(
    document: Document,
    via: list[str],
    refs: list[PaperReference],
    rating: PaperRating | None,
    passages: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "document": {"id": str(document.id), "title": document.title},
        "via": via,
        "intents": sorted({r.intent.value for r in refs if r.intent is not None}),
        "rating": {
            "stars": rating.stars,
            "verdict": rating.verdict.value if rating.verdict else None,
        }
        if rating
        else None,
        "passages": passages,
    }


def _lead_order(lead: dict[str, Any]) -> tuple[int, str]:
    """Best-rated lead first; unrated last."""
    rating = lead["rating"]
    return (-(rating["stars"] if rating else 0), str(lead["document"]["id"]))


def _passages(
    doc: uuid.UUID,
    references: list[PaperReference],
    tldr: list[dict[str, Any]],
    nodes: dict[str, Node],
) -> list[dict[str, Any]]:
    """`references`: this document's entries for the candidate. Citing sentences first
    (at most `CITING_PER_LEAD`), then the TL;DR spans; only anchors in the tree."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for ref in references:
        for anchor in ref.cited_at:
            key = node_ref(doc, anchor)
            node = nodes.get(key)
            if node is None or key in seen or not node.text or len(out) >= CITING_PER_LEAD:
                continue
            text = clip(citing_sentence(node.text, ref.ordinal), PASSAGE_CHARS)
            out.append({"cite": key, "kind": "citing_sentence", "text": text})
            seen.add(key)
    for span in tldr:
        key = node_ref(doc, span["cites"][0])
        if key in nodes and key not in seen:
            out.append({"cite": key, "kind": "tldr", "text": clip(span["text"], PASSAGE_CHARS)})
            seen.add(key)
    return out
