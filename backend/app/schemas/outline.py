"""The outline override shape (§8 manual fix-up): one definition for the API and the parser.

`PATCH /documents/{ref}/outline` validates a request with `OutlineUpdate` (in
`app.schemas.document`, which also allows `[]` to clear the override) and the parser
re-validates what is stored with `OUTLINE_OVERRIDE`; both use the models and rules here.
See `app.pipeline.parse.override` for what the parser does with it.

Rules: titles 1-500 chars; pages 1-based; `page_to >= page_from` when given; sections
inside their chapter's pages and in page order; chapters in page order, and no chapter
starting before the previous one's `page_to` (sharing a boundary page is fine).
"""

from itertools import pairwise
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


def check_chapters(chapters: list[OverrideChapter]) -> list[OverrideChapter]:
    """Chapters in page order, none starting before the previous chapter's `page_to`."""
    if [c.page_from for c in chapters] != sorted(c.page_from for c in chapters):
        raise ValueError("chapters must be in page order")
    for before, after in pairwise(chapters):
        if before.page_to is not None and after.page_from < before.page_to:
            raise ValueError(f"{after.title!r} starts before {before.title!r} ends")
    return chapters


OUTLINE_OVERRIDE: TypeAdapter[list[OverrideChapter]] = TypeAdapter(
    Annotated[list[OverrideChapter], Field(min_length=1), AfterValidator(check_chapters)]
)
