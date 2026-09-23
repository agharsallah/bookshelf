"""Derived export bundles (§16 Q5): Markdown, JSON and CSV per document.

Regenerated on demand from the tree and the **approved** artifacts, and never read back
as input (D2). `write_bundle` stores all three under `exports/<slug>/`.
"""

import csv
import io
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.models import Artifact, Document, Node
from app.models.enums import NodeKind, Review
from app.schemas.document import DocumentPublic
from app.schemas.export import DocumentExport, ExportArtifact
from app.schemas.node import TreeNode
from app.services import render_markdown as md
from app.services.files import write_atomic
from app.services.tree import TreeItem, build_tree, walk

CSV_COLUMNS = [
    "document",
    "source",
    "anchor",
    "artifact_id",
    "artifact_type",
    "block_index",
    "caption",
    "row",
    "column",
    "header",
    "value",
    "cites",
]


@dataclass(slots=True)
class ExportBundle:
    document: Document
    roots: list[TreeItem]
    artifacts: list[Artifact]


def load_bundle(session: Session, document: Document) -> ExportBundle:
    """The whole tree and the latest approved artifact per (anchor, type, note)."""
    nodes = session.exec(
        select(Node)
        .where(Node.document_id == document.id)
        .order_by(col(Node.depth), col(Node.ordinal))
    ).all()
    roots = build_tree(nodes)
    latest = session.exec(
        select(Artifact)
        .where(Artifact.document_id == document.id, Artifact.review == Review.APPROVED)
        .distinct(col(Artifact.anchor), col(Artifact.type), col(Artifact.note_id))
        .order_by(
            col(Artifact.anchor),
            col(Artifact.type),
            col(Artifact.note_id),
            col(Artifact.version).desc(),
        )
    ).all()
    position = {item.node.anchor: i for i, item in enumerate(walk(roots))}
    # Document-scope artifacts (anchor null) first, then in reading order of their anchor.
    artifacts = sorted(
        latest,
        key=lambda a: (a.anchor is not None, position.get(a.anchor or "", 0), a.type.value),
    )
    return ExportBundle(document=document, roots=roots, artifacts=list(artifacts))


# --- Markdown ------------------------------------------------------------------------


def to_markdown(bundle: ExportBundle, *, media_base: str = "") -> str:
    """The tree as Markdown (every node gets an `<a id="anchor">`), then approved artifacts.

    `media_base` is prefixed to figure `image_path`s (which are relative to `media_dir`):
    the API passes its `/media/` URL, a written bundle a path relative to its folder.
    """
    doc = bundle.document
    parts = [f"# {doc.title}", _front_matter(doc)]
    for root in bundle.roots:
        parts.extend(_node_markdown(root, level=2, media_base=media_base))
    if bundle.artifacts:
        parts.append("## Distillations")
        for artifact in bundle.artifacts:
            scope = f" · [{artifact.anchor}](#{artifact.anchor})" if artifact.anchor else ""
            title = artifact.type.value.replace("_", " ").capitalize()
            marker = f"<!-- artifact {artifact.id} v{artifact.version} -->"
            parts.append(f"### {title}{scope}\n\n{marker}")
            rendered = md.render_blocks(md.body_blocks(artifact.body))
            if rendered:
                parts.append(rendered)
    return "\n\n".join(p for p in parts if p) + "\n"


def _front_matter(doc: Document) -> str:
    lines = []
    if doc.authors:
        lines.append(f"*{', '.join(doc.authors)}*" + (f" ({doc.year})" if doc.year else ""))
    elif doc.year:
        lines.append(f"*{doc.year}*")
    lines.append(f"<!-- bookshelf document {doc.id} · slug {doc.slug} -->")
    return "\n\n".join(lines)


def _anchor_tag(anchor: str) -> str:
    return f'<a id="{anchor}"></a>'


def _node_markdown(item: TreeItem, *, level: int, media_base: str) -> list[str]:
    node = item.node
    if node.kind.is_container:
        heading = node.heading or node.anchor
        out = [f"{_anchor_tag(node.anchor)}\n\n{'#' * min(level, 6)} {heading}"]
        for child in item.children:
            out.extend(_node_markdown(child, level=level + 1, media_base=media_base))
        return out
    return [_leaf_markdown(node, media_base)]


