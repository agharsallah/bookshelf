"""`paper_structure` (docs/PAPERS.md §3 "Structure"): a parsed paper's tree → roles, meta,
bibliography and in-text citations. Deterministic and idempotent; re-run after every parse.

    nodes ──► top-level sections: meta.role (sections.role_for); references and
    │         acknowledgements get meta.skip
    ├──► paper_meta     DOI · arXiv id · year · abstract (frontpage / GROBID), never over a
    │                   `source = human` row; an OpenAlex row only gets its gaps filled
    ├──► paper_references  refparse (or GROBID) → upsert by (document, ordinal); an entry
    │                   whose text changed loses its stale intent; vanished ordinals go
    └──► cited_at       citations.link_citations over the body leaves; target_document_id
                        from the shelf (DOI / arXiv id, else title + year)

The abstract is its own unit when the parser found its heading (`papers.headings` splits a
run-in `Abstract—…`); a tree without one (an override, another format) only gets
`paper_meta.abstract` from the first page. Restructuring stored nodes here would renumber
every anchor, so it is left to the parser.
"""

import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.db.session import release
from app.models import Document, Node, PaperMeta, PaperReference
from app.models._columns import utcnow
from app.models.enums import PaperMetaSource, SectionRole
from app.papers import sections
from app.papers.citations import link_citations
from app.papers.frontpage import FrontPage, page_text, read_front_page
from app.papers.grobid import Grobid, GrobidError, GrobidHeader
from app.papers.refparse import Leaf, ParsedReference, entry_marker, parse_references
from app.papers.shelf import load_shelf
from app.services.library import resolve_source_path

logger = logging.getLogger(__name__)

_OURS = frozenset({PaperMetaSource.PARSED, PaperMetaSource.GROBID})


@dataclass(slots=True)
class _Nodes:
    children: dict[uuid.UUID | None, list[Node]] = field(default_factory=dict)

    @classmethod
    def load(cls, session: Session, document_id: uuid.UUID) -> "_Nodes":
        tree = cls()
        rows = session.exec(
            select(Node).where(Node.document_id == document_id).order_by(col(Node.ordinal))
        ).all()
        for node in rows:
            tree.children.setdefault(node.parent_id, []).append(node)
        return tree

    @property
    def roots(self) -> list[Node]:
        return self.children.get(None, [])

    def leaves(self, root: Node | None, *, skip_hidden: bool = False) -> list[Node]:
        """Leaves under `root` (all roots when None) in reading order."""
        out: list[Node] = []
        stack = list(reversed(self.children.get(root.id if root else None, [])))
        while stack:
            node = stack.pop()
            if not node.kind.is_container:
                out.append(node)
            elif not (skip_hidden and node.meta.get("skip")):
                stack.extend(reversed(self.children.get(node.id, [])))
        return out


def _units(nodes: _Nodes) -> list[Node]:
    return [n for n in nodes.roots if n.kind.is_container and not n.meta.get("front_matter")]


def tag_roles(session: Session, nodes: _Nodes) -> dict[str, SectionRole]:
    """Write `meta.role` (and `skip` for references / acknowledgements) on every unit."""
    units = _units(nodes)
    roles = sections.role_for([u.heading or "" for u in units])
    for unit, role in zip(units, roles, strict=True):
        meta = {**unit.meta, "role": role.value}
        if sections.skipped(role, unit.heading or ""):
            meta["skip"] = True
        if meta != unit.meta:
            unit.meta = meta  # a new dict: jsonb columns need reassigning
            session.add(unit)
    return {u.anchor: r for u, r in zip(units, roles, strict=True)}


def _with_footnotes(node: Node) -> str:
    """A leaf's text plus its footnotes (`QANet is described in Yu et al. (2018)`)."""
    notes = node.meta.get("footnotes") or []
    extra = [n["text"] for n in notes if isinstance(n, dict) and isinstance(n.get("text"), str)]
    return " ".join([node.text or "", *extra])


def _text_of(nodes: list[Node]) -> str:
    return " ".join((n.text or "").strip() for n in nodes if (n.text or "").strip())


def _align(parsed: list[ParsedReference], grobid: list[ParsedReference]) -> list[ParsedReference]:
    """GROBID's entries, with the parsed ones' anchors, ordinals and year labels when the
    two agree on the count (GROBID has no anchors and drops `[n]` / `2018a`)."""
    if len(parsed) != len(grobid):
        return grobid
    for ours, theirs in zip(parsed, grobid, strict=True):
        theirs.anchor, theirs.ordinal = ours.anchor, ours.ordinal
        if ours.year_label and theirs.year == ours.year:
            theirs.year_label = ours.year_label
    return grobid


def _store_meta(
    session: Session, document: Document, values: dict[str, Any], source: PaperMetaSource
) -> bool:
    """Upsert `paper_meta`; False when a person owns the row."""
    meta = session.get(PaperMeta, document.id) or PaperMeta(document_id=document.id)
    if meta.source is PaperMetaSource.HUMAN:
        return False
    ours = meta.source in _OURS
    for name, value in values.items():
        if value is not None and (ours or getattr(meta, name) is None):
            setattr(meta, name, value)
    if ours:
        meta.source = source
    meta.updated_at = utcnow()
    session.add(meta)
    return True


