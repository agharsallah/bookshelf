"""The atlas: the whole shelf at chapter grain, for the map (§11, §12).

The neighborhood answers "what does this one thing connect to". The atlas answers "how
does the shelf hang together": every book, every chapter that takes part in the graph,
every live concept, and three kinds of line between them:

    document ─contains→ chapter                 the book's own structure
    chapter  ─<relation>→ concept               passage and section edges, folded up to
                                                 their chapter (defines, mentions, …)
    concept  ─<relation>→ concept               the typed links, as stored
    chapter  ─shares→ chapter                   derived: the chapters that lean on the
                                                 same concepts, strongest partners only

**Folding.** An edge endpoint `node:<doc>#ch03/s02/p014` belongs to the nearest `chapter`
above it (or its first anchor segment when the book has no chapters); a paper claim
(`claim:<id>`) belongs to its unit, so claim ↔ claim relations join the papers' sections.
Edges that fold onto the same `(chapter, concept, relation)` combine: the strongest one's
weight, summed evidence, every underlying edge id, and a few evidence anchors to open.

**Sharing.** Two chapters share a concept when both link to it. A pair scores the sum of
`1 / log2(1 + chapters naming it)` over the concepts they share, so a rare idea joins two
chapters more strongly than a word every chapter uses. Each chapter keeps its
`SHARE_PARTNERS` best partners; a line is kept when either end chose it.

**Budget.** At most `CONCEPT_CAP` concepts (by degree) and `CHAPTER_CAP` chapters; the
response says when it was cut. Derived on read, never stored: the atlas is only a view.
"""

import math
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations
from typing import Literal

from sqlmodel import Session, col, select

from app.graph.evidence import clip
from app.graph.refs import Ref
from app.models import Claim, Concept, Document, Edge, Node
from app.models.enums import EdgeStatus, EntityKind, NodeKind

CONCEPT_CAP = 400
CHAPTER_CAP = 600
SHARE_PARTNERS = 3
MAX_EVIDENCE = 6
BLURB_CHARS = 280

Kind = Literal["document", "chapter", "concept"]
CONTAINS = "contains"
SHARES = "shares"


@dataclass(slots=True)
class AtlasNode:
    ref: str
    kind: Kind
    label: str
    sublabel: str | None = None
    document_id: uuid.UUID | None = None
    anchor: str | None = None
    blurb: str | None = None
    concept_kind: str | None = None
    genre: str | None = None  # a book's or chapter's document genre (the map's genre lens)
    ordinal: int = 0
    degree: int = 0
    books: set[uuid.UUID] = field(default_factory=set)
    passages: int = 0


@dataclass(slots=True)
class AtlasEdge:
    id: str
    src: str
    dst: str
    relation: str
    weight: float
    evidence_count: int
    status: EdgeStatus
    edge_ids: list[uuid.UUID] = field(default_factory=list)
    evidence: list[str] = field(default_factory=list)
    concepts: list[str] = field(default_factory=list)

    @property
    def score(self) -> float:
        return self.weight * max(self.evidence_count, 1)


@dataclass(slots=True)
class Atlas:
    nodes: list[AtlasNode]
    edges: list[AtlasEdge]
    documents: dict[uuid.UUID, Document]
    truncated: bool


def chapter_anchor(anchor: str, chapters: set[str]) -> str:
    """The chapter an anchor lives in: its nearest `chapter` prefix, else its first segment."""
    parts = anchor.split("/")
    for i in range(len(parts), 0, -1):
        prefix = "/".join(parts[:i])
        if prefix in chapters:
            return prefix
    return parts[0]


def share_weight(chapters_naming: int) -> float:
    """How much one shared concept binds two chapters: rare ideas bind harder."""
    return 1.0 / math.log2(1 + max(chapters_naming, 1))


