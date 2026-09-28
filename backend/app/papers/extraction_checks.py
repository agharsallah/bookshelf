"""Cross-field hard gates of `extract-results` and `classify-citations` (`papers.checks`).

The schema fixes the shapes and the selectors restrict which anchors may be cited at all
(results: results/experiments units, tables, figures; citations: the citing passages).
What is left is per item:

    extract-results     every value a finite number (JSON parsers accept NaN and Infinity);
                        one row per (method, dataset, metric, setting)
    classify-citations  every ordinal offered and classified once; each verdict cites the
                        passages that cite *that* reference, not a neighbour's
"""

import math
from typing import Any

from app.pipeline.selectors import Selection


def _key(row: dict[str, Any]) -> tuple[str, ...]:
    parts = (row["method"], row["dataset"], row["metric"], row.get("setting") or "")
    return tuple(" ".join(str(p).casefold().split()) for p in parts)


def check_results(output: dict[str, Any], selection: Selection) -> list[str]:
    problems: list[str] = []
    seen: set[tuple[str, ...]] = set()
    for index, row in enumerate(output["rows"]):
        where = f"rows[{index}] ({row['method']} / {row['dataset']} / {row['metric']})"
        value = row["value"]
        if isinstance(value, bool) or not math.isfinite(float(value)):
            problems.append(f"{where}: value {value!r} is not a finite number; give the number")
        key = _key(row)
        if key in seen:
            problems.append(
                f"{where}: repeats an earlier row; tell them apart with `setting` or drop one"
            )
        seen.add(key)
    return problems


def check_citations(output: dict[str, Any], selection: Selection) -> list[str]:
    offered = {
        r["ordinal"]: {c["anchor"] for c in r["contexts"]}
        for r in selection.inputs.get("references", [])
    }
    problems: list[str] = []
    seen: set[int] = set()
    for item in output["citations"]:
        ordinal = item["ordinal"]
        if ordinal not in offered:
            problems.append(f"citations: ordinal {ordinal} is not in inputs.references")
            continue
        if ordinal in seen:
            problems.append(f"citations: ordinal {ordinal} is classified twice; keep one")
        seen.add(ordinal)
        foreign = sorted(set(item["cites"]) - offered[ordinal])
        if foreign:
            listed = ", ".join(sorted(offered[ordinal]))
            problems.append(
                f"citations: ordinal {ordinal} cites {', '.join(foreign)}, which do not cite "
                f"it; cite one of its own contexts: {listed}"
            )
    return problems
