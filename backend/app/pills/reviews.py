"""Pills into the review queue (docs/PILLS.md §6, L7): one FSRS system for everything.

Saving a pill (or missing a quiz or flip) queues a `review_item` with source `pill` and the
pill's `source_key` (stable across rebuilds), due now, through `services.reviews.add_item`
(which never reschedules an item that exists). Unsaving takes back an item you have not
reviewed yet. Review pills themselves are rated through `POST /reviews/{id}/rating`.

The card: the prompt is the pill's front, question, defined term, headline or first span;
the answer is its spans (a quiz's right choice first; a quote's or claim's text; a
connection's side in the pill's own document), keeping only cites of that document.
"""

from typing import Any

from sqlalchemy import delete
from sqlmodel import Session, col

from app.models import ReviewItem
from app.models.enums import PillKind, ReviewSource
from app.models.pill import Pill
from app.retrieval.evidence import split_cite
from app.services.reviews import ItemDraft, add_item

Span = dict[str, Any]

# The body key holding a kind's spans (the answer of its review card).
SPANS_KEY: dict[PillKind, str] = {
    PillKind.INSIGHT: "spans",
    PillKind.REMEMBER: "spans",
    PillKind.ANTIPATTERN: "spans",
    PillKind.DEFINITION: "spans",
    PillKind.NUMBER: "label",
    PillKind.FIGURE: "takeaway",
    PillKind.QUIZ: "explanation",
    PillKind.FLIP: "back",
    PillKind.MATH: "plain",
    PillKind.LISTEN: "transcript",
    PillKind.HOOK: "payoff",
    PillKind.REVIEW: "answer",
}


def _own(cites: Any) -> list[str]:
    """Cites of the pill's own document (bare anchors)."""
    return [c for c in cites or [] if isinstance(c, str) and split_cite(c)[0] is None]


def _spans(spans: Any) -> list[Span]:
    out = []
    for span in spans or []:
        if isinstance(span, dict) and isinstance(text := span.get("text"), str) and text:
            out.append({"text": text, "cites": _own(span.get("cites"))})
    return out


def answer_of(pill: Pill) -> list[Span]:
    body = pill.body
    if pill.kind is PillKind.CONNECTION:
        sides = body.get("sides", [])
        own = [s for s in sides if (s.get("document") or {}).get("id") == str(pill.document_id)]
        return _spans((own or sides[:1] or [{}])[0].get("spans"))
    if pill.kind in (PillKind.QUOTE, PillKind.CLAIM):
        return _spans([{"text": body.get("text"), "cites": pill.cites}])
    if pill.kind is PillKind.DIAGRAM:
        text = body.get("caption") or pill.headline or "The diagram"
        return _spans([{"text": text, "cites": (body.get("diagram") or {}).get("cites")}])
    spans = _spans(body.get(SPANS_KEY.get(pill.kind, "spans")))
    if pill.kind is PillKind.QUIZ:
        choices, right = body.get("choices", []), body.get("answer")
        if isinstance(right, int) and 0 <= right < len(choices):
            cites = spans[0]["cites"] if spans else _own(pill.cites)
            spans = [{"text": str(choices[right]), "cites": cites}, *spans]
    return spans


def prompt_of(pill: Pill, answer: list[Span]) -> str:
    body = pill.body
    for value in (body.get("front"), body.get("question")):
        if isinstance(value, str) and value.strip():
            return value
    if pill.kind is PillKind.DEFINITION and body.get("term"):
        return f"What is {body['term']}?"
    if pill.headline:
        return pill.headline
    return str(answer[0]["text"]) if answer else pill.kind.value


def draft_for(pill: Pill) -> ItemDraft | None:
    """The review card of a pill; None when it has no spans to check an answer against."""
    answer = answer_of(pill)
    if not answer:
        return None
    cited = [c for span in answer for c in span["cites"]] + _own(pill.cites)
    return ItemDraft(
        document_id=pill.document_id,
        anchor=cited[0] if cited else pill.anchor,
        source=ReviewSource.PILL,
        source_key=pill.source_key,
        prompt=prompt_of(pill, answer),
        answer=answer,
    )


def save(session: Session, pill: Pill) -> ReviewItem | None:
    """Queue the pill for review, due now (an existing item is kept). Does not commit."""
    draft = draft_for(pill)
    return add_item(session, draft) if draft is not None else None


def unsave(session: Session, pill: Pill) -> bool:
    """Take the pill's item out of the queue unless you have reviewed it. Does not commit."""
    result = session.execute(
        delete(ReviewItem).where(
            col(ReviewItem.source) == ReviewSource.PILL,
            col(ReviewItem.source_key) == pill.source_key,
            col(ReviewItem.last_rating).is_(None),
        )
    )
    return bool(getattr(result, "rowcount", 0))
