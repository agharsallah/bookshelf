"""The manual outline fix-up stored in `documents.outline_override` (§8).

Shape (JSON list, pages 1-based as shown by a PDF viewer)::

    [
      {
        "title": "Feedback loops",      # required, chapter heading
        "page_from": 12,                 # required, first page of the chapter
        "page_to": 30,                   # optional, informational except on the last chapter
        "skip": false,                   # optional, true = not distilled (e.g. an index)
        "sections": [                    # optional
          {"title": "Balancing loops", "page_from": 14}
        ]
      }
    ]

When present it *replaces* the detected chapter/section boundaries: each heading is placed
at its title's line on `page_from` when that line is found, else at the top of the page.
Text before the first chapter goes to front matter; text after the last chapter's
`page_to` goes to a trailing `Back matter` container marked `skip`. Only PDFs have pages,
so HTML / Markdown ignore it. The shape and its rules live in `app.schemas.outline`, shared
with `PATCH /documents/{ref}/outline`; `load_override` re-validates what is stored.
"""

from app.schemas.outline import OUTLINE_OVERRIDE, OverrideChapter, OverrideSection

__all__ = ["OUTLINE_OVERRIDE", "OverrideChapter", "OverrideSection", "load_override"]


def load_override(raw: object) -> list[OverrideChapter] | None:
    """Validated chapters, or None when no override is stored. Raises `ValueError`."""
    if raw is None:
        return None
    return OUTLINE_OVERRIDE.validate_python(raw)
