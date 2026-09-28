"""Named input selectors (skills/README.md): the exact JSON a skill receives.

A selector is deterministic: the same database state yields the same inputs and so the
same `input_hash`. Prior artifacts are read with the §7 draft-vs-approved rule (latest
approved, else latest non-rejected) via `artifacts.preferred`, and low-confidence element
explanations stay out of `figures` until a human approves them.
"""

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.core.config import get_settings
from app.models import Artifact, Concept, Document, Node, Note
from app.models.enums import ArtifactType, NodeKind, Review
from app.pipeline import artifacts
from app.pipeline.bodies import count_words, plain_text
from app.pipeline.book_inputs import book_synthesis, key_passages, quote_blocks
from app.pipeline.tree import Tree, block, document_envelope, scope_envelope

_OUTLINE_PAGES, _OUTLINE_LINES = 30, 25
_CONTEXT_BLOCKS = 2
_MAX_CONCEPTS = 500
_SECTION_KINDS = frozenset({NodeKind.SECTION, NodeKind.CHAPTER})


class SelectorError(ValueError):
    """The scope cannot produce inputs (unknown anchor, nothing to distil yet, ...)."""


@dataclass(frozen=True, slots=True)
class Selection:
    inputs: dict[str, Any]
    source_words: int  # words of source text under the scope: the compression denominator
    valid_anchors: frozenset[str]
    images: tuple[Path, ...] = ()  # absolute, for the CLI's `--add-dir`; never hashed
    element: dict[str, Any] | None = None
    # What the skill could see: the scope's subtree plus every anchor named anywhere in
    # `inputs` (e.g. the blocks section notes cite). None: every valid anchor.
    visible_anchors: frozenset[str] | None = None
    # Book-wide inputs: the chapters offered, for the `coverage_min` gate. Empty: no check.
    chapters: tuple[str, ...] = ()

    def prompt_inputs(self) -> dict[str, Any]:
        """`inputs` as the batch prompt shows them: the element's media-relative
        `image_path` resolved to the absolute file the CLI must read. `inputs` itself (and
        so `input_hash`, and the interactive inputs endpoint) keeps the relative path."""
        element = self.inputs.get("element")
        if not self.images or not isinstance(element, dict) or "image_path" not in element:
            return self.inputs
        return {**self.inputs, "element": {**element, "image_path": str(self.images[0])}}


@dataclass(frozen=True, slots=True)
class Context:
    session: Session
    tree: Tree
    node: Node | None  # None = whole document
    note: Note | None
    media_dir: Path
    section_scope: bool = False  # a section-scope skill: a chapter with sections = its intro

    def leaves(self) -> list[Node]:
        """The leaves this scope covers (rank-isolated for section-scope skills)."""
        if self.section_scope and self.node is not None:
            return self.tree.scope_leaves(self.node)
        return self.tree.leaves(self.node)

    def base(self) -> dict[str, Any]:
        return {
            "document": document_envelope(self.tree.document),
            "scope": scope_envelope(self.tree, self.node),
        }

    def source_words(self, node: Node | None = None) -> int:
        leaves = self.tree.leaves(node) if node is not None else self.leaves()
        return sum(count_words(n.text or "") for n in leaves)

    def selection(self, extra: dict[str, Any], **kwargs: Any) -> Selection:
        inputs = {**self.base(), **extra}
        return Selection(
            inputs=inputs,
            source_words=kwargs.pop("source_words", self.source_words()),
            valid_anchors=self.tree.anchors,
            visible_anchors=self.visible_anchors(inputs),
            **kwargs,
        )

    def visible_anchors(self, inputs: dict[str, Any]) -> frozenset[str]:
        """The scope's subtree, plus every anchor the inputs mention (any string value)."""
        known = self.tree.anchors
        if self.node is None:
            return known
        subtree = {self.node.anchor, *(n.anchor for n in self.tree.walk(self.node))}
        return frozenset(subtree | {s for s in _strings(inputs) if s in known})

    def require_node(self) -> Node:
        if self.node is None:
            raise SelectorError("this selector needs an anchor")
        return self.node


# --- Shared pieces -----------------------------------------------------------------------


