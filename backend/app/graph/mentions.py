"""Mention seeds: a section links to every known concept its text names (§11).

`concept_links` reads a book once and ties each concept to the few passages that define
or use it best. Everything else it says about a concept (every later section that leans
on it, every other book that names it) is left unlinked, so chapters that discuss the
same idea never meet in the graph. This pass fills that in, deterministically:

* **Terms** are every live concept's canonical name and aliases. A term of four letters
  or fewer (`star`, `wip`, `tmay`) is an acronym: it matches only when the text writes
  it in capitals. Longer terms match case-insensitively, on word boundaries, with a
  simple plural. The longest term wins where two overlap (`wip limit` over `wip`).
* **Endpoint** is the section a block belongs to (its nearest `section` or `chapter`
  ancestor), not the block: `node:<doc>#ch03/s02 —mentions→ concept`, one edge per
  section and concept, so a word used 40 times is one link, not 40.
* **Evidence** is the blocks that name the concept, in reading order (at most
  `MAX_EVIDENCE`); `meta.count` keeps the full count and the weight grows with it,
  from 0.25 to 0.6. A block that `concept_links` already ties to the concept is not
  counted again: this pass only adds what the skill did not say.
* Edges land `accepted` (the words are literally there) with `origin = seed:mentions@1`,
  and are reconciled per document like diagram seeds: re-running is a no-op, a section
  that stops naming a concept loses its edge, and mention edges never keep a concept
  alive on their own (`apply._prune` treats them as seeds).

Concepts are shared across books, so the scan runs for the document whose links just
changed and, when that change created or removed concepts, for every other document too
(`refresh_document`), and for all documents after a person renames, creates or merges
a concept (`seed_all`). It is one regular expression over the leaf text: cheap enough
to run inline, and derived, so it can be rebuilt from scratch at any time.
"""

import re
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.graph.edges import (
    LINK_ORIGINS,
    MENTION_ORIGINS,
    EdgeDraft,
    Reconciled,
    find_edge,
    origin_in,
    reconcile,
)
from app.graph.names import live_concepts, normalize
from app.graph.refs import Ref
from app.models import Concept, Document, Edge, Node, node_ref
from app.models.enums import EdgeStatus, EntityKind, NodeKind, Relation

MENTION_VERSION = "1"
MENTION_ORIGIN = f"seed:mentions@{MENTION_VERSION}"
MAX_EVIDENCE = 8
MIN_TERM = 3
ACRONYM_MAX = 4
_SECTIONS = (NodeKind.SECTION, NodeKind.CHAPTER)


def mention_weight(count: int) -> float:
    """0.25 for a single mention, rising 0.05 per further block, capped at 0.6."""
    return round(min(0.6, 0.25 + 0.05 * max(count - 1, 0)), 2)


@dataclass(frozen=True, slots=True)
class Matcher:
    """Finds concept names in text. Build once per scan with `matcher`."""

    words: re.Pattern[str] | None
    acronyms: re.Pattern[str] | None
    by_term: dict[str, uuid.UUID]

    def find(self, body: str) -> set[uuid.UUID]:
        found: set[uuid.UUID] = set()
        taken: list[tuple[int, int]] = []  # a longer name owns its words (`WIP limit`)
        for m in self.words.finditer(body) if self.words is not None else ():
            if (concept := self.by_term.get(normalize(m.group(1)))) is not None:
                found.add(concept)
                taken.append(m.span())
        for m in self.acronyms.finditer(body) if self.acronyms is not None else ():
            inside = any(a <= m.start() and m.end() <= b for a, b in taken)
            if not inside and (concept := self.by_term.get(m.group(1).lower())) is not None:
                found.add(concept)
        return found


def _is_acronym(term: str) -> bool:
    return len(term) <= ACRONYM_MAX and term.isalnum()


def _alternation(terms: Iterable[str]) -> str:
    # Longest first, so the regex engine prefers `work in progress limit` to `work in progress`.
    ordered = sorted(set(terms), key=lambda t: (-len(t), t))
    return "|".join(r"\s+".join(re.escape(w) for w in t.split()) for t in ordered)


