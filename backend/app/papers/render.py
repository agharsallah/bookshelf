"""The paper card and explainer bodies as render blocks, in reading order.

`services.render_markdown.body_blocks` flattens every artifact body into blocks for exports,
search indexing (`retrieval.points.flatten_body`), search hits and evidence. The paper bodies
(skills/dissect-paper, skills/simplify-paper) keep their fields as cited spans and block
lists; this turns them into headed blocks. `numbers` is left to `body_blocks`, which already
renders the key (the book guide's shape). Pure: bodies only, no database.
"""

from typing import Any

Block = dict[str, Any]

# Card keys in schema order → heading. Spans lists become bullets, block lists pass through.
_CARD_SPANS = (("tldr", "TL;DR"), ("question", "Question"))
_CARD_LISTS = (("assumptions", "Assumptions"), ("future_work", "Future work"))
_SETUP = (("datasets", "Datasets"), ("baselines", "Baselines"), ("metrics", "Metrics"))


def paper_blocks(body: dict[str, Any]) -> list[Block]:
    """Blocks for a `paper_card` (it has `tldr`), a `paper_explainer` (it has
    `walkthrough`) or a study body (`render_study`); nothing for any other body."""
    if "tldr" in body:
        return _card(body)
    if "walkthrough" in body:
        return _explainer(body)
    # Assessment, review, notation, journal club: their renderers build on the helpers
    # here, so the module is imported on use.
    from app.papers.render_study import study_blocks

    return study_blocks(body)


def _heading(text: str) -> Block:
    return {"type": "heading", "level": 3, "text": text}


def _spans(value: Any) -> list[Block]:
    return [s for s in value if isinstance(s, dict)] if isinstance(value, list) else []


def _blocks(value: Any) -> list[Block]:
    return (
        [b for b in value if isinstance(b, dict) and "type" in b] if isinstance(value, list) else []
    )


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _bullets(items: list[list[Block]]) -> list[Block]:
    items = [item for item in items if item]
    return [{"type": "bullets", "items": items}] if items else []


def _labelled(label: str, spans: Any) -> list[Block]:
    return [{"text": label, "cites": [], "mark": "strong"}, *_spans(spans)]


def _card(body: dict[str, Any]) -> list[Block]:
    out: list[Block] = []
    for key, title in _CARD_SPANS:
        if spans := _spans(body.get(key)):
            out += [_heading(title), {"type": "paragraph", "spans": spans}]
    contributions = [c for c in body.get("contributions") or [] if isinstance(c, dict)]
    if contributions:
        items = [_labelled(f"{c.get('kind', '')}:", c.get("spans")) for c in contributions]
        out += [_heading("Contributions"), *_bullets(items)]
    if method := _blocks(body.get("method")):
        out += [_heading("Method"), *method]
    setup = _object(body.get("setup"))
    setup_items = [
        _labelled(f"{title}: {item.get('name', '')}.", item.get("spans"))
        for key, title in _SETUP
        for item in setup.get(key) or []
        if isinstance(item, dict)
    ]
    if setup_items:
        out += [_heading("Setup"), *_bullets(setup_items)]
    if results := _blocks(body.get("results")):
        out += [_heading("Results"), *results]
    limits = _object(body.get("limitations"))
    limit_items = [
        _labelled(label, spans)
        for key, label in (("stated", "Stated:"), ("unstated", "Unstated:"))
        for spans in limits.get(key) or []
    ]
    if limit_items:
        out += [_heading("Limitations"), *_bullets(limit_items)]
    for key, title in _CARD_LISTS:
        if items := [_spans(s) for s in body.get(key) or []]:
            out += [_heading(title), *_bullets(items)]
    return out


def _explainer(body: dict[str, Any]) -> list[Block]:
    out: list[Block] = []
    prerequisites = [p for p in body.get("prerequisites") or [] if isinstance(p, dict)]
    if prerequisites:
        items = [_labelled(f"{p.get('concept', '')}:", p.get("why")) for p in prerequisites]
        out += [_heading("Before you start"), *_bullets(items)]
    for key, title in (("intuition", "The idea"), ("walkthrough", "Walkthrough")):
        if blocks := _blocks(body.get(key)):
            out += [_heading(title), *blocks]
    if analogy := _spans(body.get("analogy")):
        out += [_heading("An analogy"), {"type": "paragraph", "spans": analogy}]
    equations = [e for e in body.get("equations") or [] if isinstance(e, dict) and e.get("latex")]
    if equations:
        out.append(_heading("The equations in words"))
        out += [
            {"type": "math", "latex": e["latex"], "meaning": _spans(e.get("plain")),
             "cites": list(e.get("cites") or [])}
            for e in equations
        ]  # fmt: skip
    return out
