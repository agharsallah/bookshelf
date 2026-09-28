"""Input of `synthesize-papers` (docs/PAPERS.md §4, §5): a paper set's cards, claims and
results, with every cite qualified `<slug>:<anchor>`.

    paper_set.document_ids (set order)
      → each paper: its preferred `paper_card`, its materialized `claims`, its preferred
        `results_table` rows, the abstract as uncited orientation
      → every `cites` rewritten `<slug>:<anchor>` (the answer's cross-document cite form,
        `app.retrieval.evidence`), so one prompt can cite several papers unambiguously
      → `comparison`: every paper's results pivoted to rows (method, paper) by columns
        (dataset, metric) by `results_matrix`, on `papers.compare`

`valid` maps each citable key to its document and anchor: the anchors the input already
cites (they passed the anchor gate when their artifacts were stored) that still exist in the
tree. A utility skill's input, so not a registered `Context` selector (`selector:
paper_set` in `meta.yaml` is a label).

`results_matrix` runs `app.papers.compare` with the shelf's concept names, so a set and
`/papers/compare` line results up the same way (through concept aliases).
"""

import copy
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.graph.evidence import clip
from app.models import Claim, Document, Node, PaperMeta, PaperSet
from app.models.enums import ArtifactType
from app.papers.compare import Canon, PaperResults, compare
from app.papers.compare_names import concept_canon
from app.pipeline import artifacts
from app.pipeline.bodies import iter_objects
from app.retrieval.evidence import qualify
from app.schemas.search import DocumentRef

ABSTRACT_CHARS = 1500
CARD_KEYS = ("tldr", "question", "contributions", "method", "setup", "results",
             "limitations", "assumptions", "future_work", "numbers")  # fmt: skip
RESULT_KEYS = ("method", "setting", "dataset", "metric", "value", "unit", "higher_is_better",
               "is_proposed", "cites")  # fmt: skip


@dataclass(slots=True)
class SetInput:
    inputs: dict[str, Any]
    members: list[DocumentRef] = field(default_factory=list)
    valid: dict[str, tuple[DocumentRef, str]] = field(default_factory=dict)

    def citable(self) -> list[DocumentRef]:
        """Members with at least one passage the synthesis can cite."""
        slugs = {ref.slug for ref, _ in self.valid.values()}
        return [m for m in self.members if m.slug in slugs]


def qualified(value: Any, slug: str) -> Any:
    """A deep copy of `value` with every `cites` list qualified by `slug`."""
    out = copy.deepcopy(value)
    for obj in iter_objects(out):
        cites = obj.get("cites")
        if isinstance(cites, list):
            obj["cites"] = [qualify(slug, c) for c in cites if isinstance(c, str)]
    return out


def _anchors(value: Any) -> set[str]:
    return {
        c
        for obj in iter_objects(value)
        if isinstance(obj.get("cites"), list)
        for c in obj["cites"]
        if isinstance(c, str)
    }


def results_matrix(
    results: list[tuple[str, list[dict[str, Any]]]], canon: Canon | None = None
) -> dict[str, Any]:
    """Pivot `(slug, results_table rows)` pairs into method by (dataset, metric), through
    `papers.compare` (names joined by concept `canon`, else case- and space-insensitively).

    Columns sort by name; rows are (method, paper, setting), by method then paper order. A
    cell is `{value, unit, cite}` (its first cite, as given) or None; a cell reported twice
    keeps the first.
    """
    ids = {slug: uuid.uuid5(uuid.NAMESPACE_URL, slug) for slug, _ in results}
    slugs = {v: k for k, v in ids.items()}
    matrix = compare([PaperResults(ids[slug], table) for slug, table in results], canon)
    order = {c.key: i for i, c in enumerate(matrix.columns)}
    rows: list[dict[str, Any]] = []
    for row in matrix.rows:
        grouped: dict[tuple[uuid.UUID, str | None], dict[str, Any]] = {}
        for cell in row.cells:
            meta = grouped.setdefault(
                (cell.document_id, cell.setting),
                {"method": row.method, "setting": cell.setting,
                 "paper": slugs[cell.document_id], "is_proposed": False,
                 "cells": [None] * len(order)},
            )  # fmt: skip
            meta["is_proposed"] |= cell.is_proposed
            slot = order[cell.column]
            if meta["cells"][slot] is None:
                meta["cells"][slot] = {"value": cell.value, "unit": cell.unit,
                                       "cite": cell.cites[0] if cell.cites else None}  # fmt: skip
        rows.extend(sorted(grouped.values(), key=lambda m: list(ids).index(m["paper"])))
    return {
        "columns": [
            {"dataset": c.dataset, "metric": c.metric, "higher_is_better": c.higher_is_better}
            for c in matrix.columns
        ],
        "rows": rows,
    }


