"""`pill_set` (make-pills, docs/PILLS.md §5): composed pills, materialized like claims.

Output: `{threads: [{title, pills: [...]}], pills: [...]}`, each pill `{kind, headline,
body, cites}` with `kind` ∈ hook · insight · remember · antipattern · definition · quiz ·
flip and a body of that kind's contract. A thread (3-6 pills telling a chapter's arc) keeps
its order: `thread_key` names it stably (document, scope, variant, title), `thread_index`
places each pill. A pill whose body does not fit its kind is skipped, and the thread closes
up around it. The skill's own gates bound the words, so no prose bounds apply here; a
pill's `cites` also gains any anchor its spans cite that the list left out.
"""

import hashlib
from typing import Any

from pydantic import ValidationError

from app.models.enums import PillKind
from app.pills.contract import parse_body
from app.pills.harvest.base import (
    HarvestInput,
    PillDraft,
    clean_cites,
    draft,
    items,
    normalize,
)
from app.pipeline.bodies import cited_anchors, read_text

SKILL = "make-pills"
COMPOSED_KINDS = frozenset(
    {
        PillKind.HOOK,
        PillKind.INSIGHT,
        PillKind.REMEMBER,
        PillKind.ANTIPATTERN,
        PillKind.DEFINITION,
        PillKind.QUIZ,
        PillKind.FLIP,
    }
)


def origin_of(inp: HarvestInput) -> str:
    return f"skill:{SKILL}@{inp.artifact.skill_version or '1'}"


def thread_key(inp: HarvestInput, title: str) -> str:
    raw = "\x1f".join(
        (
            str(inp.context.document_id),
            inp.artifact.anchor or "",
            inp.artifact.variant or "",
            normalize(title),
        )
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _pill(inp: HarvestInput, item: dict[str, Any]) -> PillDraft | None:
    try:
        kind = PillKind(str(item.get("kind")))
        body = parse_body(kind, item.get("body") or {}) if kind in COMPOSED_KINDS else None
    except (ValueError, ValidationError):
        return None
    if body is None:
        return None
    headline, own = item.get("headline"), item.get("cites")
    return draft(
        inp,
        kind,
        body,
        content=read_text(body.model_dump()),
        # The pill's own list first, then anything its spans cite that the list left out.
        cites=clean_cites(
            [*(own if isinstance(own, list) else []), *sorted(cited_anchors(item.get("body")))]
        ),
        headline=headline if isinstance(headline, str) else None,
        origin=origin_of(inp),
    )


def harvest_pill_set(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for thread in items(inp.artifact.body.get("threads")):
        title = str(thread.get("title") or "").strip()
        made = [p for item in items(thread.get("pills")) if (p := _pill(inp, item))]
        key = thread_key(inp, title) if title and len(made) > 1 else None
        for index, pill in enumerate(made):
            if key is not None:
                pill.thread_key, pill.thread_index, pill.thread_title = key, index, title
            out.append(pill)
    out.extend(p for item in items(inp.artifact.body.get("pills")) if (p := _pill(inp, item)))
    return out
