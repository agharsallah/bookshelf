"""Quality gates (§14): truthfulness checks every artifact passes before it is stored.

Two kinds of gate:

* **Hard** (`output_problems`): schema and anchor validity. A failure rejects the output;
  the batch runner retries once with the problems appended, then fails the job.
* **Soft** (`evaluate`): grounding, compression band, max words, non-prose confidence,
  verbatim code, verbatim quotes, duplication between sibling section notes, and chapter
  coverage of book-wide study material. A failure stores the artifact
  as `needs_review` with the reasons in `gates.flags`.

Human-authored artifacts (D15) pass the hard gates only: `origin = human` bypasses the rest.
"""

import json
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource

from app.core.config import REPO_ROOT
from app.models.enums import Origin, Review
from app.pipeline.bodies import (
    cited_anchors,
    count_words,
    iter_objects,
    leaf_spans,
    plain_text,
    spoken_words,
)
from app.pipeline.skills import GateConfig

CONTRACTS_DIR = REPO_ROOT / "contracts"
RENDER_BLOCKS_ID = "https://bookshelf.local/contracts/render-blocks.schema.json"
# Fallback schema for artifact types no skill declares: `{blocks: [...]}`.
RENDER_BODY_SCHEMA: dict[str, Any] = {"$ref": RENDER_BLOCKS_ID}

DUPLICATION_MAX = 0.5  # word-shingle Jaccard above which sibling notes repeat each other
_SHINGLE = 3
_MAX_PROBLEMS = 20


# --- Hard gates ------------------------------------------------------------------------


@lru_cache(maxsize=4)
def contracts_registry(contracts_dir: Path = CONTRACTS_DIR) -> Registry[Any]:
    """Every `contracts/*.json` schema, addressable by its `$id`."""
    resources = []
    for path in sorted(contracts_dir.glob("*.json")):
        contents = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(contents, dict) and isinstance(contents.get("$id"), str):
            resources.append((contents["$id"], Resource.from_contents(contents)))
    return Registry().with_resources(resources)


def schema_errors(
    schema: dict[str, Any], output: Any, *, contracts_dir: Path = CONTRACTS_DIR
) -> list[str]:
    validator = Draft202012Validator(schema, registry=contracts_registry(contracts_dir))
    errors = sorted(validator.iter_errors(output), key=lambda e: [str(p) for p in e.path])
    explained = [leaf for error in errors for leaf in _explain(error)]
    return [
        f"schema: {'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {_message(e)}"
        for e in explained[:_MAX_PROBLEMS]
    ]


_MESSAGE_MAX = 300
_SIZE_WORDS = {
    "maxLength": ("characters", "at most"), "minLength": ("characters", "at least"),
    "maxItems": ("items", "at most"), "minItems": ("items", "at least"),
}  # fmt: skip


def _message(error: ValidationError) -> str:
    """A problem the retry can act on. jsonschema puts the offending value first ("'<the
    whole caption>' is too long"), so a plain cut keeps the value and loses the verdict; say
    sizes outright and, for anything else, keep the message's head and its tail."""
    if error.validator in _SIZE_WORDS and isinstance(error.instance, (str, list)):
        unit, bound = _SIZE_WORDS[str(error.validator)]
        return f"has {len(error.instance)} {unit}; {bound} {error.validator_value} allowed"
    message = error.message
    if len(message) <= _MESSAGE_MAX:
        return message
    return f"{message[:120]} … {message[-(_MESSAGE_MAX - 123) :]}"


def _explain(error: ValidationError) -> list[ValidationError]:
    """Replace "not valid under any of the given schemas" with the errors of the branch the
    output meant: blocks are a `oneOf` (the render contract) or an `anyOf` (a skill's own
    subset) keyed by `type`, so drop branches whose `type` const failed and report what is
    wrong inside the one that is left. The retry prompt then says e.g. "'spans' is a
    required property" instead of a message no model can act on."""
    if error.validator not in ("oneOf", "anyOf") or not error.context:
        return [error]
    branches: dict[Any, list[ValidationError]] = {}
    for sub in error.context:
        branches.setdefault(sub.schema_path[0] if sub.schema_path else None, []).append(sub)
    meant = [
        subs
        for subs in branches.values()
        if not any(s.validator == "const" and list(s.relative_path) == ["type"] for s in subs)
    ]
    if len(meant) != 1:
        return [error]
    return [leaf for sub in meant[0] for leaf in _explain(sub)]


