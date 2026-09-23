"""Concept lookup by name: canonical or alias, case- and whitespace-insensitive.

"Never duplicate" is enforced here: every writer resolves a name through `lookup` before
inserting, so `WIP`, `wip` and an alias `wip` of `work in progress` are one concept. A
merged concept resolves to its survivor.
"""

from collections.abc import Iterable

from sqlalchemy import func, or_, text
from sqlmodel import Session, col, select

from app.graph.refs import survivor
from app.models import Concept


def normalize(name: str) -> str:
    """The comparison key: lowercase, single spaces, no surrounding punctuation."""
    return " ".join(name.lower().split()).strip(" .,:;")


def lookup(session: Session, names: Iterable[str]) -> dict[str, Concept]:
    """Normalized name → the concept it denotes. One query for the whole batch.

    A canonical match beats an alias match; a live concept beats a merged one.
    """
    keys = sorted({normalize(n) for n in names if normalize(n)})
    if not keys:
        return {}
    alias_hit = text(
        "exists (select 1 from unnest(concepts.aliases) as a"
        " where lower(btrim(a)) = any(cast(:keys as text[])))"
    ).bindparams(keys=keys)
    rows = session.exec(
        select(Concept).where(or_(func.lower(Concept.canonical).in_(keys), alias_hit))
    ).all()
    found: dict[str, tuple[int, Concept]] = {}
    for concept in rows:
        rank_live = 0 if concept.merged_into is None else 2
        names_of = [(normalize(concept.canonical), 0)] + [
            (normalize(a), 1) for a in concept.aliases
        ]
        for key, rank_kind in names_of:
            rank = rank_live + rank_kind
            if key in keys and (key not in found or rank < found[key][0]):
                found[key] = (rank, concept)
    return {key: survivor(session, concept) for key, (_, concept) in found.items()}


def find(session: Session, name: str) -> Concept | None:
    return lookup(session, [name]).get(normalize(name))


def merged_aliases(current: Iterable[str], extra: Iterable[str], canonical: str) -> list[str]:
    """`current` plus the new names in `extra`, never repeating one or the canonical."""
    seen = {normalize(canonical)}
    out: list[str] = []
    for alias in [*current, *extra]:
        key = normalize(alias)
        if key and key not in seen:
            seen.add(key)
            out.append(alias.strip())
    return out


def live_concepts(session: Session) -> list[Concept]:
    return list(session.exec(select(Concept).where(col(Concept.merged_into).is_(None))).all())
