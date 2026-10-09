"""The pill wire format, mirroring `contracts/pill.schema.json` (docs/PILLS.md §2).

The JSON Schema is the truth; these models mirror it for the API (`response_model`) and for
the harvesters, which build each body through its model so a stored pill always renders.
`Pill.body` stays a plain dict on the wire (its shape depends on `kind`), validated against
`BODY_MODELS[kind]`; `parse_body` gives the typed view.
"""

import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import ClaimKind, ClaimStrength, Genre, PillKind

PILL_SCHEMA_ID = "https://bookshelf.local/contracts/pill.schema.json"
# A cite: a bare anchor (the pill's document) or `<slug>:<anchor>` (another document).
CITE_PATTERN = r"^([^:\s]+:)?[a-z]+[0-9]+(/[a-z]+[0-9]+)*$"
ANCHOR_PATTERN = r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$"
ACTIVE_KINDS = frozenset({PillKind.QUIZ, PillKind.FLIP, PillKind.REVIEW})

Anchor = Annotated[str, Field(pattern=ANCHOR_PATTERN, max_length=200)]
Cite = Annotated[str, Field(pattern=CITE_PATTERN, max_length=400)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Span(_Model):
    text: Annotated[str, Field(min_length=1, max_length=4000)]
    cites: Annotated[list[Anchor], Field(max_length=20)]
    mark: Literal["strong", "em", "highlight", "code"] | None = None


Spans = Annotated[list[Span], Field(min_length=1, max_length=40)]


class DiagramNode(_Model):
    id: Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,39}$")]
    label: Annotated[str, Field(min_length=1, max_length=120)]


class DiagramEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, serialize_by_alias=True)

    from_: Annotated[str, Field(alias="from")]
    to: str
    label: Annotated[str | None, Field(max_length=80)] = None


class Diagram(_Model):
    """The render contract's `diagram` block."""

    type: Literal["diagram"] = "diagram"
    direction: Literal["LR", "TD"] | None = None
    nodes: Annotated[list[DiagramNode], Field(min_length=1, max_length=60)]
    edges: Annotated[list[DiagramEdge], Field(max_length=150)]
    cites: Annotated[list[Anchor], Field(max_length=20)]
    confidence: Literal["high", "medium", "low"] | None = None


# --- Bodies, one per kind ----------------------------------------------------------------


class InsightBody(_Model):
    spans: Spans
    why: Spans | None = None


class SpansBody(_Model):
    """`remember` and `antipattern`."""

    spans: Spans


class QuoteBody(_Model):
    text: Annotated[str, Field(min_length=1)]
    page: Annotated[int | None, Field(ge=0)] = None
    attribution: str | None = None


class DefinitionBody(_Model):
    term: Annotated[str, Field(min_length=1)]
    spans: Spans


class NumberBody(_Model):
    value: Annotated[str, Field(min_length=1)]
    label: Spans


class FigureBody(_Model):
    image_url: Annotated[str, Field(min_length=1)]  # relative to the API: `media/<path>`
    caption: str | None = None
    takeaway: Spans


class DiagramBody(_Model):
    diagram: Diagram
    caption: str | None = None


class QuizBody(_Model):
    question: Annotated[str, Field(min_length=1)]
    choices: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=2, max_length=6)]
    answer: Annotated[int, Field(ge=0)]
    explanation: Spans

    @model_validator(mode="after")
    def _answer_is_a_choice(self) -> "QuizBody":
        if self.answer >= len(self.choices):
            raise ValueError("answer must index a choice")
        return self


class FlipBody(_Model):
    front: Annotated[str, Field(min_length=1)]
    back: Spans


class ClaimSupport(_Model):
    supports: Annotated[int, Field(ge=0)]
    contradicts: Annotated[int, Field(ge=0)]
    extends: Annotated[int, Field(ge=0)]


class ClaimBody(_Model):
    text: Annotated[str, Field(min_length=1)]
    claim_kind: ClaimKind
    strength: ClaimStrength
    support: ClaimSupport


class TryIt(_Model):
    question: Annotated[str, Field(min_length=1)]
    answer: Spans