def invalid_anchors(output: Any, valid: Collection[str]) -> list[str]:
    return sorted(cited_anchors(output) - set(valid))


def output_problems(
    schema: dict[str, Any], output: Any, valid_anchors: Collection[str]
) -> list[str]:
    """Hard-gate failures, phrased so the model can fix them on the retry."""
    problems = schema_errors(schema, output)
    unknown = invalid_anchors(output, valid_anchors)
    if unknown:
        listed = ", ".join(unknown[:_MAX_PROBLEMS])
        problems.append(f"anchors: cited anchors do not exist in this document: {listed}")
    return problems


# --- Soft gates --------------------------------------------------------------------------


@dataclass(slots=True)
class GateReport:
    grounding: float | None = None
    compression: float | None = None
    words: int = 0
    flags: list[str] = field(default_factory=list)
    schema_retry: bool = False
    repairs: list[str] = field(default_factory=list)  # render-block shape fixes (repair.py)
    coverage: float | None = None  # book-wide: share of offered chapters cited
    uncovered: list[str] = field(default_factory=list)  # ...and the chapters never cited
    pace: float | None = None  # spoken output: words per minute of its intended length

    @property
    def review(self) -> Review:
        """Every soft flag means a human should look before this is consumed as-is."""
        return Review.NEEDS_REVIEW if self.flags else Review.DRAFT

    def as_json(self) -> dict[str, Any]:
        return {
            "grounding": self.grounding,
            "compression": self.compression,
            "words": self.words,
            "flags": self.flags,
            "schema_retry": self.schema_retry,
            "repairs": self.repairs,
            "coverage": self.coverage,
            "uncovered": self.uncovered,
            **({"pace": self.pace} if self.pace is not None else {}),
        }


def grounding_score(output: Any, valid_anchors: Collection[str]) -> float | None:
    """Share of leaf spans citing at least one valid anchor. None when there are no spans."""
    spans = leaf_spans(output)
    if not spans:
        return None
    valid = set(valid_anchors)
    grounded = sum(1 for s in spans if any(c in valid for c in s["cites"] if isinstance(c, str)))
    return grounded / len(spans)


def uncovered_chapters(output: Any, chapters: Sequence[str]) -> list[str]:
    """The chapters (anchors) no cite in `output` falls under, in the given order."""
    cited = cited_anchors(output)
    return [ch for ch in chapters if not any(a == ch or a.startswith(ch + "/") for a in cited)]


def shingles(text: str, size: int = _SHINGLE) -> set[tuple[str, ...]]:
    words = text.lower().split()
    return {tuple(words[i : i + size]) for i in range(max(len(words) - size + 1, 0))}


