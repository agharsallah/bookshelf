"""Deterministic address resolution (D8): phrases → documents, chapter numbers → anchors.

No model, no vectors. Document names are matched fuzzily against every name a reader might
use: the title, the slug, each author's full and last name. The shelf is small (hundreds
of documents), so candidates are scored in Python with `difflib` rather than a trigram
index; one query loads `(id, slug, title, authors)` for every document.
"""

import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher

from sqlmodel import Session, col, select

from app.models import Document, Node
from app.models.enums import NodeKind

MATCH_THRESHOLD = 0.75

_WORD = re.compile(r"[a-z0-9]+")
# Words that name nothing: dropped before comparing a phrase with a document's names.
_NOISE = frozenset(
    {"a", "an", "the", "of", "in", "on", "by", "and", "from", "s", "book", "books"}
    | {"my", "notes", "chapter", "section", "his", "her", "their"}
)
_DIGITS = re.compile(r"(\d+)$")


def words(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower().replace("'s", "")) if w not in _NOISE]


def names(document: Document) -> list[list[str]]:
    """Every way to refer to a document, as word lists."""
    candidates = [words(document.title), words(document.slug.replace("-", " "))]
    for author in document.authors:
        full = words(author)
        candidates += [full, full[-1:]]
    return [c for c in candidates if c]


def similarity(phrase: Sequence[str], name: Sequence[str]) -> float:
    """Max of the Dice word overlap and the character-level ratio (tolerates typos)."""
    if not phrase or not name:
        return 0.0
    overlap = len(set(phrase) & set(name))
    dice = 2 * overlap / (len(set(phrase)) + len(set(name)))
    ratio = SequenceMatcher(None, " ".join(phrase), " ".join(name)).ratio()
    return max(dice, ratio)


@dataclass(frozen=True, slots=True)
class DocumentMatch:
    document: Document
    score: float


def _shelf(session: Session, ids: Iterable[uuid.UUID] | None = None) -> list[Document]:
    query = select(Document)
    if ids is not None:
        query = query.where(col(Document.id).in_(list(ids)))
    return list(session.exec(query.order_by(col(Document.created_at))).all())


def match_document(
    session: Session, phrase: str, *, threshold: float = MATCH_THRESHOLD
) -> DocumentMatch | None:
    """The document `phrase` names best, if any scores at least `threshold`."""
    wanted = words(phrase)
    best: DocumentMatch | None = None
    for document in _shelf(session):
        score = max((similarity(wanted, n) for n in names(document)), default=0.0)
        if score >= threshold and (best is None or score > best.score):
            best = DocumentMatch(document, score)
    return best


def mentioned_documents(session: Session, text: str) -> list[Document]:
    """Documents one of whose names appears word for word in `text` ("Meadows and Senge")."""
    present = set(words(text))
    return [d for d in _shelf(session) if any(set(n) <= present for n in names(d))]


def document_by_slug(session: Session, slug: str) -> Document | None:
    return session.exec(select(Document).where(Document.slug == slug)).first()


def node_at(session: Session, document_id: uuid.UUID, anchor: str) -> Node | None:
    return session.exec(
        select(Node).where(Node.document_id == document_id, Node.anchor == anchor)
    ).first()


def _numbered(nodes: Sequence[Node], number: int) -> Node | None:
    """The node numbered `number`: by the digits its anchor ends with, then by position."""
    for node in nodes:
        match = _DIGITS.search(node.anchor.rsplit("/", 1)[-1])
        if match and int(match.group(1)) == number:
            return node
    return nodes[number - 1] if 0 < number <= len(nodes) else None


def _children(
    session: Session, document_id: uuid.UUID, parent: Node | None, kind: NodeKind
) -> list[Node]:
    query = select(Node).where(Node.document_id == document_id, Node.kind == kind)
    if parent is not None:
        query = query.where(Node.parent_id == parent.id)
    return list(session.exec(query.order_by(col(Node.depth), col(Node.ordinal))).all())


def chapter_node(
    session: Session, document: Document, chapter: int, section: int | None = None
) -> Node | None:
    """Chapter `chapter` (1-based) of `document`, or its section `section` when given."""
    found = _numbered(_children(session, document.id, None, NodeKind.CHAPTER), chapter)
    if found is None or section is None:
        return found
    return _numbered(_children(session, document.id, found, NodeKind.SECTION), section)
