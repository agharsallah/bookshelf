"""Results comparison (docs/PAPERS.md §5): approved `results_table`s pivoted into one matrix.

    rows     methods                      one per method name, across every paper
    columns  (dataset, metric)            one per benchmark and measure
    cells    value · unit · setting       one per reported number (a method may have several
             · paper · cites · best       per column: two papers, or two settings)

**Names.** Ten papers spell one benchmark five ways ("WMT 2014 English-German", "WMT14
En-De"). A name that is a concept's canonical name or alias (`link-paper-concepts` puts the
variants a paper uses in `aliases`) takes that concept's canonical, and its key; any other
name is keyed by `graph.names.normalize` (case, spaces, surrounding punctuation), and
labelled with its first spelling. The caller supplies the concept map per field
(`papers.compare_names.concept_canon`), so this module stays pure: rows in, matrix out.
Cites pass through as given. Used by `GET /papers/compare` and the paper-set synthesis
input (`selectors.sets.results_matrix`), so both line results up the same way.

**Best.** A column's direction is the majority of its rows' `higher_is_better` (a tie:
higher), its unit the most common unit. Only cells in that unit are `comparable` (a 0-1
score is not beaten by a percentage); among them, every cell holding the best value is
`best`, once the column has at least two comparable cells.
"""

import math
import uuid
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from app.graph.names import normalize

Field = Literal["method", "dataset", "metric"]
FIELDS: tuple[Field, ...] = ("method", "dataset", "metric")
# Per field: normalized name → the concept canonical it denotes.
Canon = Mapping[Field, Mapping[str, str]]


@dataclass(frozen=True, slots=True)
class PaperResults:
    """One paper's approved results rows (`results_table.body.rows`)."""

    document_id: uuid.UUID
    rows: Sequence[Mapping[str, Any]]


@dataclass(slots=True)
class Cell:
    column: str
    document_id: uuid.UUID
    value: float
    unit: str | None
    setting: str | None
    is_proposed: bool
    cites: list[str]  # as the row gives them (the caller qualifies)
    higher_is_better: bool
    comparable: bool = True
    best: bool = False


@dataclass(slots=True)
class Column:
    key: str
    dataset: str
    metric: str
    unit: str | None = None
    higher_is_better: bool = True
    best: float | None = None
    cells: list[Cell] = field(default_factory=list)


@dataclass(slots=True)
class Row:
    key: str
    method: str
    cells: list[Cell] = field(default_factory=list)


@dataclass(slots=True)
class Comparison:
    columns: list[Column]
    rows: list[Row]


class _Names:
    """Keys and labels per field: a concept's canonical when the name is one of its names."""

    def __init__(self, canon: Canon) -> None:
        self.canon = canon
        self.labels: dict[tuple[Field, str], str] = {}

    def key(self, kind: Field, name: str) -> str:
        raw = normalize(name) or name.strip()
        canonical = self.canon.get(kind, {}).get(raw)
        key = normalize(canonical) if canonical else raw
        self.labels.setdefault((kind, key), canonical or " ".join(name.split()))
        return key

    def label(self, kind: Field, key: str) -> str:
        return self.labels[(kind, key)]


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) else None


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _rank(columns: list[Column]) -> None:
    for column in columns:
        cells = column.cells
        higher = sum(1 for c in cells if c.higher_is_better)
        column.higher_is_better = higher * 2 >= len(cells)
        units = Counter(c.unit for c in cells)
        column.unit = max(units, key=lambda u: (units[u], u is None, u or ""))
        comparable = [c for c in cells if c.unit == column.unit]
        for cell in cells:
            cell.comparable = cell.unit == column.unit
        if len(comparable) < 2:
            continue
        values = [c.value for c in comparable]
        column.best = max(values) if column.higher_is_better else min(values)
        for cell in comparable:
            cell.best = cell.value == column.best


def compare(papers: Sequence[PaperResults], canon: Canon | None = None) -> Comparison:
    """Pivot the papers' rows into methods x (dataset, metric). Rows that are not a
    finite number or name nothing are skipped. Ordering is by label, then paper order."""
    names = _Names(canon or {})
    columns: dict[str, Column] = {}
    rows: dict[str, Row] = {}
    for paper in papers:
        for item in paper.rows:
            value = _number(item.get("value"))
            labels = [_text(item.get(f)) for f in FIELDS]
            if value is None or not all(labels):
                continue
            method, dataset, metric = (
                names.key(f, str(t)) for f, t in zip(FIELDS, labels, strict=True)
            )
            column_key = f"{dataset}|{metric}"
            column = columns.setdefault(
                column_key,
                Column(column_key, names.label("dataset", dataset), names.label("metric", metric)),
            )
            row = rows.setdefault(method, Row(method, names.label("method", method)))
            cites = [c for c in item.get("cites", []) if isinstance(c, str)]
            cell = Cell(
                column=column_key,
                document_id=paper.document_id,
                value=value,
                unit=_text(item.get("unit")),
                setting=_text(item.get("setting")),
                is_proposed=bool(item.get("is_proposed")),
                cites=cites,
                higher_is_better=item.get("higher_is_better") is not False,
            )
            column.cells.append(cell)
            row.cells.append(cell)
    ordered = sorted(columns.values(), key=lambda c: (c.dataset.casefold(), c.metric.casefold()))
    _rank(ordered)
    position = {c.key: i for i, c in enumerate(ordered)}
    for row in rows.values():
        row.cells.sort(key=lambda c: position[c.column])  # stable: paper order within a column
    ranked = sorted(rows.values(), key=lambda r: (r.method.casefold(), r.key))
    return Comparison(columns=ordered, rows=ranked)