def matcher(concepts: Sequence[Concept]) -> Matcher:
    by_term: dict[str, uuid.UUID] = {}
    for concept in sorted(concepts, key=lambda c: str(c.id)):
        for name in [concept.canonical, *concept.aliases]:
            term = normalize(name)
            if len(term) >= MIN_TERM:
                by_term.setdefault(term, concept.id)
    words = [t for t in by_term if not _is_acronym(t)]
    acronyms = [t for t in by_term if _is_acronym(t)]
    return Matcher(
        words=re.compile(rf"(?<!\w)({_alternation(words)})(?:e?s)?(?!\w)", re.IGNORECASE)
        if words
        else None,
        acronyms=re.compile(rf"(?<!\w)({'|'.join(re.escape(t.upper()) for t in acronyms)})s?(?!\w)")
        if acronyms
        else None,
        by_term=by_term,
    )


def _section_of(anchor: str, sections: set[str]) -> str:
    """The nearest section or chapter above a block; the block itself when there is none."""
    parts = anchor.split("/")
    for i in range(len(parts) - 1, 0, -1):
        prefix = "/".join(parts[:i])
        if prefix in sections:
            return prefix
    return anchor


def _linked(session: Session, document_id: uuid.UUID) -> set[tuple[str, uuid.UUID]]:
    """(block anchor, concept) pairs `concept_links` already asserts for this document."""
    prefix = f"{document_id}#"
    rows = session.exec(
        select(Edge).where(
            origin_in(LINK_ORIGINS),
            or_(col(Edge.src_id).like(f"{prefix}%"), col(Edge.dst_id).like(f"{prefix}%")),
        )
    ).all()
    out: set[tuple[str, uuid.UUID]] = set()
    for edge in rows:
        ends = ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id))
        blocks = [i for k, i in ends if k is EntityKind.NODE and i.startswith(prefix)]
        concepts = [uuid.UUID(i) for k, i in ends if k is EntityKind.CONCEPT]
        out.update((b.removeprefix(prefix), c) for b in blocks for c in concepts)
    return out


def drafts(session: Session, document_id: uuid.UUID, match: Matcher) -> list[EdgeDraft]:
    """The mention edges one document's text supports today."""
    nodes = session.exec(
        select(Node).where(Node.document_id == document_id).order_by(col(Node.ordinal))
    ).all()
    sections = {n.anchor for n in nodes if n.kind in _SECTIONS}
    linked = _linked(session, document_id)
    hits: dict[tuple[str, uuid.UUID], list[str]] = defaultdict(list)
    for node in nodes:
        if node.kind.is_container or not node.text:
            continue
        for concept_id in match.find(node.text):
            if (node.anchor, concept_id) not in linked:
                hits[(_section_of(node.anchor, sections), concept_id)].append(node.anchor)
    out: list[EdgeDraft] = []
    for (section, concept_id), blocks in sorted(
        hits.items(), key=lambda h: (h[0][0], str(h[0][1]))
    ):
        out.append(
            EdgeDraft(
                src=Ref.node(document_id, section),
                dst=Ref.concept(concept_id),
                relation=Relation.MENTIONS,
                weight=mention_weight(len(blocks)),
                evidence=[node_ref(document_id, b) for b in blocks[:MAX_EVIDENCE]],
                origin=MENTION_ORIGIN,
                status=EdgeStatus.ACCEPTED,
                meta={"count": len(blocks)},
            )
        )
    return out


def _seed(session: Session, document_id: uuid.UUID, match: Matcher) -> Reconciled:
    wanted = drafts(session, document_id, match)
    report = reconcile(session, document_id, wanted, owns=MENTION_ORIGINS)
    # `reconcile` leaves `meta` alone on an update; the count is this pass's to keep.
    for draft in wanted:
        edge = find_edge(session, draft.key)
        if edge is not None and edge.origin == MENTION_ORIGIN and edge.meta != draft.meta:
            edge.meta = dict(draft.meta)
            session.add(edge)
    session.flush()
    return report


def seed_document(session: Session, document_id: uuid.UUID) -> Reconciled:
    """Reconcile one document's mention edges with its text and today's concepts. Commits."""
    report = _seed(session, document_id, matcher(live_concepts(session)))
    session.commit()
    return report


def seed_all(session: Session, *, exclude: uuid.UUID | None = None) -> dict[uuid.UUID, Reconciled]:
    """Re-scan every document (but `exclude`) against today's concepts. Commits once."""
    match = matcher(live_concepts(session))
    ids = session.exec(select(Document.id).order_by(col(Document.created_at))).all()
    out = {doc: _seed(session, doc, match) for doc in ids if doc != exclude}
    session.commit()
    return out
