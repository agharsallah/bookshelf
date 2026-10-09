"""make-pills' cross-field hard gates (`app.papers.checks.CHECKS["make-pills"]`).

Run after the schema and anchor gates pass, in batch runs and interactive imports alike;
a problem fails the output and goes back to the model on the retry:

* a quiz's `answer` indexes one of its `choices`;
* a thread holds 3-6 pills (the schema says so too; this keeps the rule next to the others);
* no pill restates a harvested one (`inputs.harvested[].text`: a headline or a pill's
  first words) or another pill of the output, compared as normalized text: case,
  punctuation and spacing aside, equal, or sharing most of their words.
"""

import re
from collections.abc import Iterator
from typing import Any

from app.pills.skill_inputs import SNIPPET_WORDS, snippet
from app.pipeline.bodies import read_text
from app.pipeline.selectors import Selection

THREAD_SIZE = (3, 6)
NEAR_DUPLICATE = 0.8  # word-set Jaccard at or above which two snippets say the same thing
_MIN_COMPARED_WORDS = 4  # shorter snippets only count when equal
_NON_WORD = re.compile(r"[^\w]+")


def normalized(text: str) -> str:
    """Lower case, punctuation and runs of spaces folded to one space (the ellipsis of a
    cut snippet goes too)."""
    return _NON_WORD.sub(" ", text.casefold()).strip()


def _similar(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    wa, wb = set(a.split()), set(b.split())
    if min(len(wa), len(wb)) < _MIN_COMPARED_WORDS:
        return False
    return len(wa & wb) / len(wa | wb) >= NEAR_DUPLICATE


def _matches(names: list[str], other: str) -> bool:
    return any(_similar(name, other) for name in names)


def _pills(output: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    """Every pill with where it sits (`threads[0].pills[2]`, `pills[1]`)."""
    for t, thread in enumerate(output["threads"]):
        for p, pill in enumerate(thread["pills"]):
            yield f"threads[{t}].pills[{p}]", pill
    for p, pill in enumerate(output["pills"]):
        yield f"pills[{p}]", pill


def _names(pill: dict[str, Any]) -> list[str]:
    """What a pill is compared by: its headline and its opening words, normalized."""
    opening = normalized(snippet(read_text(pill["body"]), SNIPPET_WORDS))
    return [n for n in (normalized(pill["headline"]), opening) if n]


def check_pill_set(output: dict[str, Any], selection: Selection) -> list[str]:
    problems: list[str] = []
    low, high = THREAD_SIZE
    for t, thread in enumerate(output["threads"]):
        if not low <= len(thread["pills"]) <= high:
            problems.append(
                f"threads[{t}]: {len(thread['pills'])} pills; a thread holds {low}-{high}"
            )
    harvested = [
        (normalized(str(h.get("text", ""))), str(h.get("text", "")))
        for h in selection.inputs.get("harvested", [])
        if isinstance(h, dict)
    ]
    seen: list[tuple[str, str]] = []  # (normalized name, where)
    for where, pill in _pills(output):
        body = pill["body"]
        if pill["kind"] == "quiz" and not 0 <= body["answer"] < len(body["choices"]):
            problems.append(
                f"{where}: answer {body['answer']} is not an index of its "
                f"{len(body['choices'])} choices (0-based)"
            )
        names = _names(pill)
        copied = next((raw for norm, raw in harvested if _matches(names, norm)), None)
        if copied is not None:
            problems.append(
                f"{where}: restates the harvested pill {copied!r}; drop it or find a new angle"
            )
        twin = next((w for norm, w in seen if _matches(names, norm)), None)
        if twin is not None:
            problems.append(f"{where}: repeats {twin}; keep one")
        seen.extend((n, where) for n in names)
    return problems
