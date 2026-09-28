"""A paper's units (docs/PAPERS.md P3): its top-level sections, as `papers.structure` tagged them.

A paper is parsed like a book, with its IMRaD sections at chapter depth, each carrying
`meta.role` (a `SectionRole`). The paper profile and the paper selectors ask the same
questions of that tree — which sections are distilled, which one is the abstract — so they
live here, over `pipeline.tree.Tree` only (no orchestrator, no selectors, no database).

Not distilled:

* the **abstract**: the authors' own summary, ~150-250 words. A distillation of it would be
  as long as its source, and `dissect-paper` reads its blocks verbatim (and can cite them);
* **references**: the bibliography is parsed into `paper_references`, not distilled (it is
  a skipped container anyway, so it never reaches `Tree.chapters()`).
"""

from app.models import Node
from app.models.enums import NodeKind, SectionRole
from app.pipeline.tree import Tree

UNDISTILLED_ROLES = frozenset({SectionRole.ABSTRACT, SectionRole.REFERENCES})


def role_of(node: Node) -> SectionRole | None:
    """The section's `meta.role`, or None when structure has not tagged it (or tagged it with
    a value this code does not know)."""
    raw = node.meta.get("role")
    try:
        return SectionRole(raw) if isinstance(raw, str) else None
    except ValueError:
        return None


def units(tree: Tree) -> list[Node]:
    """The sections `distil-paper-section` runs over, in reading order: every chapter-depth
    section with text, except the abstract and the references. An untagged paper (structure
    not run) distils every chapter."""
    return [c for c in tree.chapters() if role_of(c) not in UNDISTILLED_ROLES]


def unit_of(tree: Tree, node: Node) -> Node | None:
    """The unit whose distillation covers `node` (None for the abstract, or outside any)."""
    chapter = tree.chapter_of(node)
    if chapter is None or role_of(chapter) in UNDISTILLED_ROLES:
        return None
    return chapter if tree.leaves(chapter) else None


def abstract_of(tree: Tree) -> Node | None:
    """The abstract section, visible and non-empty. Found by walking every chapter, not by
    `Tree.chapters()`, which hides short front matter — and an abstract is short."""
    return next(
        (
            n
            for n in tree.walk()
            if n.kind is NodeKind.CHAPTER and role_of(n) is SectionRole.ABSTRACT and tree.leaves(n)
        ),
        None,
    )
