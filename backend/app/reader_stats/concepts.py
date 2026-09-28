"""The ideas you spent time with: concepts mentioned by the passages you read and annotated.

A mention can sit on a chapter, a section or a block; time and notes anywhere under it count
for the concept (each minute row and note at most once per concept).
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field

from app.reader_stats.books import under
from app.reader_stats.facts import Facts, MentionFact
from app.schemas.reader_stats import ConceptRow

NOTE_WEIGHT = 300  # a note counts as five minutes with the idea, for ranking


@dataclass(slots=True)
class _Tally:
    name: str
    kind: str
    seconds: int = 0
    notes: int = 0
    books: set[uuid.UUID] = field(default_factory=set)


def _mentions(facts: Facts) -> dict[uuid.UUID, list[MentionFact]]:
    out: dict[uuid.UUID, list[MentionFact]] = defaultdict(list)
    for m in facts.mentions:
        out[m.document_id].append(m)
    return out


def concept_rows(facts: Facts, limit: int = 25) -> list[ConceptRow]:
    by_doc = _mentions(facts)
    tallies: dict[uuid.UUID, _Tally] = {}

    def hit(document_id: uuid.UUID, anchor: str) -> set[uuid.UUID]:
        found = {m.concept_id for m in by_doc.get(document_id, ()) if under(anchor, m.anchor)}
        for m in by_doc.get(document_id, ()):
            if m.concept_id in found and m.concept_id not in tallies:
                tallies[m.concept_id] = _Tally(m.name, m.kind)
        return found

    for minute in facts.minutes:
        if minute.document_id is None or not (minute.anchor or minute.unit):
            continue
        for concept in hit(minute.document_id, minute.anchor or minute.unit):
            tallies[concept].seconds += minute.seconds
            tallies[concept].books.add(minute.document_id)
    for note in facts.notes:
        for concept in hit(note.document_id, note.anchor):
            tallies[concept].notes += 1
            tallies[concept].books.add(note.document_id)
    ranked = sorted(
        tallies.items(), key=lambda kv: (-kv[1].notes * NOTE_WEIGHT - kv[1].seconds, kv[1].name)
    )
    return [
        ConceptRow(
            id=str(cid),
            name=t.name,
            kind=t.kind,
            seconds=t.seconds,
            notes=t.notes,
            books=len(t.books),
        )
        for cid, t in ranked[:limit]
    ]