class _Builder:
    def __init__(self, session: Session, include_proposed: bool) -> None:
        self.session = session
        self.statuses = [EdgeStatus.ACCEPTED] + ([EdgeStatus.PROPOSED] if include_proposed else [])
        self.docs = {d.id: d for d in session.exec(select(Document)).all()}
        self.concepts = {
            str(c.id): c
            for c in session.exec(select(Concept).where(col(Concept.merged_into).is_(None))).all()
        }
        # A paper claim folds to the unit it belongs to, like a passage to its chapter.
        self.claims = {
            str(c.id): (c.document_id, c.unit or (c.evidence[0] if c.evidence else ""))
            for c in session.exec(select(Claim)).all()
        }
        heads = session.exec(
            select(Node).where(col(Node.kind).in_([NodeKind.CHAPTER, NodeKind.PART]))
        ).all()
        self.chapters: dict[uuid.UUID, set[str]] = defaultdict(set)
        self.headings: dict[tuple[uuid.UUID, str], Node] = {}
        for node in heads:
            self.headings[(node.document_id, node.anchor)] = node
            if node.kind is NodeKind.CHAPTER:
                self.chapters[node.document_id].add(node.anchor)
        self.nodes: dict[str, AtlasNode] = {}
        self.folded: dict[tuple[str, str, str], AtlasEdge] = {}

    # --- endpoints -------------------------------------------------------------------------

    def _chapter(self, document_id: uuid.UUID, anchor: str) -> AtlasNode | None:
        if document_id not in self.docs:
            return None
        chapter = chapter_anchor(anchor, self.chapters[document_id])
        ref = str(Ref.node(document_id, chapter))
        if ref not in self.nodes:
            head = self.headings.get((document_id, chapter))
            self.nodes[ref] = AtlasNode(
                ref=ref,
                kind="chapter",
                label=clip(head.heading, 80) or chapter if head else chapter,
                sublabel=self.docs[document_id].title,
                document_id=document_id,
                anchor=chapter,
                genre=self.docs[document_id].genre.value,
                ordinal=head.ordinal if head else 0,
                books={document_id},
            )
        return self.nodes[ref]

    def _document(self, document_id: uuid.UUID) -> AtlasNode | None:
        doc = self.docs.get(document_id)
        if doc is None:
            return None
        ref = str(Ref(EntityKind.DOCUMENT, str(document_id)))
        if ref not in self.nodes:
            self.nodes[ref] = AtlasNode(
                ref=ref,
                kind="document",
                label=doc.title,
                sublabel=", ".join(doc.authors) or None,
                document_id=doc.id,
                genre=doc.genre.value,
                books={doc.id},
            )
        return self.nodes[ref]

    def _concept(self, concept_id: str) -> AtlasNode | None:
        concept = self.concepts.get(concept_id)
        if concept is None:
            return None
        ref = str(Ref(EntityKind.CONCEPT, concept_id))
        if ref not in self.nodes:
            self.nodes[ref] = AtlasNode(
                ref=ref,
                kind="concept",
                label=concept.canonical,
                sublabel=concept.kind.value,
                blurb=clip(concept.blurb, BLURB_CHARS),
                concept_kind=concept.kind.value,
            )
        return self.nodes[ref]

    def _endpoint(self, kind: EntityKind, ref_id: str) -> AtlasNode | None:
        if kind is EntityKind.CONCEPT:
            return self._concept(ref_id)
        if kind is EntityKind.DOCUMENT:
            return self._document(uuid.UUID(ref_id))
        if kind is EntityKind.NODE:
            doc, _, anchor = ref_id.partition("#")
            return self._chapter(uuid.UUID(doc), anchor)
        if kind is EntityKind.CLAIM and (claim := self.claims.get(ref_id)) and claim[1]:
            return self._chapter(*claim)
        return None  # artifacts are not on the map

    # --- edges -----------------------------------------------------------------------------

    def fold(self) -> None:
        rows = self.session.exec(select(Edge).where(col(Edge.status).in_(self.statuses))).all()
        for edge in sorted(rows, key=lambda e: (-(e.weight * max(len(e.evidence), 1)), str(e.id))):
            a = self._endpoint(edge.src_kind, edge.src_id)
            b = self._endpoint(edge.dst_kind, edge.dst_id)
            if a is None or b is None or a.ref == b.ref:
                continue
            key = (a.ref, b.ref, edge.relation.value)
            seen = self.folded.get(key)
            if seen is None:
                self.folded[key] = AtlasEdge(
                    id=str(edge.id),
                    src=a.ref,
                    dst=b.ref,
                    relation=edge.relation.value,
                    weight=edge.weight,
                    evidence_count=len(edge.evidence),
                    status=edge.status,
                    edge_ids=[edge.id],
                    evidence=list(edge.evidence[:MAX_EVIDENCE]),
                )
            else:  # the strongest edge (sorted first) stays the representative
                seen.evidence_count += len(edge.evidence)
                seen.edge_ids.append(edge.id)
                room = MAX_EVIDENCE - len(seen.evidence)
                seen.evidence.extend([e for e in edge.evidence if e not in seen.evidence][:room])
                if edge.status is EdgeStatus.ACCEPTED:
                    seen.status = EdgeStatus.ACCEPTED
            for concept_end, other in ((a, b), (b, a)):
                if concept_end.kind == "concept" and other.document_id is not None:
                    concept_end.books.add(other.document_id)
                    concept_end.passages += len(edge.evidence)

    def budget(self) -> bool:
        """Keep the best-connected concepts and chapters. True when something was cut."""
        degree: dict[str, float] = defaultdict(float)
        for e in self.folded.values():
            degree[e.src] += e.score
            degree[e.dst] += e.score
        cut = False
        for kind, cap in (("concept", CONCEPT_CAP), ("chapter", CHAPTER_CAP)):
            ranked = sorted(
                (n for n in self.nodes.values() if n.kind == kind),
                key=lambda n: (-degree[n.ref], n.label.lower(), n.ref),
            )
            for dropped in ranked[cap:]:
                del self.nodes[dropped.ref]
                cut = True
        self.folded = {
            k: e for k, e in self.folded.items() if e.src in self.nodes and e.dst in self.nodes
        }
        return cut

    def structure(self) -> list[AtlasEdge]:
        out: list[AtlasEdge] = []
        for node in sorted(self.nodes.values(), key=lambda n: (str(n.document_id), n.ordinal)):
            if node.kind != "chapter" or node.document_id is None:
                continue
            book = self._document(node.document_id)
            if book is not None:
                out.append(
                    AtlasEdge(
                        id=f"{CONTAINS}:{node.ref}",
                        src=book.ref,
                        dst=node.ref,
                        relation=CONTAINS,
                        weight=1.0,
                        evidence_count=0,
                        status=EdgeStatus.ACCEPTED,
                    )
                )
        return out

    def shares(self) -> list[AtlasEdge]:
        naming: dict[str, set[str]] = defaultdict(set)  # concept → chapters linking it
        for e in self.folded.values():
            for chapter, concept in ((e.src, e.dst), (e.dst, e.src)):
                if self.nodes[chapter].kind == "chapter" and self.nodes[concept].kind == "concept":
                    naming[concept].add(chapter)
        pairs: dict[tuple[str, str], tuple[float, list[str]]] = {}
        for concept, chapters in sorted(naming.items()):
            bind = share_weight(len(chapters))
            for a, b in combinations(sorted(chapters), 2):
                score, shared = pairs.get((a, b), (0.0, []))
                pairs[(a, b)] = (score + bind, [*shared, concept])
        best: dict[str, list[tuple[float, str]]] = defaultdict(list)
        for (a, b), (score, _) in pairs.items():
            best[a].append((score, b))
            best[b].append((score, a))
        chosen: set[tuple[str, str]] = set()
        for chapter, partners in best.items():
            for _, other in sorted(partners, key=lambda p: (-p[0], p[1]))[:SHARE_PARTNERS]:
                chosen.add((min(chapter, other), max(chapter, other)))
        out: list[AtlasEdge] = []
        for a, b in sorted(chosen):
            score, shared = pairs[(a, b)]
            out.append(
                AtlasEdge(
                    id=f"{SHARES}:{a}|{b}",
                    src=a,
                    dst=b,
                    relation=SHARES,
                    weight=round(score, 3),
                    evidence_count=len(shared),
                    status=EdgeStatus.ACCEPTED,
                    concepts=shared,
                )
            )
        return out


def atlas(session: Session, *, include_proposed: bool = False) -> Atlas:
    builder = _Builder(session, include_proposed)
    builder.fold()
    truncated = builder.budget()
    for document_id in builder.docs:  # every book is on the map, linked or not yet
        builder._document(document_id)
    edges = [*builder.structure(), *builder.folded.values(), *builder.shares()]
    for e in edges:
        builder.nodes[e.src].degree += 1
        builder.nodes[e.dst].degree += 1
    order = {"document": 0, "chapter": 1, "concept": 2}
    nodes = sorted(
        builder.nodes.values(),
        key=lambda n: (order[n.kind], str(n.document_id or ""), n.ordinal, n.label.lower()),
    )
    ranked = sorted(edges, key=lambda e: (-e.score, e.id))
    return Atlas(nodes=nodes, edges=ranked, documents=builder.docs, truncated=truncated)