def _strings(value: Any) -> Iterator[str]:
    """Every string in a JSON value, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _strings(child)


def _in_scope(anchor: str | None, scope: Node | None) -> bool:
    if scope is None:
        return True
    return anchor is not None and (anchor == scope.anchor or anchor.startswith(scope.anchor + "/"))


def _figures(
    ctx: Context, scope: Node | None, only: set[str] | None = None
) -> list[dict[str, Any]]:
    """Element explanations under `scope` (restricted to the anchors in `only`, if given)."""
    order = {n.anchor: i for i, n in enumerate(ctx.tree.walk())}
    chosen = artifacts.preferred(ctx.session, ctx.tree.document.id, artifacts.ELEMENT_TYPES)
    found = [
        a
        for a in chosen.values()
        if _in_scope(a.anchor, scope)
        and a.anchor in order
        and (only is None or a.anchor in only)
        and artifacts.is_consumable(a)
    ]
    found.sort(key=lambda a: (order[a.anchor or ""], a.type.value))
    return [
        {"anchor": a.anchor, "takeaway": a.body.get("takeaway"), "blocks": a.body.get("blocks", [])}
        for a in found
    ]


def _concepts(session: Session) -> list[dict[str, Any]]:
    rows = session.exec(
        select(Concept)
        .where(col(Concept.merged_into).is_(None))
        .order_by(col(Concept.canonical))
        .limit(_MAX_CONCEPTS)
    ).all()
    return [
        {"canonical": c.canonical, "aliases": list(c.aliases), "kind": c.kind.value} for c in rows
    ]


def _shelf(session: Session, document_id: uuid.UUID) -> list[dict[str, Any]]:
    """Other documents' brief theses, for read-next pointers and cross-book links."""
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.type == ArtifactType.BOOK_BRIEF,
            Artifact.document_id != document_id,
            Artifact.review != Review.REJECTED,
        )
        .order_by(col(Artifact.version))
    ).all()
    briefs = artifacts.pick_preferred(rows, lambda row: row.document_id)
    shelf = []
    for doc_id, brief in briefs.items():
        doc = session.get(Document, doc_id)
        sections = brief.body.get("sections", [])
        thesis = next((s for s in sections if isinstance(s, dict) and s.get("key") == "thesis"), {})
        if doc is not None:
            shelf.append({**document_envelope(doc), "thesis": plain_text(thesis)})
    shelf.sort(key=lambda d: d["slug"])
    return shelf


def _distillation_item(node: Node, artifact: Artifact) -> dict[str, Any]:
    return {"anchor": node.anchor, "heading": node.heading, "body": artifact.body}


# --- The selectors -------------------------------------------------------------------


def outline_pages(ctx: Context) -> Selection:
    pages: dict[int, list[str]] = {}
    for leaf in ctx.tree.leaves():
        page = leaf.page_from
        if page is None or page > _OUTLINE_PAGES or not leaf.text:
            continue
        pages.setdefault(page, []).extend(line for line in leaf.text.splitlines() if line.strip())
    listed = [{"page": p, "lines": lines[:_OUTLINE_LINES]} for p, lines in sorted(pages.items())]
    toc = ctx.tree.document.meta.get("toc_text", "")
    return ctx.selection({"pages": listed, "toc_text": toc if isinstance(toc, str) else ""})


def element_context(ctx: Context) -> Selection:
    node = ctx.require_node()
    if node.kind.is_container:
        raise SelectorError(f"{node.anchor} is a {node.kind.value}, not an element")
    leaves = ctx.tree.leaves()
    at = next(i for i, n in enumerate(leaves) if n.id == node.id)
    around = leaves[max(at - _CONTEXT_BLOCKS, 0) : at] + leaves[at + 1 : at + 1 + _CONTEXT_BLOCKS]
    element: dict[str, Any] = {
        "anchor": node.anchor,
        "kind": node.kind.value,
        "text": node.text,
        "meta": node.meta,
    }
    images: tuple[Path, ...] = ()
    raw_path = node.meta.get("image_path")
    if isinstance(raw_path, str) and raw_path:
        path = Path(raw_path) if Path(raw_path).is_absolute() else ctx.media_dir / raw_path
        # Hashed inputs carry the path relative to the media dir (as the parser stores it),
        # so `input_hash` does not depend on where the checkout lives.
        element["image_path"] = _media_relative(path, ctx.media_dir)
        images = (path,)
    words = count_words(node.text or "") or count_words(str(node.meta.get("caption", "")))
    return ctx.selection(
        {"element": element, "context": [block(n) for n in around]},
        source_words=words,
        images=images,
        element=element,
    )


