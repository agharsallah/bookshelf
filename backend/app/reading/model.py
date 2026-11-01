"""The shape a reading PDF is laid out from: a cover, grouped pieces, and their links.

Both editions (`app.reading.edition`) build a `Reading`; `app.reading.markup` turns it
into HTML and `app.reading.pdf` into pages. Nothing here touches the database.
"""

import re
from dataclasses import dataclass, field
from typing import Any

from app.services import render_markdown as md

Block = dict[str, Any]
# compose-reading's two fixed part ids around the chapter parts.
THROUGH_LINE = "through-line"
CONNECTIONS = "connections"


@dataclass(frozen=True, slots=True)
class Piece:
    """One navigable part: a contents entry, an outline entry, and a section of pages.

    `lead` is the composed edition's bridge (where this part sits in the argument),
    drawn apart from the approved notes in `blocks`. `see` holds (piece id, title)
    pairs, printed as "See also" links.
    """

    id: str
    group: str
    kicker: str
    title: str
    blocks: list[Block]
    deck: str = ""
    lead: list[Block] = field(default_factory=list)
    see: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class Reading:
    """A whole reading. `chapters` maps a chapter anchor to its piece id, so a citation
    such as `ch03/s02/p014` can link to the chapter it comes from."""

    title: str
    byline: str
    edition: str
    deck: str
    pieces: list[Piece] = field(default_factory=list)
    chapters: dict[str, str] = field(default_factory=dict)

    def cite_target(self, anchor: str) -> str | None:
        """The piece id of the chapter a source anchor sits in, or None."""
        parts = anchor.split("/")
        for size in range(len(parts), 0, -1):
            found = self.chapters.get("/".join(parts[:size]))
            if found:
                return found
        return None


def html_id(raw: str) -> str:
    """An HTML id: anchors may contain slashes, ids may not."""
    return re.sub(r"[^A-Za-z0-9_-]", "-", raw)


def knowledge_blocks(body: dict[str, Any]) -> list[Block]:
    """Render blocks for one artifact, including claim lists and result rows."""
    blocks = md.body_blocks(body)
    if blocks:
        return blocks
    claims = [c for c in body.get("claims") or [] if isinstance(c, dict) and c.get("text")]
    if claims:
        items = [[{"text": str(c["text"]), "cites": list(c.get("cites") or [])}] for c in claims]
        return [{"type": "bullets", "items": items}]
    rows = [r for r in body.get("rows") or [] if isinstance(r, dict) and r.get("method")]
    if rows:
        items = []
        for row in rows:
            items.append([{"text": _result_line(row), "cites": list(row.get("cites") or [])}])
        return [{"type": "bullets", "items": items}]
    return []


def _result_line(row: dict[str, Any]) -> str:
    """`method on dataset: value metric`, leaving out whatever the row lacks."""
    text = str(row["method"])
    if row.get("dataset"):
        text += f" on {row['dataset']}"
    measured = " ".join(str(row[k]) for k in ("value", "metric") if row.get(k) not in (None, ""))
    return f"{text}: {measured}" if measured else text


def plain(spans: Any) -> str:
    """The text of a span list, for a deck line."""
    if not isinstance(spans, list):
        return ""
    return " ".join(str(s.get("text", "")) for s in spans if isinstance(s, dict)).strip()
