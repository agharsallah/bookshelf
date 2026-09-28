"""The study and critique bodies as render blocks, for `app.papers.render.paper_blocks`.

    paper_assessment   (skills/assess-paper)       has `scores` and `reproducibility`
    paper_review       (skills/review-paper)       has `verdict` and `strengths`
    notation_table     (skills/make-notation)      has `symbols`
    journal_club       (skills/make-journal-club)  has `pitch`

Exports, search indexing and hits read these through `render_markdown.body_blocks`. Every
cited span of a body survives (labels are uncited `strong` spans). Pure: bodies only.
"""

from typing import Any

from app.papers.render import Block, _bullets, _heading, _labelled, _object, _spans

_RECOMMENDATIONS = {
    "accept": "Accept",
    "weak_accept": "Weak accept",
    "borderline": "Borderline",
    "weak_reject": "Weak reject",
    "reject": "Reject",
}


def study_blocks(body: dict[str, Any]) -> list[Block]:
    """Blocks for one of the four bodies above; nothing for any other body."""
    if "scores" in body and "reproducibility" in body:
        return _assessment(body)
    if "verdict" in body and "strengths" in body:
        return _review(body)
    if "symbols" in body:
        return _notation(body)
    if "pitch" in body:
        return _journal_club(body)
    return []


def _items(value: Any) -> list[dict[str, Any]]:
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _paragraph(title: str, spans: Any) -> list[Block]:
    found = _spans(spans)
    return [_heading(title), {"type": "paragraph", "spans": found}] if found else []


def _span_list(title: str, value: Any, label: str | None = None) -> list[Block]:
    items = [
        _labelled(label, s) if label else _spans(s)
        for s in (value if isinstance(value, list) else [])
    ]
    bullets = _bullets(items)
    return [_heading(title), *bullets] if bullets else []


def _words(value: str) -> str:
    return value.replace("_", " ").capitalize()


def _assessment(body: dict[str, Any]) -> list[Block]:
    out = _paragraph("Assessment", body.get("overall"))
    scores = [
        _labelled(f"{_words(str(s.get('criterion', '')))}: {s.get('score')}/5.", s.get("spans"))
        for s in _items(body.get("scores"))
    ]
    if bullets := _bullets(scores):
        out += [_heading("Scores"), *bullets]
    checklist = [
        _labelled(f"{_words(str(r.get('item', '')))}: {r.get('status')}.", r.get("spans"))
        for r in _items(body.get("reproducibility"))
    ]
    if bullets := _bullets(checklist):
        out += [_heading("Reproducibility"), *bullets]
    related = [
        _labelled(f"{r.get('slug')}:", r.get("why")) for r in _items(body.get("related_shelf"))
    ]
    if bullets := _bullets(related):
        out += [_heading("Related on your shelf"), *bullets]
    return out


def _review(body: dict[str, Any]) -> list[Block]:
    out = _paragraph("Summary", body.get("summary"))
    out += _span_list("Strengths", body.get("strengths"))
    weaknesses = [
        _labelled(f"{_words(str(w.get('severity', '')))}:", w.get("spans"))
        for w in _items(body.get("weaknesses"))
    ]
    if bullets := _bullets(weaknesses):
        out += [_heading("Weaknesses"), *bullets]
    out += _span_list("Questions for the authors", body.get("questions"))
    out += _span_list("Missing experiments", body.get("missing_experiments"))
    verdict = _object(body.get("verdict"))
    if verdict:
        name = _RECOMMENDATIONS.get(str(verdict.get("recommendation")), "Verdict")
        label = f"{name} (confidence {verdict.get('confidence')}/5)."
        out += [_heading("Verdict"), {"type": "paragraph",
                                      "spans": _labelled(label, verdict.get("spans"))}]  # fmt: skip
    return out


def _notation(body: dict[str, Any]) -> list[Block]:
    rows = [
        [
            {"text": str(s["symbol_latex"]), "cites": list(s.get("cites") or []), "mark": "code"},
            {"text": str(s.get("meaning", "")), "cites": list(s.get("cites") or [])},
        ]
        for s in _items(body.get("symbols"))
        if s.get("symbol_latex") and s.get("meaning")
    ]
    if not rows:
        return []
    return [_heading("Notation"), {"type": "table", "header": ["Symbol", "Meaning"], "rows": rows}]


def _journal_club(body: dict[str, Any]) -> list[Block]:
    out = _paragraph("Pitch", body.get("pitch"))
    figure = _object(body.get("key_figure"))
    out += _paragraph("The figure to show", figure.get("why"))
    out += _paragraph("Weakest assumption", _object(body.get("weakest_assumption")).get("spans"))
    questions = [q for q in (_spans(q) for q in body.get("questions") or []) if q]
    if questions:
        out += [_heading("Discussion questions"), {"type": "steps", "items": questions}]
    debate = _object(body.get("debate"))
    sides = [
        _labelled(label, spans)
        for key, label in (("for", "For:"), ("against", "Against:"))
        for spans in debate.get(key) or []
    ]
    if bullets := _bullets(sides):
        out += [_heading("Debate"), *bullets]
    return out
