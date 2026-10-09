"""What every harvester shares: its input, its output (`PillDraft`) and the rules of §4.

A harvester is a pure function `(HarvestInput) -> list[PillDraft]`: an artifact body plus
the little context it needs (the document's units, figure crops, audio renders, claim
support counts), no session. `draft()` turns one idea into a pill: it finds the unit the
pill belongs to, builds the body through its contract model, estimates the reading time and
derives the stable `source_key`, so every harvester states only what it reads.
"""

import hashlib
import re
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

from app.audio.store import Render
from app.models import Artifact
from app.models.enums import ArtifactType, Genre, PillKind, Review
from app.pills.contract import dump_body, is_active
from app.pipeline.bodies import read_text

WORDS_PER_MINUTE = 238
MIN_SECONDS, MAX_SECONDS = 8, 90
ACTIVE_BONUS_SECONDS = 10
MIN_WORDS, MAX_WORDS = 6, 80  # one idea: a prose pill outside these bounds is skipped
_WORD = re.compile("\\w+(?:['\u2019.-]\\w+)*")
_SPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class Unit:
    """A chapter (or a paper's top-level section): what a pill belongs to."""

    anchor: str
    title: str | None


@dataclass(frozen=True, slots=True)
class HarvestContext:
    """The document-wide facts harvesters may read (loaded by `app.pills.inputs`)."""

    document_id: uuid.UUID
    slug: str
    genre: Genre
    units: tuple[Unit, ...]
    figures: Mapping[str, str] = field(default_factory=dict)  # figure anchor → image_path
    # claim id → {supports, contradicts, extends}: accepted claim ↔ claim edges
    claim_support: Mapping[uuid.UUID, Mapping[str, int]] = field(default_factory=dict)
    renders: Mapping[str, Render] = field(default_factory=dict)  # artifact id → newest render
    # passage anchor → names of the concepts whose accepted edges rest on it
    concept_index: Mapping[str, Sequence[str]] = field(default_factory=dict)

    def unit_of(self, anchor: str | None) -> str | None:
        """The unit an anchor lives in: the longest unit anchor equal to it or above it."""
        if not anchor:
            return None
        found = [
            u.anchor for u in self.units if anchor == u.anchor or anchor.startswith(f"{u.anchor}/")
        ]
        return max(found, key=len) if found else None

    def unit_for(self, *anchors: str | None) -> str | None:
        """The unit of the first anchor that lives in one."""
        return next((u for a in anchors if (u := self.unit_of(a)) is not None), None)


@dataclass(frozen=True, slots=True)
class SourceArtifact:
    """The preferred artifact of one `(type, anchor, variant)` scope."""

    id: uuid.UUID | None
    type: ArtifactType
    anchor: str | None
    variant: str | None
    body: Mapping[str, Any]
    draft: bool  # not approved yet: the latest non-rejected version
    skill_version: str | None = None

    @classmethod
    def of(cls, row: Artifact) -> "SourceArtifact":
        return cls(
            id=row.id,
            type=row.type,
            anchor=row.anchor,
            variant=row.variant,
            body=row.body,
            draft=row.review is not Review.APPROVED,
            skill_version=row.skill_version,
        )


@dataclass(frozen=True, slots=True)
class HarvestInput:
    context: HarvestContext
    artifact: SourceArtifact


@dataclass(slots=True)
class PillDraft:
    """One pill a harvest wants to exist; `app.pills.store` upserts it by `source_key`."""

    kind: PillKind
    anchor: str
    body: dict[str, Any]
    cites: list[str]
    origin: str
    source_key: str
    est_seconds: int
    fingerprint: str  # kind + normalized content: the same idea twice is harvested once
    headline: str | None = None
    concepts: list[str] = field(default_factory=list)
    thread_key: str | None = None
    thread_index: int | None = None
    thread_title: str | None = None
    source_artifact_id: uuid.UUID | None = None
    draft: bool = False


Harvester = Callable[[HarvestInput], list[PillDraft]]


# --- Text --------------------------------------------------------------------------------


def normalize(text: str) -> str:
    return _SPACE.sub(" ", text).strip().casefold()


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def spans_text(spans: Iterable[Mapping[str, Any]]) -> str:
    return "".join(str(s.get("text", "")) for s in spans).strip()


def spans_cites(*groups: Iterable[Mapping[str, Any]]) -> list[str]:
    """Every cite of the spans, in order, once."""
    seen: dict[str, None] = {}
    for spans in groups:
        for span in spans:
            for cite in span.get("cites", []):
                if isinstance(cite, str):
                    seen.setdefault(cite, None)
    return list(seen)


def within_bounds(text: str) -> bool:
    return MIN_WORDS <= count_words(text) <= MAX_WORDS


def est_seconds(kind: PillKind, body: Mapping[str, Any], headline: str | None = None) -> int:
    """Words ÷ 238 wpm, clamped to [8, 90]; active kinds add 10 s (§2)."""
    words = count_words(read_text(dict(body))) + count_words(headline or "")
    seconds = min(max(round(words / WORDS_PER_MINUTE * 60), MIN_SECONDS), MAX_SECONDS)
    return seconds + (ACTIVE_BONUS_SECONDS if is_active(kind, dict(body)) else 0)


def source_key(origin: str, document_id: uuid.UUID, anchor: str, content: str) -> str:
    """Stable across rebuilds: the same idea from the same source keeps its row."""
    raw = "\x1f".join((origin, str(document_id), anchor, normalize(content)))
    return hashlib.sha256(raw.encode()).hexdigest()


def clean_cites(cites: Iterable[Any]) -> list[str]:
    return list(dict.fromkeys(c for c in cites if isinstance(c, str) and c))


# --- Building a pill ---------------------------------------------------------------------


def harvest_origin(kind: ArtifactType | str) -> str:
    return f"harvest:{kind}"


def draft(
    inp: HarvestInput,
    kind: PillKind,
    body: BaseModel,
    *,
    content: str,
    cites: Sequence[str],
    headline: str | None = None,
    anchor: str | None = None,
    origin: str | None = None,
    concepts: Sequence[str] = (),
    seconds: int | None = None,
) -> PillDraft | None:
    """One pill from one idea, or None when it belongs to no unit.

    `content` is what makes the idea this idea (its main text): it keys the pill. The unit
    is `anchor`'s, else the artifact scope's, else that of the first cite in a unit.
    """
    ctx, source = inp.context, inp.artifact
    unit = ctx.unit_for(anchor, source.anchor, *cites)
    if unit is None:
        return None
    origin = origin or harvest_origin(source.type)
    dumped = dump_body(body)
    title = headline.strip()[:200] if headline and headline.strip() else None
    return PillDraft(
        kind=kind,
        anchor=unit,
        body=dumped,
        cites=clean_cites(cites),
        origin=origin,
        source_key=source_key(origin, ctx.document_id, unit, f"{kind}\x1f{content}"),
        est_seconds=seconds if seconds is not None else est_seconds(kind, dumped, title),
        fingerprint=f"{kind}\x1f{normalize(content)}",
        headline=title,
        concepts=list(concepts),
        source_artifact_id=source.id,
        draft=source.draft,
    )


def build[M: BaseModel](model: type[M], **fields: Any) -> M | None:
    """A body model, or None when the artifact's item does not fit the contract (a human
    edit may leave one malformed; it is skipped, not fatal)."""
    try:
        return model.model_validate(fields)
    except ValidationError:
        return None


def items(value: Any) -> list[dict[str, Any]]:
    """The dict entries of a list field (anything else in it is skipped)."""
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []
