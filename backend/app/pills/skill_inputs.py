"""`chapter_pills`: the input of make-pills (docs/PILLS.md §5, skills/README.md).

One chapter's preferred distillation (the only source the skill writes from), its salience
marks when it has them (core and key sentences: a hint of what matters), and a compact
list of the pills already harvested for it, so the skill writes what harvesting cannot and
never restates them (`app.pills.checks` refuses near-duplicates of `harvested[].text`).

Pills of make-pills itself are left out of `harvested`: a run's own output must not change
the next run's input. The book and chapter titles ride in the common envelope
(`document.title`, `scope.heading`).
"""

from typing import Any

from sqlmodel import col, select

from app.models.enums import ArtifactType
from app.models.pill import Pill
from app.pipeline import artifacts
from app.pipeline.bodies import count_words, plain_text, read_text
from app.pipeline.selectors import Context, Selection, SelectorError

SNIPPET_WORDS = 12  # a harvested pill is named by its headline or its first words
KEY_CHARS = 12  # a short prefix of `source_key`: enough to tell pills apart
MAX_HARVESTED = 60
SALIENT_TIERS = ("core", "key")
SKILL_ORIGIN_PREFIX = "skill:make-pills@"


def snippet(text: str, words: int = SNIPPET_WORDS) -> str:
    """The first `words` words of `text`, with an ellipsis when it goes on."""
    parts = text.split()
    return " ".join(parts[:words]) + (" …" if len(parts) > words else "")


def _salience(marks: Any) -> list[dict[str, Any]]:
    if not isinstance(marks, list):
        return []
    return [
        {"tier": m["tier"], "text": m.get("text", ""), "cites": m.get("cites", [])}
        for m in marks
        if isinstance(m, dict) and m.get("tier") in SALIENT_TIERS
    ]


def harvested(ctx: Context, anchor: str) -> list[dict[str, Any]]:
    """The chapter's live harvested pills: `{kind, text, key}`, in a stable order."""
    rows = ctx.session.exec(
        select(Pill).where(
            Pill.document_id == ctx.tree.document.id,
            Pill.anchor == anchor,
            col(Pill.retired_at).is_(None),
            col(Pill.origin).not_like(f"{SKILL_ORIGIN_PREFIX}%"),
        )
    ).all()
    items = [
        {
            "kind": row.kind.value,
            "text": row.headline or snippet(read_text(row.body)),
            "key": row.source_key[:KEY_CHARS],
        }
        for row in rows
    ]
    items.sort(key=lambda i: (i["kind"], i["text"], i["key"]))
    return items[:MAX_HARVESTED]


def chapter_pills(ctx: Context) -> Selection:
    chapter = ctx.require_node()
    distil, marks = ArtifactType.CHAPTER_DISTILLATION, ArtifactType.SALIENCE_MARKS
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [distil, marks])
    distillation = found.get((distil, chapter.anchor))
    if distillation is None:
        raise SelectorError(f"{chapter.anchor} has no chapter distillation yet")
    salience = found.get((marks, chapter.anchor))
    return ctx.selection(
        {
            "distillation": distillation.body,
            "salience": _salience(salience.body.get("marks")) if salience else None,
            "harvested": harvested(ctx, chapter.anchor),
        },
        source_words=count_words(plain_text(distillation.body)),
    )


SELECTORS = {"chapter_pills": chapter_pills}
