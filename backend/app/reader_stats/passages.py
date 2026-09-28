"""Passages: the blocks you spent longest on, and the ones you annotated most.

Ranking is pure; the blocks' text is looked up only for the passages that made the list
(`Texts`, which the service backs with `collect.texts`).
"""

import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from app.models.enums import Surface
from app.reader_stats.books import under
from app.reader_stats.clock import Clock
from app.reader_stats.facts import BookFact, Facts
from app.schemas.reader_stats import PassageRow

Block = tuple[uuid.UUID, str]
Texts = Callable[[Sequence[Block]], dict[Block, str]]


@dataclass(slots=True)
class _Passage:
    unit: str = ""
    seconds: int = 0
    days: set[object] = field(default_factory=set)
    notes: int = 0


def _tally(facts: Facts, clock: Clock) -> dict[Block, _Passage]:
    out: dict[Block, _Passage] = defaultdict(_Passage)
    for m in facts.minutes:
        if m.surface is Surface.READ and m.document_id is not None and m.anchor:
            p = out[(m.document_id, m.anchor)]
            p.unit = p.unit or m.unit
            p.seconds += m.seconds
            p.days.add(clock.day(m.minute))
    for n in facts.notes:
        out[(n.document_id, n.anchor)].notes += 1
    return out


def _chapter(book: BookFact, anchor: str, unit: str) -> tuple[str, str]:
    for c in book.chapters:
        if c.anchor == unit or under(anchor, c.anchor):
            return c.anchor, c.title
    return unit, unit


def _rows(
    ranked: list[tuple[Block, _Passage]], books: Sequence[BookFact], texts: Texts
) -> list[PassageRow]:
    by_id = {b.id: b for b in books}
    ranked = [(k, p) for k, p in ranked if k[0] in by_id]
    found = texts([k for k, _ in ranked])
    rows = []
    for (doc_id, anchor), p in ranked:
        book = by_id[doc_id]
        unit, chapter = _chapter(book, anchor, p.unit)
        rows.append(
            PassageRow(
                document=book.slug,
                book_title=book.title,
                unit=unit,
                chapter=chapter,
                anchor=anchor,
                text=found.get((doc_id, anchor), ""),
                seconds=p.seconds,
                visits=len(p.days),
                notes=p.notes,
            )
        )
    return rows


def visited(facts: Facts, clock: Clock, texts: Texts, limit: int = 8) -> list[PassageRow]:
    """The passages with the most reading time; days on it break ties."""
    tally = [(k, p) for k, p in _tally(facts, clock).items() if p.seconds > 0]
    tally.sort(key=lambda kp: (-kp[1].seconds, -len(kp[1].days), kp[0][1]))
    return _rows(tally[:limit], facts.books, texts)


def annotated(facts: Facts, clock: Clock, texts: Texts, limit: int = 8) -> list[PassageRow]:
    """The passages with the most notes and highlights; reading time breaks ties."""
    tally = [(k, p) for k, p in _tally(facts, clock).items() if p.notes > 0]
    tally.sort(key=lambda kp: (-kp[1].notes, -kp[1].seconds, kp[0][1]))
    return _rows(tally[:limit], facts.books, texts)