def _store_references(
    session: Session, document: Document, refs: list[ParsedReference], cited: dict[int, list[str]]
) -> int:
    """Upsert one row per entry by ordinal; rows for vanished ordinals are deleted."""
    existing = {
        r.ordinal: r
        for r in session.exec(
            select(PaperReference).where(PaperReference.document_id == document.id)
        )
    }
    shelf = load_shelf(session)
    for ref in refs:
        row = existing.pop(ref.ordinal, None) or PaperReference(
            document_id=document.id, ordinal=ref.ordinal, raw=ref.raw
        )
        if row.raw != ref.raw:  # a different entry now: its classified intent is stale
            row.intent, row.intent_cites = None, []
        row.raw, row.anchor, row.title = ref.raw, ref.anchor, ref.title
        row.authors, row.year, row.venue = ref.authors, ref.year, ref.venue
        row.doi, row.arxiv_id = ref.doi, ref.arxiv_id
        row.cited_at = cited.get(ref.ordinal, [])
        row.target_document_id = shelf.match(
            openalex_id=row.openalex_id, doi=ref.doi, arxiv_id=ref.arxiv_id,
            title=ref.title, year=ref.year, exclude=document.id,
        )  # fmt: skip
        session.add(row)
    for stale in existing.values():
        session.delete(stale)
    return len(refs)


def _source_path(library_dir: Path, document: Document) -> Path | None:
    try:
        return resolve_source_path(library_dir, document.source_path)
    except (ValueError, OSError):
        return None


def _fill_document(document: Document, front: FrontPage, header: GrobidHeader | None) -> None:
    """Authors from page one when the document has none (a person's edit always wins)."""
    authors = (header.authors if header else []) or front.authors
    if authors and not document.authors:
        document.authors = authors


def run_structure(
    session: Session, document: Document, *, library_dir: Path, grobid: Grobid | None = None
) -> dict[str, Any]:
    """Structure one paper (module docstring). Commits. Returns the job's report."""
    nodes = _Nodes.load(session, document.id)
    roles = tag_roles(session, nodes)
    units = _units(nodes)
    by_role: dict[SectionRole, Node] = {}
    for unit, role in zip(units, roles.values(), strict=True):
        by_role.setdefault(role, unit)
    ref_units = [
        u for u, r in zip(units, roles.values(), strict=True) if r is SectionRole.REFERENCES
    ]
    ref_leaves = [
        Leaf(n.anchor, n.text or "", bool(n.meta.get("reference")))
        for unit in ref_units
        for n in nodes.leaves(unit)
    ]
    body = [(n.anchor, _with_footnotes(n)) for n in nodes.leaves(None, skip_hidden=True)]
    abstract_unit = by_role.get(SectionRole.ABSTRACT)
    abstract = _text_of(nodes.leaves(abstract_unit)) if abstract_unit else ""

    path = _source_path(library_dir, document)
    first_page = (page_text(path) if path else "") or _text_of(
        [n for n in nodes.leaves(None) if n.page_from == 1]
    )
    front = read_front_page(first_page, title=document.title)
    refs = parse_references(ref_leaves)
    numbered = bool(refs) and all(entry_marker(r.raw) is not None for r in refs)

    header: GrobidHeader | None = None
    if grobid is not None and path is not None and path.suffix.lower() == ".pdf" and path.is_file():
        release(session)  # no open transaction during the HTTP calls
        pdf = path.read_bytes()
        try:
            header = grobid.header(pdf)
            refs = _align(refs, grobid.references(pdf)) or refs
        except GrobidError as exc:  # the heuristics still work: degrade, don't fail
            logger.warning("GROBID failed; using the parsed structure", extra={"error": str(exc)})
            header = None

    cited = link_citations(body, refs, numbered=numbered)
    values: dict[str, Any] = {
        "doi": (header.doi if header else None) or front.doi,
        "arxiv_id": (header.arxiv_id if header else None) or front.arxiv_id,
        "year": (header.year if header else None) or front.year,
        "abstract": ((header.abstract if header else None) or abstract or None),
        "reference_count": len(refs),
    }
    if values["abstract"]:
        values["abstract"] = values["abstract"][:20000]
    source = PaperMetaSource.GROBID if header else PaperMetaSource.PARSED
    meta_written = _store_meta(session, document, values, source)
    _fill_document(document, front, header)
    session.add(document)
    count = _store_references(session, document, refs, cited)
    session.commit()
    report = {
        "units": len(units),
        "roles": {anchor: role.value for anchor, role in roles.items()},
        "references": count,
        "cited_references": sum(1 for r in refs if cited.get(r.ordinal)),
        "citation_anchors": len({a for anchors in cited.values() for a in anchors}),
        "style": "numbered" if numbered else "author_year",
        "meta": "written" if meta_written else "kept (human)",
        "source": source.value,
    }
    logger.info("Paper structured", extra={"document_id": str(document.id), **report})
    return report
