"""Cross-field hard gates of the paper skills: rules a JSON Schema cannot state.

`pipeline.execution.output_problems` runs `CHECKS[skill.name](output, selection)` after the
schema and anchor gates pass (so shapes are guaranteed), in batch runs and interactive
imports alike; a problem fails the output and is sent back on the retry, phrased for the
model. Human edits keep D15's bypass (schema only). A new paper skill adds one entry.

    assess-paper       every score and checklist item cited; related shelf slugs exist
    review-paper       the verdict is cited
    make-notation      one entry per symbol; first_anchor is an input block at or before
                       every cited use
    make-journal-club  key_figure is one of the input figures (null only when there is none)
    extract-claims     keys and texts unique, every claim cited, a measured claim cites a
                       measurement (app.papers.claims)
    extract-results    values finite, one row per (method, dataset, metric, setting)
    classify-citations ordinals offered and unique, each cites its own citing passages
                       (both app.papers.extraction_checks)
"""

import re
from collections.abc import Callable, Iterable
from typing import Any

from app.papers.claims import check_claims
from app.papers.extraction_checks import check_citations, check_results
from app.pipeline.bodies import cited_anchors
from app.pipeline.selectors import Selection

Check = Callable[[dict[str, Any], Selection], list[str]]

_SPACE = re.compile(r"\s+")


def _uncited(spans: Iterable[dict[str, Any]]) -> bool:
    return not any(s.get("cites") for s in spans)


def check_assessment(output: dict[str, Any], selection: Selection) -> list[str]:
    problems = [
        f"scores: {s['criterion']} cites nothing; cite the passages the score rests on"
        for s in output["scores"]
        if _uncited(s["spans"])
    ]
    problems += [
        f"reproducibility: {r['item']} cites nothing; cite the passage that reports it, or "
        "for no/unknown the setup section where it would be stated"
        for r in output["reproducibility"]
        if _uncited(r["spans"])
    ]
    shelf = {p["slug"] for p in selection.inputs.get("shelf", {}).get("papers", [])}
    problems += [
        f"related_shelf: {item['slug']!r} is not a slug in inputs.shelf.papers"
        for item in output["related_shelf"]
        if item["slug"] not in shelf
    ]
    return problems


def check_review(output: dict[str, Any], selection: Selection) -> list[str]:
    if _uncited(output["verdict"]["spans"]):
        return ["verdict: the recommendation cites nothing; cite what it rests on"]
    return []


def symbol_key(latex: str) -> str:
    """Two spellings of one symbol (`d_k`, `d_{k}`, ` d_k `) share a key."""
    return _SPACE.sub("", latex).replace("{", "").replace("}", "")


def check_notation(output: dict[str, Any], selection: Selection) -> list[str]:
    order = {b["anchor"]: i for i, b in enumerate(selection.inputs.get("blocks", []))}
    problems: list[str] = []
    seen: dict[str, str] = {}
    for entry in output["symbols"]:
        symbol, first = entry["symbol_latex"], entry["first_anchor"]
        key = symbol_key(symbol)
        if key in seen:
            problems.append(f"symbols: {symbol!r} repeats {seen[key]!r}; merge them into one entry")
        seen.setdefault(key, symbol)
        if first not in order:
            problems.append(f"symbols: {symbol!r} first_anchor {first} is not in inputs.blocks")
            continue
        outside = sorted(a for a in cited_anchors(entry) if a not in order)
        if outside:
            problems.append(f"symbols: {symbol!r} cites blocks not in inputs.blocks: {outside}")
        earlier = sorted((a for a in entry["cites"] if order.get(a, 1 << 30) < order[first]),
                         key=order.__getitem__)  # fmt: skip
        if earlier:
            problems.append(
                f"symbols: {symbol!r} is cited at {earlier[0]} before its first_anchor {first}; "
                "first_anchor must be the first block that uses it"
            )
    return problems


def check_journal_club(output: dict[str, Any], selection: Selection) -> list[str]:
    offered = [f["anchor"] for f in selection.inputs.get("figures", [])]
    key = output["key_figure"]
    if key is None and offered:
        return ["key_figure: pick one of inputs.figures; it is null only when there are none"]
    if key is not None and key["anchor"] not in offered:
        listed = ", ".join(offered) or "none"
        return [f"key_figure: {key['anchor']} is not a figure; pick one of: {listed}"]
    return []


CHECKS: dict[str, Check] = {
    "assess-paper": check_assessment,
    "review-paper": check_review,
    "make-notation": check_notation,
    "make-journal-club": check_journal_club,
    "extract-claims": check_claims,  # app.papers.claims
    "extract-results": check_results,  # app.papers.extraction_checks
    "classify-citations": check_citations,
}


def problems(skill: str, output: dict[str, Any], selection: Selection) -> list[str]:
    """The cross-field problems of `skill`'s output (none for a skill without a check)."""
    check = CHECKS.get(skill)
    return check(output, selection) if check is not None else []
