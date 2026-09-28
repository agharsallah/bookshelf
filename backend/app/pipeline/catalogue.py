"""Library cards: what `catalogue-document` says a document is (`catalogue_entry`).

The card is read where it is shown, never copied onto `documents`: the library takes each
document's preferred card (the latest approved version, else the latest one not rejected,
flagged `draft`), so a new card groups the shelf at once and review can still correct it.
The shelf's themes are the ones those cards name, most used first; the skill reuses them
(`existing_themes`) so books meet under one heading instead of near-synonyms.
"""

import uuid
from collections import Counter
from collections.abc import Sequence
from typing import Any

from sqlmodel import Session, col, select

from app.models import Artifact
from app.models.enums import ArtifactType, Review
from app.pipeline import artifacts

KIND = ArtifactType.CATALOGUE_ENTRY
FACT_KEYS = ("publisher", "published", "edition", "isbn", "language", "series")
MAX_THEME_CHARS = 48


def theme_key(name: str) -> str:
    """Themes match regardless of case and spacing ("Machine  learning" = "machine learning")."""
    return " ".join(name.split()).casefold()


def clean_theme(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    name = " ".join(value.split())[:MAX_THEME_CHARS]
    return name or None


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return " ".join(value.split()) or None


def card(body: dict[str, Any], *, draft: bool) -> dict[str, Any]:
    """A card body as the library shows it: every key present, unknowns None or []."""
    theme = body.get("theme")
    facts = body.get("facts")
    facts = facts if isinstance(facts, dict) else {}
    subjects = body.get("subjects")
    return {
        "theme": clean_theme(theme.get("name") if isinstance(theme, dict) else None),
        "subjects": [s for s in subjects if isinstance(s, str)]
        if isinstance(subjects, list)
        else [],
        "form": _text(body.get("form")),
        "audience": _text(body.get("audience")),
        "level": _text(body.get("level")),
        "description": _text(body.get("description")),
        **{key: facts.get(key) for key in FACT_KEYS},
        "draft": draft,
    }


def preferred_cards(
    session: Session, ids: Sequence[uuid.UUID] | None = None
) -> dict[uuid.UUID, Artifact]:
    """Per document, its preferred card; `ids` None means the whole shelf. One query."""
    query = select(Artifact).where(Artifact.type == KIND, Artifact.review != Review.REJECTED)
    if ids is not None:
        if not ids:
            return {}
        query = query.where(col(Artifact.document_id).in_(ids))
    rows = session.exec(query.order_by(col(Artifact.version))).all()
    return artifacts.pick_preferred(rows, lambda row: row.document_id)


def cards(session: Session, ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, dict[str, Any]]:
    """The library card of each document that has one, with the shelf's spelling of its theme."""
    found = preferred_cards(session, ids)
    spelling = {theme_key(t["name"]): t["name"] for t in shelf_themes(session)}
    out: dict[uuid.UUID, dict[str, Any]] = {}
    for doc_id, artifact in found.items():
        entry = card(artifact.body, draft=artifact.review is not Review.APPROVED)
        if entry["theme"] is not None:
            entry["theme"] = spelling.get(theme_key(entry["theme"]), entry["theme"])
        out[doc_id] = entry
    return out


def shelf_themes(session: Session, *, exclude: uuid.UUID | None = None) -> list[dict[str, Any]]:
    """`[{name, documents}]`: the themes the shelf's cards name, most used first, then by
    name. Near-duplicates by case or spacing count as one, spelled as most cards spell it."""
    counts: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = {}
    for doc_id, artifact in preferred_cards(session).items():
        theme = artifact.body.get("theme")
        name = clean_theme(theme.get("name") if isinstance(theme, dict) else None)
        if doc_id == exclude or name is None:
            continue
        key = theme_key(name)
        counts[key] += 1
        spellings.setdefault(key, Counter())[name] += 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return [{"name": spellings[key].most_common(1)[0][0], "documents": n} for key, n in ranked]
