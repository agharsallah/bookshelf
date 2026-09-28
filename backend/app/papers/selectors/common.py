"""Pieces every paper selector shares, built from the tree and the paper tables.

Selectors must be deterministic (same database, same `input_hash`), and a paper's metadata
keeps moving after ingest: `paper_enrich` refreshes counts and topics from OpenAlex. So the
inputs carry only what changes the output — identifiers, venue, year, code and data links —
and never `cited_by_count` or `fields`, which would re-run every paper skill on each
enrichment. The abstract comes from the tree (citable, stable) when structure found one,
else from `paper_meta.abstract` as uncitable context.
"""

from typing import Any

from sqlmodel import Session, col, select

from app.models import Node, PaperMeta, PaperReference
from app.models.enums import ArtifactType
from app.papers.units import abstract_of, role_of, units
from app.pipeline import artifacts
from app.pipeline.selectors import Context, SelectorError
from app.pipeline.tree import Tree, block

REFERENCE_RAW_MAX = 300  # chars of a bibliography entry shown next to a unit


def paper_meta(session: Session, tree: Tree) -> dict[str, Any]:
    """The stable part of `paper_meta`: every key present, None or [] when unknown."""
    meta = session.get(PaperMeta, tree.document.id)
    if meta is None:
        return {"doi": None, "arxiv_id": None, "venue": None, "year": None,
                "code_urls": [], "data_urls": []}  # fmt: skip
    return {
        "doi": meta.doi,
        "arxiv_id": meta.arxiv_id,
        "venue": meta.venue,
        "year": meta.year,
        "code_urls": list(meta.code_urls),
        "data_urls": list(meta.data_urls),
    }


def abstract(session: Session, tree: Tree) -> dict[str, Any] | None:
    """`{anchor, blocks}` from the abstract section; `{anchor: None, text}` from
    `paper_meta` when the tree has none; None when neither exists."""
    node = abstract_of(tree)
    if node is not None:
        return {"anchor": node.anchor, "blocks": [block(n) for n in tree.leaves(node)]}
    meta = session.get(PaperMeta, tree.document.id)
    if meta is not None and meta.abstract:
        return {"anchor": None, "text": meta.abstract}
    return None


def outline(tree: Tree) -> list[dict[str, Any]]:
    """The paper's units in reading order, `{heading, role}` (role None if untagged): where
    a unit sits in the paper. No anchors, so a unit's skill is not invited to cite others."""
    return [{"heading": u.heading, "role": role_name(u)} for u in units(tree)]


def abstract_text(session: Session, tree: Tree) -> str | None:
    """The abstract as plain text (orientation only: no anchors to cite)."""
    found = abstract(session, tree)
    if found is None:
        return None
    if "text" in found:
        return str(found["text"])
    return "\n\n".join(b["text"] for b in found["blocks"] if b.get("text"))


def subsections(tree: Tree, unit: Node) -> list[dict[str, Any]]:
    """The visible containers inside a unit (`3.1 Encoder and Decoder Stacks`), in reading
    order, so a skill can tell which blocks belong together: `{anchor, heading}`."""
    return [
        {"anchor": n.anchor, "heading": n.heading}
        for n in tree.walk(unit)
        if n.kind.is_container and n.heading
    ]


def cited_references(session: Session, tree: Tree, unit: Node) -> list[dict[str, Any]]:
    """Bibliography entries cited inside `unit` (`paper_references.cited_at`), by ordinal:
    `{ordinal, raw}`. `raw` is the parsed entry as printed (stable; enrichment never edits
    it), cut to REFERENCE_RAW_MAX characters."""
    inside = {n.anchor for n in tree.walk(unit)}
    rows = session.exec(
        select(PaperReference)
        .where(PaperReference.document_id == tree.document.id)
        .order_by(col(PaperReference.ordinal))
    ).all()
    return [
        {"ordinal": ref.ordinal, "raw": ref.raw[:REFERENCE_RAW_MAX]}
        for ref in rows
        if inside.intersection(ref.cited_at)
    ]


def unit_distillations(ctx: Context) -> list[dict[str, Any]]:
    """Every unit's preferred `chapter_distillation`: `{anchor, heading, role, body}`.
    Raises `SelectorError` before the first one exists."""
    kind = ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind])
    items = [
        {
            "anchor": u.anchor,
            "heading": u.heading,
            "role": role_name(u),
            "body": found[(kind, u.anchor)].body,
        }
        for u in units(ctx.tree)
        if (kind, u.anchor) in found
    ]
    if not items:
        raise SelectorError("no unit distillations yet")
    return items


def preferred_body(ctx: Context, kind: ArtifactType) -> dict[str, Any] | None:
    """The document-scope artifact of `kind` a skill should read (approved, else the latest
    non-rejected), or None."""
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind]).get((kind, None))
    return found.body if found is not None else None


def role_name(node: Node) -> str | None:
    """The unit's role as the inputs spell it (None when untagged)."""
    role = role_of(node)
    return role.value if role is not None else None
