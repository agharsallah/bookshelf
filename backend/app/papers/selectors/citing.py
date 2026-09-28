"""Selector of `classify-citations` (docs/PAPERS.md §4): each cited work, in its sentences.

    references  [{ordinal, raw, contexts: [{anchor, role, text}]}]  every bibliography entry
                the text cites (`paper_references.cited_at`), in ordinal order; `text` is
                the sentence(s) holding its marker (`papers.citation_context`), `role` the
                role of the unit the passage sits in

A long bibliography stays one prompt: each entry shows at most MAX_CONTEXTS citing passages
of CONTEXT_MAX characters and RAW_MAX characters of its entry, so 150 references stay near
25k tokens (explore tier). Entries never cited in the text are left out: there is nothing to
classify them by. Only the citing passages may be cited back (hard gate, retried).
"""

from collections.abc import Callable
from dataclasses import replace
from typing import Any

from sqlmodel import col, select

from app.models import PaperReference
from app.models.enums import NodeKind
from app.papers.citation_context import context
from app.papers.citations import author_year_cites, numeric_ordinals
from app.papers.selectors import common
from app.pipeline.bodies import count_words
from app.pipeline.selectors import Context, Selection, SelectorError
from app.pipeline.tree import Tree

MAX_CONTEXTS = 3
RAW_MAX = 240


def has_citations(tree: Tree) -> bool:
    """Whether the paper's text cites anything, so `classify-citations` has work: the same
    markers `papers.citations` links to `cited_at`, searched in the prose leaves."""
    return any(
        numeric_ordinals(n.text) or author_year_cites(n.text)
        for n in tree.leaves()
        if n.text and n.kind is not NodeKind.MATH
    )


def _role(ctx: Context, anchor: str) -> str | None:
    node = ctx.tree.by_anchor[anchor]
    chapter = ctx.tree.chapter_of(node)
    return common.role_name(chapter) if chapter is not None else None


def reference_contexts(ctx: Context, ref: PaperReference) -> list[dict[str, Any]]:
    """Up to MAX_CONTEXTS citing passages of `ref`, in reading order, that still exist."""
    first = ref.authors[0] if ref.authors else None
    out: list[dict[str, Any]] = []
    for anchor in ref.cited_at:
        node = ctx.tree.by_anchor.get(anchor)
        if node is None or not node.text or not ctx.tree.is_visible(node):
            continue
        text = context(node.text, ordinal=ref.ordinal, first_author=first, year=ref.year)
        out.append({"anchor": anchor, "role": _role(ctx, anchor), "text": text})
        if len(out) >= MAX_CONTEXTS:
            break
    return out


def paper_citations(ctx: Context) -> Selection:
    """Every in-text-cited bibliography entry with the sentences that cite it."""
    rows = ctx.session.exec(
        select(PaperReference)
        .where(PaperReference.document_id == ctx.tree.document.id)
        .order_by(col(PaperReference.ordinal))
    ).all()
    references: list[dict[str, Any]] = []
    for ref in rows:
        contexts = reference_contexts(ctx, ref)
        if contexts:
            references.append(
                {"ordinal": ref.ordinal, "raw": ref.raw[:RAW_MAX], "contexts": contexts}
            )
    if not references:
        raise SelectorError("no in-text citations to classify")
    allowed = frozenset(c["anchor"] for r in references for c in r["contexts"])
    words = sum(count_words(c["text"]) for r in references for c in r["contexts"])
    selection = ctx.selection({"references": references}, source_words=words)
    return replace(selection, valid_anchors=allowed, visible_anchors=allowed)


SELECTORS: dict[str, Callable[[Context], Selection]] = {"paper_citations": paper_citations}
