"""Pieces of the book-wide study inputs (`document_distillations`, `document_quotes`).

A chapter-scope study skill (quiz, FAQ, flashcards, quotes) run on a whole book reads the
chapter distillations, not the source: a long book does not fit one prompt, and the
distillations are already cited. What it adds is the book's own view of what matters —
the brief's thesis and big ideas and the guide's cross-chapter themes — so book-wide
material tests the book's argument rather than a sample of its chapters.
"""

from collections import Counter
from typing import Any

from sqlmodel import Session

from app.models import Artifact, Document, Node
from app.models.enums import ArtifactType, NodeKind
from app.pipeline import artifacts
from app.pipeline.bodies import cited_anchors, iter_objects
from app.pipeline.tree import Tree

_BRIEF_KEYS = ("thesis", "ideas")
# Source kinds a quote can be cut from (extract-quotes rejects tables, code and formulas).
_QUOTABLE = frozenset({NodeKind.PARAGRAPH, NodeKind.QUOTE, NodeKind.ASIDE})
# Distillation blocks that single out a passage worth quoting.
_KEY_BLOCKS = frozenset({"callout", "quote"})
PASSAGES_PER_CHAPTER = 12


def book_synthesis(session: Session, document: Document) -> dict[str, Any]:
    """`book_brief`: the brief's thesis and ideas sections; `book_themes`: the guide's
    themes. Empty when the book has neither yet (study material does not wait for them)."""
    brief_kind, guide_kind = ArtifactType.BOOK_BRIEF, ArtifactType.BOOK_GUIDE
    found = artifacts.preferred(session, document.id, [brief_kind, guide_kind])
    brief, guide = found.get((brief_kind, None)), found.get((guide_kind, None))
    sections = brief.body.get("sections", []) if brief is not None else []
    return {
        "book_brief": [s for s in sections if isinstance(s, dict) and s.get("key") in _BRIEF_KEYS],
        "book_themes": guide.body.get("themes", []) if guide is not None else [],
    }


def quote_blocks(quote_set: Artifact | None) -> list[dict[str, Any]]:
    """The quote blocks of a chapter's quote set, as the extract-quotes gates accepted them."""
    if quote_set is None:
        return []
    return [
        b
        for b in quote_set.body.get("blocks", [])
        if isinstance(b, dict) and b.get("type") == "quote"
    ]


def key_passages(tree: Tree, chapter: Node, distillation: dict[str, Any]) -> list[Node]:
    """Quotable source blocks of `chapter` that the distillation's callouts and quote blocks
    cite — the passages the distiller judged central. The most cited first up to
    `PASSAGES_PER_CHAPTER`, then back in reading order."""
    singled_out: set[str] = set()
    for obj in iter_objects(distillation):
        if obj.get("type") in _KEY_BLOCKS:
            singled_out |= cited_anchors(obj)
    weight = Counter(
        anchor
        for obj in iter_objects(distillation)
        for anchor in _cites(obj)
        if anchor in singled_out
    )
    order = {n.anchor: i for i, n in enumerate(tree.leaves(chapter))}
    candidates = [
        tree.by_anchor[a]
        for a in singled_out
        if a in order and tree.by_anchor[a].kind in _QUOTABLE and tree.by_anchor[a].text
    ]
    candidates.sort(key=lambda n: (-weight[n.anchor], order[n.anchor]))
    return sorted(candidates[:PASSAGES_PER_CHAPTER], key=lambda n: order[n.anchor])


def _cites(obj: dict[str, Any]) -> list[str]:
    cites = obj.get("cites")
    return [c for c in cites if isinstance(c, str)] if isinstance(cites, list) else []