def _paper(session: Session, document: Document) -> tuple[dict[str, Any], set[str]]:
    """One member's input (cites qualified) and the bare anchors it cites."""
    slug = document.slug
    preferred = artifacts.preferred(
        session, document.id, [ArtifactType.PAPER_CARD, ArtifactType.RESULTS_TABLE]
    )
    card_row = preferred.get((ArtifactType.PAPER_CARD, None))
    card = {k: card_row.body[k] for k in CARD_KEYS if k in card_row.body} if card_row else None
    results_row = preferred.get((ArtifactType.RESULTS_TABLE, None))
    results = [
        {k: r.get(k) for k in RESULT_KEYS}
        for r in (results_row.body.get("rows", []) if results_row else [])
        if isinstance(r, dict)
    ]
    claims = [
        {"key": c.key, "text": c.text, "kind": c.kind.value, "strength": c.strength.value,
         "cites": list(c.evidence)}
        for c in session.exec(
            select(Claim).where(Claim.document_id == document.id).order_by(col(Claim.key))
        )
    ]  # fmt: skip
    meta = session.get(PaperMeta, document.id)
    bare = {"card": card, "claims": claims, "results": results}
    paper = {
        "slug": slug,
        "title": document.title,
        "authors": list(document.authors),
        "year": (meta.year if meta else None) or document.year,
        "venue": meta.venue if meta else None,
        "abstract": clip(meta.abstract, ABSTRACT_CHARS) if meta else None,
        **qualified(bare, slug),
    }
    return paper, _anchors(bare)


def set_input(session: Session, paper_set: PaperSet) -> SetInput:
    """The skill input for a set: members in set order (deleted documents dropped)."""
    ids = list(dict.fromkeys(paper_set.document_ids))
    found = {d.id: d for d in session.exec(select(Document).where(col(Document.id).in_(ids)))}
    documents = [found[i] for i in ids if i in found]
    out = SetInput(inputs={"set": {"name": paper_set.name}, "papers": []})
    wanted: dict[tuple[uuid.UUID, str], DocumentRef] = {}
    results: list[tuple[str, list[dict[str, Any]]]] = []
    for document in documents:
        ref = DocumentRef(
            id=document.id, slug=document.slug, title=document.title, authors=document.authors
        )
        out.members.append(ref)
        paper, anchors = _paper(session, document)
        out.inputs["papers"].append(paper)
        results.append((document.slug, paper["results"]))
        wanted |= {(document.id, a): ref for a in anchors}
    canon = concept_canon(session, (r for _, table in results for r in table))
    out.inputs["comparison"] = results_matrix(results, canon)
    existing = (
        session.exec(
            select(Node.document_id, Node.anchor).where(
                tuple_(col(Node.document_id), col(Node.anchor)).in_(sorted(wanted))
            )
        ).all()
        if wanted
        else []
    )
    for doc_id, anchor in sorted(existing, key=lambda k: (str(k[0]), k[1])):
        ref = wanted[(doc_id, anchor)]
        out.valid[qualify(ref.slug, anchor)] = (ref, anchor)
    return out
