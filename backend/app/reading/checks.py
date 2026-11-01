"""compose-reading's hard gates: part order, and see-also links that hold the edition together.

The schema fixes the shape. These rules need the chapters the selector offered:

- parts run `through-line`, one per offered chapter in order, then `connections`;
- every `see` names another part (never itself, never a source anchor);
- the through-line sends the reader into at least one chapter;
- the connections name the chapters an idea returns in: two or more, when there are.
"""

from typing import Any

from app.pipeline.selectors import Selection
from app.reading.model import CONNECTIONS, THROUGH_LINE


def check_reading_edition(output: dict[str, Any], selection: Selection) -> list[str]:
    offered = selection.inputs.get("chapters", [])
    chapters = [c["anchor"] for c in offered if isinstance(c, dict) and c.get("anchor")]
    parts = output["parts"]
    ids = [part["id"] for part in parts]
    problems: list[str] = []
    if len(ids) != len(set(ids)):
        problems.append("parts: ids must be unique")
    if not ids or ids[0] != THROUGH_LINE:
        problems.append(f"parts: the first id must be {THROUGH_LINE}")
    if not ids or ids[-1] != CONNECTIONS:
        problems.append(f"parts: the last id must be {CONNECTIONS}")
    if ids[1:-1] != chapters:
        listed = ", ".join(chapters) or "none"
        problems.append(
            f"parts: between {THROUGH_LINE} and {CONNECTIONS}, one part per chapter in order "
            f"({listed})"
        )
    known = set(ids)
    for part in parts:
        see = part.get("see") or []
        bad = next((t for t in see if t not in known or t == part["id"]), None)
        if bad is not None:
            problems.append(f"{part['id']}: see names {bad}, which is not another part")
        linked = [t for t in see if t in chapters]
        if part["id"] == THROUGH_LINE and chapters and not linked:
            problems.append(f"{THROUGH_LINE}: see must name a chapter part to open next")
        needed = min(2, len(chapters))
        if part["id"] == CONNECTIONS and len(linked) < needed:
            problems.append(
                f"{CONNECTIONS}: see must name the chapter parts the ideas return in "
                f"(at least {needed})"
            )
    return problems
