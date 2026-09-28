"""The parse-time outline strategy for papers (`parse.pdf.headings.OutlineStrategy`).

    PDF blocks → papers.headings (numbered / named / appendix headings, title)
               → papers.detect (AUTO mode only: is it a paper at all?)
               → papers.refblocks (one paragraph per bibliography entry)

**Auto-confirmation.** A tier-2 PDF (no embedded outline, the usual arXiv case) normally
waits in `needs_review` until a person confirms the detected outline, because book
headings are guessed from font sizes. A paper's outline is self-checking instead: its
top-level sections are numbered 1, 2, 3 … and it has an Abstract and a References heading.
When all of that holds (at least three numbered sections, no gap in the numbering, both
named headings found) a person would only be confirming what the numbering already proves,
so the outline is accepted (`needs_review = False`) with a parse warning saying why.
Anything less keeps `needs_review`, as for books.
"""

from collections.abc import Sequence

from app.models.enums import Genre
from app.papers.detect import MAX_PAGES, PaperMode, Signals, guess_genre
from app.papers.headings import PaperHeadings, detect_paper_headings
from app.papers.refblocks import regroup_references
from app.pipeline.parse.model import Heading
from app.pipeline.parse.pdf.headings import (
    DetectedOutline,
    Item,
    OutlineStrategy,
    place_outline,
    toc_entries,
)
from app.pipeline.parse.pdf.layout import Block

MIN_NUMBERED = 3
_SHORT_LINE = 80


def block_signals(items: Sequence[Item], found: PaperHeadings, page_count: int) -> Signals:
    """Detection signals from the stream: detected headings, short lines, page one."""
    headings = [h.title for h in found.placed if isinstance(h, Heading)]
    headings += [b.text for b in items if isinstance(b, Block) and len(b.text) <= _SHORT_LINE]
    first = "\n".join(b.text for b in items if isinstance(b, Block) and b.page == 1)
    return Signals(page_count, tuple(headings), first)


def confidence(found: PaperHeadings) -> tuple[bool, str]:
    """Whether the outline proves itself (module docstring), and the reason."""
    numbers = found.top_numbers
    problems = [
        msg
        for ok, msg in (
            (len(numbers) >= MIN_NUMBERED, f"fewer than {MIN_NUMBERED} numbered sections"),
            (bool(numbers) and numbers[0] == 1 and found.gaps == 0, "gaps in the numbering"),
            (found.has_abstract, "no Abstract heading"),
            (found.has_references, "no References heading"),
        )
        if not ok
    ]
    if problems:
        return False, "paper outline needs review: " + "; ".join(problems)
    return True, (
        f"paper outline confirmed automatically: sections 1-{numbers[-1]} numbered in "
        "sequence, Abstract and References found"
    )


def paper_strategy(mode: PaperMode) -> OutlineStrategy | None:
    """The strategy for `parse_file`, or None when a person said it is not a paper."""
    if mode is PaperMode.NEVER:
        return None

    def strategy(
        items: list[Item],
        *,
        body: float,
        toc: Sequence[tuple[int, str, int]],
        page_count: int,
    ) -> DetectedOutline | None:
        if mode is PaperMode.AUTO and page_count > MAX_PAGES:  # never a paper: skip the scan
            return None
        found = detect_paper_headings(items, body)
        if (
            mode is PaperMode.AUTO
            and not guess_genre(block_signals(items, found, page_count)).is_paper
        ):
            return None
        confident, note = confidence(found)
        if not confident and toc:  # an embedded outline beats unproven detection
            placed = regroup_references(place_outline(items, toc_entries(toc)))
            return DetectedOutline(placed, found.title, needs_review=False, genre=Genre.PAPER)
        return DetectedOutline(
            regroup_references(found.placed),
            found.title,
            needs_review=not confident,
            genre=Genre.PAPER,
            note=note,
        )

    return strategy
