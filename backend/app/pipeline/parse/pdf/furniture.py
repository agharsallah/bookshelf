"""Strip page furniture: running headers, footers and page numbers (§8).

A line in the top or bottom margin band is furniture when its digit-insensitive text
repeats across pages (`Chapter 3 · 41` and `Chapter 3 · 42` share one key), or when it
is a bare page number. Runs before hashing, so furniture never reaches a content hash.
"""

import re
from collections import Counter

from app.pipeline.parse.pdf.layout import Block

MARGIN = 0.08  # fraction of the page height at the top and at the bottom
_PAGE_NUMBER = re.compile(
    r"^(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|/)\s*\d{1,4})?$", re.IGNORECASE
)
_DIGITS = re.compile(r"\d+")
_WS = re.compile(r"\s+")


def _key(text: str) -> str:
    return _WS.sub(" ", _DIGITS.sub("#", text.casefold())).strip()


def _band(block: Block, height: float) -> str | None:
    _, y0, _, y1 = block.bbox
    if y1 <= height * MARGIN:
        return "top"
    if y0 >= height * (1 - MARGIN):
        return "bottom"
    return None


def strip_furniture(pages: list[list[Block]], heights: list[float]) -> list[list[Block]]:
    """Drop furniture blocks from every page; `pages[i]` is page i's blocks."""
    counts: Counter[tuple[str, str]] = Counter()
    for blocks, height in zip(pages, heights, strict=True):
        keys = {(band, _key(b.text)) for b in blocks if (band := _band(b, height))}
        counts.update(keys)
    threshold = 2 if len(pages) <= 5 else 3

    def is_furniture(block: Block, height: float) -> bool:
        band = _band(block, height)
        if band is None:
            return False
        if _PAGE_NUMBER.match(block.text.strip()):
            return True
        return counts[(band, _key(block.text))] >= threshold

    return [
        [b for b in blocks if not is_furniture(b, height)]
        for blocks, height in zip(pages, heights, strict=True)
    ]
