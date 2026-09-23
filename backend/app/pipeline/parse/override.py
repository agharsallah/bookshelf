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
so HTML / Markdown ignore it. Validate with `OUTLINE_OVERRIDE.validate_python(raw)`.
"""

from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    model_validator,
)

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Page = Annotated[int, Field(ge=1)]


class OverrideSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    page_from: Page


class OverrideChapter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title
    page_from: Page
    page_to: Page | None = None
    skip: bool = False
    sections: list[OverrideSection] = Field(default_factory=list)

    @model_validator(mode="after")
    def _sections_inside_chapter(self) -> "OverrideChapter":
        if self.page_to is not None and self.page_to < self.page_from:
            raise ValueError("page_to must be >= page_from")
        for section in self.sections:
            if section.page_from < self.page_from or (
                self.page_to is not None and section.page_from > self.page_to
            ):
                raise ValueError(f"section {section.title!r} lies outside its chapter's pages")
        if [s.page_from for s in self.sections] != sorted(s.page_from for s in self.sections):
            raise ValueError("sections must be in page order")
        return self


def _chapters_in_order(chapters: list[OverrideChapter]) -> list[OverrideChapter]:
    if [c.page_from for c in chapters] != sorted(c.page_from for c in chapters):
        raise ValueError("chapters must be in page order")
    return chapters


OUTLINE_OVERRIDE: TypeAdapter[list[OverrideChapter]] = TypeAdapter(
    Annotated[list[OverrideChapter], Field(min_length=1), AfterValidator(_chapters_in_order)]
)


def load_override(raw: object) -> list[OverrideChapter] | None:
    """Validated chapters, or None when no override is stored. Raises `ValueError`."""
    if raw is None:
        return None
    return OUTLINE_OVERRIDE.validate_python(raw)