def _leaf_markdown(node: Node, media_base: str) -> str:
    meta = node.meta or {}
    text = (node.text or "").strip()
    tag = _anchor_tag(node.anchor)
    caption = meta.get("caption")
    if node.kind is NodeKind.TABLE and isinstance(meta.get("table"), dict):
        header, rows = _node_table(meta["table"])
        body = md.markdown_table(header, rows)
        return f"{tag}\n\n" + (f"*{caption}*\n\n{body}" if caption else body)
    if node.kind is NodeKind.FIGURE:
        path = meta.get("image_path")
        image = f"![{caption or 'Figure'}]({media_base}{path})" if path else ""
        lines = [line for line in (image, f"*{caption}*" if caption else "", text) if line]
        return f"{tag}\n\n" + "\n\n".join(lines or ["*Figure*"])
    if node.kind is NodeKind.CODE:
        return f"{tag}\n\n{md.fence(node.text or '', str(meta.get('language', '')))}"
    if node.kind is NodeKind.MATH:
        return f"{tag}\n\n$$\n{meta.get('latex') or text}\n$$"
    if node.kind in (NodeKind.QUOTE, NodeKind.ASIDE):
        label = f"**{meta['label']}**\n" if meta.get("label") else ""
        quoted = "\n".join(f"> {line}" if line else ">" for line in f"{label}{text}".split("\n"))
        return f"{tag}\n\n{quoted}"
    return f"{tag}{text}"  # paragraph, list: inline anchor keeps it one Markdown block


def _node_table(table: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    header = [str(h) for h in table.get("header") or []]
    rows = [[str(c) for c in row] for row in table.get("rows") or [] if isinstance(row, list)]
    return header, rows


# --- JSON ----------------------------------------------------------------------------


def to_export(bundle: ExportBundle) -> DocumentExport:
    return DocumentExport(
        document=DocumentPublic.model_validate(bundle.document),
        tree=[TreeNode.from_item(root) for root in bundle.roots],
        artifacts=[ExportArtifact.model_validate(a) for a in bundle.artifacts],
    )


def to_json(bundle: ExportBundle) -> str:
    return to_export(bundle).model_dump_json(indent=2) + "\n"


# --- CSV -----------------------------------------------------------------------------


def to_csv(bundle: ExportBundle) -> str:
    """Every table node and every table/chart block, one CSV row per cell (long format).

    Long format keeps tables of different widths in one uniform file; `row`/`column`
    are 1-based, `header` is the column's heading, `cites` the cell's (or chart's) cites.
    """
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()
    slug = bundle.document.slug
    for item in walk(bundle.roots):
        node = item.node
        table = (node.meta or {}).get("table")
        if node.kind is NodeKind.TABLE and isinstance(table, dict):
            header, rows = _node_table(table)
            base = {"document": slug, "source": "node", "anchor": node.anchor}
            base["caption"] = str((node.meta or {}).get("caption") or "")
            _write_cells(writer, base, header, [[(c, "") for c in r] for r in rows])
    for artifact in bundle.artifacts:
        for index, block in enumerate(md.body_blocks(artifact.body)):
            base = {
                "document": slug,
                "source": "artifact",
                "anchor": artifact.anchor or "",
                "artifact_id": str(artifact.id),
                "artifact_type": artifact.type.value,
                "block_index": str(index),
            }
            if block.get("type") == "table":
                cells = [
                    [(str(s.get("text", "")), " ".join(s.get("cites", []))) for s in row]
                    for row in block.get("rows", [])
                ]
                base["caption"] = str(block.get("caption") or "")
                _write_cells(writer, base, [str(h) for h in block.get("header", [])], cells)
            elif block.get("type") == "chart":
                header, rows = md.chart_rows(block)
                cites = " ".join(block.get("cites", []))
                base["caption"] = str(block.get("title") or "")
                _write_cells(writer, base, header, [[(c, cites) for c in r] for r in rows])
    return buffer.getvalue()


def _write_cells(
    writer: "csv.DictWriter[str]",
    base: dict[str, str],
    header: list[str],
    rows: list[list[tuple[str, str]]],
) -> None:
    for r, row in enumerate(rows, 1):
        for c, (value, cites) in enumerate(row, 1):
            column_header = header[c - 1] if c <= len(header) else ""
            cell = {"row": r, "column": c, "header": column_header, "value": value}
            writer.writerow({**base, **cell, "cites": cites})


# --- files ---------------------------------------------------------------------------


def bundle_paths(exports_dir: Path, slug: str) -> dict[str, Path]:
    folder = exports_dir / slug
    return {
        "markdown": folder / f"{slug}.md",
        "json": folder / f"{slug}.json",
        "csv": folder / "tables.csv",
    }


def write_bundle(bundle: ExportBundle, exports_dir: Path, media_dir: Path) -> dict[str, Path]:
    """Write the three exports to `exports_dir/<slug>/`, each file replaced atomically."""
    paths = bundle_paths(exports_dir, bundle.document.slug)
    folder = paths["markdown"].parent
    media_base = Path(os.path.relpath(media_dir.resolve(), folder.resolve())).as_posix() + "/"
    write_atomic(paths["markdown"], to_markdown(bundle, media_base=media_base).encode())
    write_atomic(paths["json"], to_json(bundle).encode())
    write_atomic(paths["csv"], to_csv(bundle).encode())
    return paths
