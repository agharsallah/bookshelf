"""The math explainer body (skills/explain-math) as render blocks, for
`app.papers.render.paper_blocks`: exports, search indexing and hits read it through
`render_markdown.body_blocks`. It has `big_picture` and `formulas`.

    The big picture          problem paragraph + the math map diagram
    <name> (per formula)     the formula (math block, read aloud as its meaning), symbols,
                             intuition, diagram, worked example (steps, result, extra),
                             why here, added value, the confusion callout, try it, explore
    Learning path            steps with minutes
    Glossary                 definition blocks
    love note                the callout as written

Every cited span of the body survives; labels are uncited `strong` spans. Pure: bodies only.
"""

from typing import Any

from app.papers.render import Block, _bullets, _heading, _labelled, _object, _spans


def _block(value: Any) -> list[Block]:
    return [value] if isinstance(value, dict) and "type" in value else []


def _paragraph(label: str, spans: Any) -> list[Block]:
    found = _spans(spans)
    return [{"type": "paragraph", "spans": _labelled(label, found)}] if found else []


def _formula(formula: dict[str, Any]) -> list[Block]:
    out: list[Block] = [_heading(str(formula.get("name") or "Formula"))]
    if formula.get("latex"):
        out.append({"type": "math", "latex": formula["latex"],
                    "meaning": _spans(formula.get("in_plain_words")),
                    "cites": [formula["anchor"]] if formula.get("anchor") else []})  # fmt: skip
    symbols = [
        _labelled(f"{s.get('symbol', '')}:", s.get("everyday"))
        for s in formula.get("symbols") or []
        if isinstance(s, dict)
    ]
    out += _bullets(symbols)
    out += _paragraph("Why it has this shape:", formula.get("intuition"))
    out += _block(formula.get("diagram"))
    example = _object(formula.get("worked_example"))
    if example:
        out += _paragraph("Worked example:", example.get("setup"))
        out += _block(example.get("steps"))
        out += _paragraph("So:", example.get("result"))
        out += _block(example.get("extra"))
    out += _paragraph("Why the paper needs it:", formula.get("why_here"))
    out += _paragraph("What it buys:", formula.get("added_value"))
    out += _block(formula.get("common_confusion"))
    try_it = _object(formula.get("try_it"))
    out += _paragraph("Try it:", try_it.get("question"))
    out += _paragraph("Answer:", try_it.get("answer"))
    explore = _object(formula.get("explore_further"))
    learn = [
        str(p.get("concept")) for p in explore.get("prerequisites") or [] if isinstance(p, dict)
    ]
    search = [str(t) for t in explore.get("search_terms") or []]
    words = "; ".join(filter(None, [", ".join(learn), ", ".join(search)]))
    if words:  # names, not claims: one uncited line
        out.append({"type": "paragraph", "spans": [{"text": f"Explore further: {words}.",
                                                    "cites": [], "mark": "em"}]})  # fmt: skip
    out += _paragraph("Next question:", explore.get("next_question"))
    return out


def math_blocks(body: dict[str, Any]) -> list[Block]:
    """Blocks for a `math_explainer` body, in reading order."""
    picture = _object(body.get("big_picture"))
    out: list[Block] = []
    if problem := _spans(picture.get("problem")):
        out += [_heading("The big picture"), {"type": "paragraph", "spans": problem}]
    out += _block(picture.get("map"))
    for formula in body.get("formulas") or []:
        if isinstance(formula, dict):
            out += _formula(formula)
    path = [
        _labelled(f"{p.get('title', '')} ({p.get('minutes')} min):", p.get("goal"))
        for p in body.get("path") or []
        if isinstance(p, dict)
    ]
    if path := [item for item in path if len(item) > 1]:
        out += [_heading("Learning path"), {"type": "steps", "items": path}]
    glossary = [g for g in body.get("glossary") or [] if isinstance(g, dict) and "type" in g]
    if glossary:
        out += [_heading("Glossary"), *glossary]
    out += _block(body.get("love_note"))
    return out
