"""Connections: an accepted graph edge whose evidence rests in two documents.

Echoes (chapters that say similar things), bridges (how a concept in one book bears on one
in another) and claim relations across papers all carry evidence passages from both
sides. `app.pills.inputs.connection_links` reads them as `ConnectionLink`s, this document's
side first; each becomes a connection pill in the unit of that side. The other side's
passage is cited `<slug>:<anchor>`, so the client resolves it through `sources`.
"""

import re
import uuid
from dataclasses import dataclass

from app.models.enums import ArtifactType, PillKind
from app.pills.contract import ConnectionBody, ConnectionSide, DocumentRef
from app.pills.harvest.base import (
    MAX_WORDS,
    MIN_WORDS,
    HarvestContext,
    HarvestInput,
    PillDraft,
    SourceArtifact,
    build,
    count_words,
    draft,
)
from app.retrieval.evidence import qualify

ORIGIN = "harvest:graph"
SIDE_WORDS = 40  # a passage longer than this is cut at a word boundary (two fit a phone)

# Evidence is sometimes a passage that is not prose: a parser left a bibliography entry, an
# author list or a results-table row in the text, and an echo edge matched it.
_VENUE = re.compile(
    r"arxiv(:| preprint)|advances in neural information|proceedings of|"
    r"in (international )?conference|conference on [a-z]|transactions on|journal of|doi:",
    re.IGNORECASE,
)
_YEAR = re.compile(r"\b(19|20)\d{2}\b")
_NUMBER = re.compile(r"^[-+]?[\d.,%]+$")
MAX_COMMA_SHARE = 0.2  # commas per word above this: a list of names
MAX_NUMBER_SHARE = 0.25  # numeric tokens above this share: a table row


@dataclass(frozen=True, slots=True)
class LinkSide:
    document_id: uuid.UUID
    slug: str
    title: str
    anchor: str
    text: str


@dataclass(frozen=True, slots=True)
class ConnectionLink:
    edge_id: uuid.UUID
    relation: str
    concept: str | None
    headline: str | None
    sides: tuple[LinkSide, LinkSide]  # this document's side first


def clip_words(text: str, limit: int = SIDE_WORDS) -> str:
    words = text.split()
    return text.strip() if len(words) <= limit else " ".join(words[:limit]) + "…"


def is_prose(text: str) -> bool:
    """False for a bibliography entry, an author list or a table row (`_VENUE`)."""
    words = text.split()
    if not words:
        return False
    if _VENUE.search(text) and _YEAR.search(text):
        return False
    if text.count(",") / len(words) > MAX_COMMA_SHARE:
        return False
    return sum(1 for w in words if _NUMBER.match(w)) / len(words) <= MAX_NUMBER_SHARE


def _side(side: LinkSide) -> ConnectionSide | None:
    text = clip_words(side.text)
    if not MIN_WORDS <= count_words(text) <= MAX_WORDS or not is_prose(text):
        return None
    return build(
        ConnectionSide,
        document=DocumentRef(id=side.document_id, slug=side.slug, title=side.title),
        anchor=side.anchor,
        spans=[{"text": text, "cites": [side.anchor]}],
    )


def harvest_connections(context: HarvestContext, links: list[ConnectionLink]) -> list[PillDraft]:
    # Graph pills come from no artifact: an approved stand-in carries the context through.
    inp = HarvestInput(
        context,
        SourceArtifact(
            id=None,
            type=ArtifactType.CONCEPT_LINKS,
            anchor=None,
            variant=None,
            body={},
            draft=False,
        ),
    )
    out: list[PillDraft] = []
    for link in links:
        mine, other = link.sides
        sides = [_side(mine), _side(other)]
        if mine.document_id != context.document_id or None in sides:
            continue
        body = build(ConnectionBody, relation=link.relation, concept=link.concept, sides=sides)
        if body is None:
            continue
        pill = draft(
            inp,
            PillKind.CONNECTION,
            body,
            content=f"{link.relation}\x1f{mine.anchor}\x1f{qualify(other.slug, other.anchor)}",
            cites=[mine.anchor, qualify(other.slug, other.anchor)],
            anchor=mine.anchor,
            origin=ORIGIN,
            headline=link.headline,
            concepts=[link.concept] if link.concept else (),
        )
        if pill is not None:
            out.append(pill)
    return out
