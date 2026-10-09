"""Briefs of a whole document: the book guide and the paper card.

Both carry `numbers` (`{value, label: spans}`, at most eight): each is a number pill in the
unit its label cites. The guide's section blocks also hold diagrams (its `map` section
always opens with one), harvested like a distillation's.
"""

from app.models.enums import PillKind
from app.pills.contract import NumberBody
from app.pills.harvest.base import HarvestInput, PillDraft, build, draft, items, spans_cites
from app.pills.harvest.distillations import diagram_pill


def _numbers(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for number in items(inp.artifact.body.get("numbers")):
        label = items(number.get("label"))
        body = build(NumberBody, value=number.get("value"), label=label)
        cites = spans_cites(label)
        if body is None or not cites:
            continue
        content = f"{body.value}\x1f{''.join(s.text for s in body.label)}"
        if pill := draft(inp, PillKind.NUMBER, body, content=content, cites=cites):
            out.append(pill)
    return out


def harvest_guide(inp: HarvestInput) -> list[PillDraft]:
    pills = _numbers(inp)
    for section in items(inp.artifact.body.get("sections")):
        title = section.get("title")
        for block in items(section.get("blocks")):
            if block.get("type") != "diagram":
                continue
            pill = diagram_pill(inp, block, heading=title if isinstance(title, str) else None)
            if pill is not None:
                pills.append(pill)
    return pills


def harvest_paper_card(inp: HarvestInput) -> list[PillDraft]:
    return _numbers(inp)
