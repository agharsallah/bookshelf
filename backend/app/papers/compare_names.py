"""Concept names for the results comparison (`papers.compare`): the one database read.

Every method, dataset and metric name of the rows is looked up at once
(`graph.names.lookup`: canonical or alias, case-insensitively, merged → survivor). A name
takes the concept's canonical unless that concept is a *different* paper kind: a method
name that happens to be a `dataset` concept stays unmapped. `link-paper-concepts` keeps
each paper's spellings as aliases, which is what joins them.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from sqlmodel import Session

from app.graph import names
from app.models import Concept
from app.models.enums import ConceptKind
from app.papers.compare import FIELDS, Canon, Field

_KIND_OF: dict[Field, ConceptKind] = {
    "method": ConceptKind.METHOD,
    "dataset": ConceptKind.DATASET,
    "metric": ConceptKind.METRIC,
}


def _fits(concept: Concept, kind: Field) -> bool:
    return concept.kind is _KIND_OF[kind] or not concept.kind.is_paper_only


def concept_canon(session: Session, rows: Iterable[Mapping[str, Any]]) -> Canon:
    """Per field, normalized name → canonical, for every name in `rows` a concept names."""
    rows = list(rows)
    wanted = {kind: [str(r[kind]) for r in rows if isinstance(r.get(kind), str)] for kind in FIELDS}
    found = names.lookup(session, [n for group in wanted.values() for n in group])
    return {
        kind: {
            key: concept.canonical
            for n in group
            if (concept := found.get(key := names.normalize(n))) is not None
            and _fits(concept, kind)
        }
        for kind, group in wanted.items()
    }