class MathBody(_Model):
    latex: Annotated[str, Field(min_length=1)]
    name: Annotated[str, Field(min_length=1)]
    plain: Spans
    try_it: TryIt | None = None


class DocumentRef(_Model):
    id: uuid.UUID
    slug: Annotated[str, Field(min_length=1)]
    title: str


class ConnectionSide(_Model):
    document: DocumentRef
    anchor: Anchor
    spans: Spans  # cites are anchors of this side's document


ConnectionRelation = Literal[
    "echoes", "supports", "contradicts", "extends", "example_of", "same_as"
]


class ConnectionBody(_Model):
    relation: ConnectionRelation
    concept: str | None = None
    sides: Annotated[list[ConnectionSide], Field(min_length=2, max_length=2)]


class ListenBody(_Model):
    audio_url: Annotated[str, Field(min_length=1)]  # relative to the API: `audio/files/...`
    start_ms: Annotated[int, Field(ge=0)]
    end_ms: Annotated[int, Field(ge=0)]
    transcript: Spans


class HookBody(_Model):
    spans: Spans
    payoff: Spans


class ReviewBody(_Model):
    prompt: Annotated[str, Field(min_length=1)]
    answer: Spans


BODY_MODELS: dict[PillKind, type[BaseModel]] = {
    PillKind.INSIGHT: InsightBody,
    PillKind.REMEMBER: SpansBody,
    PillKind.ANTIPATTERN: SpansBody,
    PillKind.QUOTE: QuoteBody,
    PillKind.DEFINITION: DefinitionBody,
    PillKind.NUMBER: NumberBody,
    PillKind.FIGURE: FigureBody,
    PillKind.DIAGRAM: DiagramBody,
    PillKind.QUIZ: QuizBody,
    PillKind.FLIP: FlipBody,
    PillKind.CLAIM: ClaimBody,
    PillKind.MATH: MathBody,
    PillKind.CONNECTION: ConnectionBody,
    PillKind.LISTEN: ListenBody,
    PillKind.HOOK: HookBody,
    PillKind.REVIEW: ReviewBody,
}


def parse_body(kind: PillKind, body: dict[str, Any]) -> BaseModel:
    """The typed body of a `kind` pill (raises `pydantic.ValidationError` when it is not)."""
    return BODY_MODELS[kind].model_validate(body)


def dump_body(body: BaseModel) -> dict[str, Any]:
    """A body model as stored and sent: unset optionals left out (the schema has no nulls
    inside spans)."""
    return body.model_dump(mode="json", exclude_none=True, by_alias=True)


def is_active(kind: PillKind, body: dict[str, Any]) -> bool:
    """Active kinds ask something of you: quiz, flip, review, and math with a `try_it`."""
    return kind in ACTIVE_KINDS or (kind is PillKind.MATH and bool(body.get("try_it")))


# --- The pill ----------------------------------------------------------------------------


class PillDocument(_Model):
    id: uuid.UUID
    slug: Annotated[str, Field(min_length=1)]
    title: str
    genre: Genre
    theme: str | None  # the catalogue theme name


class PillSource(_Model):
    document: DocumentRef
    anchor: Anchor


class PillThread(_Model):
    key: Annotated[str, Field(min_length=1)]
    index: Annotated[int, Field(ge=0)]
    size: Annotated[int, Field(ge=1)]
    title: str | None


class PillOut(_Model):
    """One pill on the wire: self-contained, so a client renders it with no other call."""

    id: uuid.UUID
    kind: PillKind
    document: PillDocument
    anchor: Anchor
    unit_title: str | None
    headline: Annotated[str | None, Field(max_length=200)]
    body: dict[str, Any]
    cites: list[Cite]
    sources: dict[str, PillSource]
    concepts: list[str]
    thread: PillThread | None
    est_seconds: Annotated[int, Field(ge=1, le=600)]
    origin: Annotated[
        str, Field(pattern=r"^(harvest:[a-z_]+|skill:[a-z0-9-]+@[A-Za-z0-9._-]+|review:[a-z_]+)$")
    ]
    draft: bool
    review_item_id: uuid.UUID | None

    @model_validator(mode="after")
    def _body_matches_kind(self) -> "PillOut":
        parse_body(self.kind, self.body)
        return self