def jaccard(a: set[tuple[str, ...]], b: set[tuple[str, ...]]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def duplicates(
    text: str, siblings: Mapping[str, str], threshold: float = DUPLICATION_MAX
) -> list[str]:
    """Sibling anchors whose text overlaps `text` above the threshold (cheap, lexical)."""
    own = shingles(text)
    return sorted(a for a, other in siblings.items() if jaccard(own, shingles(other)) > threshold)


def _code_rewritten(output: Any, element: Mapping[str, Any]) -> bool:
    """A code block citing the listing must reproduce it byte for byte (§14)."""
    anchor, source = element.get("anchor"), element.get("text")
    return any(
        obj.get("type") == "code" and anchor in obj.get("cites", []) and obj.get("text") != source
        for obj in iter_objects(output)
    )


# Typography a model tends to straighten when it copies text; counted as the same character.
_SAME_CHARS = str.maketrans(
    {"\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-"}
)


def _normalised(text: str) -> str:
    return " ".join(text.translate(_SAME_CHARS).split())


def block_texts(inputs: Mapping[str, Any]) -> dict[str, str]:
    """`inputs.blocks` as anchor → text, the sources a quoting skill copies from."""
    blocks = inputs.get("blocks")
    if not isinstance(blocks, list):
        return {}
    return {
        b["anchor"]: b["text"]
        for b in blocks
        if isinstance(b, dict)
        and isinstance(b.get("anchor"), str)
        and isinstance(b.get("text"), str)
    }


def unquoted(output: Any, sources: Mapping[str, str]) -> list[str]:
    """Leaf spans whose text is not in the block they cite (as `anchor: text`), in order."""
    found: list[str] = []
    for span in leaf_spans(output):
        cites = [c for c in span["cites"] if isinstance(c, str)]
        if not any(_normalised(span["text"]) in _normalised(sources.get(c, "")) for c in cites):
            found.append(f"{cites[0] if cites else '?'}: {span['text'][:80]}")
    return found


def evaluate(
    output: dict[str, Any],
    *,
    config: GateConfig,
    valid_anchors: Collection[str],
    source_words: int,
    origin: Origin = Origin.SKILL,
    element: Mapping[str, Any] | None = None,
    siblings: Mapping[str, str] | None = None,
    schema_retry: bool = False,
    visible_anchors: Collection[str] | None = None,
    repairs: Sequence[str] = (),
    chapters: Sequence[str] = (),
    minutes: float | None = None,
    sources: Mapping[str, str] | None = None,
) -> GateReport:
    """Score an output that already passed the hard gates.

    `visible_anchors`: what the skill was shown. A cite of an existing anchor outside it
    (grounded on paper, but on a passage the model never saw) flags `out_of_scope_cites`.
    `chapters`: the chapters a book-wide input offered; with `coverage_min` set, citing too
    few of them flags `coverage_below_min` and lists the rest in `uncovered`.
    `minutes`: how long a spoken output should last; with `words_per_minute` set, a pace
    outside the band flags `too_short_to_fill` / `too_long_to_fit` (`pace` = words/min).
    `sources`: the blocks a quoting skill copied from (anchor → text); with `verbatim` set,
    a span not found in the block it cites flags `not_verbatim`."""
    words = count_words(plain_text(output))
    report = GateReport(words=words, schema_retry=schema_retry, repairs=list(repairs))
    if origin is Origin.HUMAN:  # D15 human bypass: schema + anchors only
        return report

    report.grounding = grounding_score(output, valid_anchors)
    if report.grounding is not None and report.grounding < config.grounding_min:
        report.flags.append("grounding_below_min")
    if config.compression is not None and source_words > 0:
        low, high = config.compression
        report.compression = round(words / source_words, 4)
        if report.compression < low:
            report.flags.append("compression_low")
        elif report.compression > high and source_words >= (config.compression_min_source or 0):
            report.flags.append("compression_high")
    if config.max_words is not None and words > config.max_words:
        report.flags.append("over_max_words")
    if config.words_per_minute is not None and minutes:
        low, high = config.words_per_minute
        report.pace = round(spoken_words(plain_text(output)) / minutes, 1)
        if report.pace < low:
            report.flags.append("too_short_to_fill")
        elif report.pace > high:
            report.flags.append("too_long_to_fit")
    if output.get("confidence") == "low":
        report.flags.append("low_confidence")
    if element is not None and element.get("kind") == "code" and _code_rewritten(output, element):
        report.flags.append("code_not_verbatim")
    if config.verbatim and sources is not None and unquoted(output, sources):
        report.flags.append("not_verbatim")
    if visible_anchors is not None and cited_anchors(output) - set(visible_anchors):
        report.flags.append("out_of_scope_cites")
    if chapters and config.coverage_min is not None:
        report.uncovered = uncovered_chapters(output, chapters)
        report.coverage = round(1 - len(report.uncovered) / len(chapters), 4)
        if report.coverage < config.coverage_min:
            report.flags.append("coverage_below_min")
    for anchor in duplicates(plain_text(output), siblings or {}):
        report.flags.append(f"duplicate_of:{anchor}")
    return report