def _media_relative(path: Path, media_dir: Path) -> str:
    try:
        return path.relative_to(media_dir).as_posix()
    except ValueError:  # an absolute path outside the media dir (legacy rows): keep it
        return path.as_posix()


def scope_blocks(ctx: Context) -> Selection:
    """All leaves under the scope; for a section-scope skill on a chapter that has
    sections, only the chapter's intro leaves (the sections have notes of their own)."""
    leaves = ctx.leaves()
    if not leaves:
        raise SelectorError("no blocks under this scope")
    only = {n.anchor for n in leaves} if ctx.section_scope else None
    figures = _figures(ctx, ctx.node, only)
    return ctx.selection({"blocks": [block(n) for n in leaves], "figures": figures})


def chapter_section_notes(ctx: Context) -> Selection:
    chapter = ctx.require_node()
    notes = artifacts.preferred(ctx.session, ctx.tree.document.id, [ArtifactType.SECTION_NOTE])
    items = [
        _distillation_item(scope, notes[(ArtifactType.SECTION_NOTE, scope.anchor)])
        for scope in ctx.tree.section_scopes(chapter)
        if (ArtifactType.SECTION_NOTE, scope.anchor) in notes
    ]
    if not items:
        raise SelectorError(f"{chapter.anchor} has no section notes yet")
    return ctx.selection({"section_notes": items, "figures": _figures(ctx, chapter)})


def _distilled_chapters(ctx: Context) -> list[dict[str, Any]]:
    kind = ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind])
    items = [
        _distillation_item(ch, found[(kind, ch.anchor)])
        for ch in ctx.tree.chapters()
        if (kind, ch.anchor) in found
    ]
    if not items:
        raise SelectorError("no chapter distillations yet")
    return items


def document_chapters(ctx: Context) -> Selection:
    return ctx.selection(
        {
            "chapter_distillations": _distilled_chapters(ctx),
            "shelf": _shelf(ctx.session, ctx.tree.document.id),
            "existing_concepts": _concepts(ctx.session),
        }
    )


def document_distillations(ctx: Context) -> Selection:
    """Book-wide quiz, FAQ and flashcards: every chapter distillation plus the book's own
    synthesis (`book_inputs.book_synthesis`). No shelf or concepts: they would not change
    the output, but would change its hash whenever the shelf grows."""
    items = _distilled_chapters(ctx)
    return ctx.selection(
        {"chapter_distillations": items, **book_synthesis(ctx.session, ctx.tree.document)},
        chapters=tuple(item["anchor"] for item in items),
    )


def document_quotes(ctx: Context) -> Selection:
    """Book-wide quotes. The whole source is too long for one prompt, so each chapter offers
    verbatim candidates: its quote set, and the source passages its distillation singles out
    (`book_inputs.key_passages`) that the quote set does not already cover."""
    quotes_kind, distil_kind = ArtifactType.QUOTE_SET, ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [quotes_kind, distil_kind])
    chapters = []
    for chapter in ctx.tree.chapters():
        quotes = quote_blocks(found.get((quotes_kind, chapter.anchor)))
        quoted = {anchor for q in quotes for anchor in q.get("cites", [])}
        distillation = found.get((distil_kind, chapter.anchor))
        passages = (
            [block(n) for n in key_passages(ctx.tree, chapter, distillation.body)]
            if distillation is not None
            else []
        )
        passages = [p for p in passages if p["anchor"] not in quoted]
        if quotes or passages:
            chapters.append(
                {
                    "anchor": chapter.anchor,
                    "heading": chapter.heading,
                    "quotes": quotes,
                    "passages": passages,
                }
            )
    if not chapters:
        raise SelectorError("no chapter quotes or distillations yet")
    return ctx.selection(
        {"chapters": chapters, **book_synthesis(ctx.session, ctx.tree.document)},
        chapters=tuple(c["anchor"] for c in chapters),
    )


def chapter_distillation(ctx: Context) -> Selection:
    chapter = ctx.require_node()
    kind = ArtifactType.CHAPTER_DISTILLATION
    chosen = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind])
    found = chosen.get((kind, chapter.anchor))
    if found is None:
        raise SelectorError(f"{chapter.anchor} has no chapter distillation yet")
    return ctx.selection({"chapter_distillations": [_distillation_item(chapter, found)]})


def chapter_salience(ctx: Context) -> Selection:
    """The chapter's leaves to mark, with its preferred distillation when there is one: the
    claims the study note makes, and the blocks it cites, hint at what the chapter rests on."""
    chapter = ctx.require_node()
    leaves = ctx.leaves()
    if not leaves:
        raise SelectorError("no blocks under this scope")
    kind = ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind]).get(
        (kind, chapter.anchor)
    )
    return ctx.selection(
        {"blocks": [block(n) for n in leaves], "distillation": found.body if found else None}
    )


def note_context(ctx: Context) -> Selection:
    note, node = ctx.note, ctx.node
    if note is None:
        raise SelectorError("note_context needs a note_id")
    if note.raw is None:
        raise SelectorError(f"note {note.id} is a plain highlight: no words to structure")
    if node is None:
        raise SelectorError(f"note {note.id} is detached: anchor {note.anchor} no longer exists")
    span = note.range or {}
    start, end = span.get("start"), span.get("end")
    if note.quote is not None:  # a passage of the distillation/summary, not the source
        highlighted: str | None = note.quote
    else:
        highlighted = (
            node.text[start:end]
            if node.text and isinstance(start, int) and isinstance(end, int)
            else None
        )
    section = ctx.tree.enclosing(node, _SECTION_KINDS) or node
    chapter = ctx.tree.chapter_of(node)
    kind = ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind])
    distillation = found.get((kind, chapter.anchor)) if chapter is not None else None
    return ctx.selection(
        {
            "note": {
                "id": str(note.id),
                "raw": note.raw,
                "anchor": note.anchor,
                "highlighted_text": highlighted,
                "marks": note.target.value,
            },
            "blocks": [block(n) for n in ctx.tree.leaves(section)],
            "distillation": distillation.body if distillation is not None else None,
            "existing_concepts": _concepts(ctx.session),
        },
        source_words=count_words(note.raw),
    )


SELECTORS: dict[str, Callable[[Context], Selection]] = {
    "outline_pages": outline_pages,
    "element_context": element_context,
    "scope_blocks": scope_blocks,
    "chapter_section_notes": chapter_section_notes,
    "document_chapters": document_chapters,
    "document_distillations": document_distillations,
    "document_quotes": document_quotes,
    "chapter_distillation": chapter_distillation,
    "chapter_salience": chapter_salience,
    "note_context": note_context,
}


def registry() -> dict[str, Callable[[Context], Selection]]:
    """`SELECTORS` plus the paper skills' (`app.papers.selectors`), imported on first use
    because they build on this module's `Context` and `Selection`."""
    from app.papers.selectors import SELECTORS as PAPER_SELECTORS

    return {**SELECTORS, **PAPER_SELECTORS}


def select_inputs(
    session: Session,
    selector: str,
    document: Document,
    anchor: str | None,
    *,
    note_id: uuid.UUID | None = None,
    media_dir: Path | None = None,
    section_scope: bool = False,
) -> Selection:
    """Build a skill's inputs. Raises `SelectorError` when the scope cannot supply them.

    `section_scope`: the skill distils one section scope (`meta.scope: section`), so a
    chapter anchor with sections means the chapter's intro leaves only.
    """
    fn = registry().get(selector)
    if fn is None:
        raise SelectorError(f"unknown selector {selector!r}")
    tree = Tree.load(session, document)
    note = session.get(Note, note_id) if note_id is not None else None
    if note_id is not None and (note is None or note.document_id != document.id):
        raise SelectorError(f"note {note_id} does not belong to {document.slug}")
    scope_anchor = note.anchor if note is not None and anchor is None else anchor
    node = tree.by_anchor.get(scope_anchor) if scope_anchor is not None else None
    if scope_anchor is not None and node is None and note is None:
        raise SelectorError(f"{document.slug} has no anchor {scope_anchor!r}")
    if node is not None and not tree.is_visible(node):
        raise SelectorError(f"{scope_anchor} is inside a skipped container")
    ctx = Context(
        session=session,
        tree=tree,
        node=node,
        note=note,
        media_dir=media_dir or get_settings().media_dir,
        section_scope=section_scope,
    )
    return fn(ctx)
