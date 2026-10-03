"""Pure renderers of `docs/PAPER.md`'s sections (docs/BUILDS.md B8, B12).

Each takes the paper card, explainer, claims or results (cites still in) and returns the
section's Markdown body with every cite, anchor and `[n]` marker stripped, or "" when the
shelf has nothing for it. `app.builds.context` names and orders them.
"""

import copy
import re
from typing import Any

from app.models.enums import ClaimKind, ClaimStrength
from app.pipeline.bodies import iter_objects
from app.services.render_markdown import markdown_table, render_blocks, render_spans

# Keys that point into the source document; none of them survive into the repo.
_APPARATUS = ("cites", "evidence", "anchor", "first_anchor")
# `[3]`, `[3, 7]`, `[3-5]` (or an en dash), not a Markdown link; anchors like `ch03/s01/p002`.
_MARKERS = re.compile(r"\s?\[\d+(?:\s*[,\u2013-]\s*\d+)*\](?!\()")
_ANCHORS = re.compile(r"\s?\(?\b[a-z]{1,3}\d+(?:/[a-z]{1,3}\d+)+\b\)?")
_STRENGTH_ORDER = {s: i for i, s in enumerate(ClaimStrength)}


# --- stripping ----------------------------------------------------------------------------


def clean_text(text: str) -> str:
    """`text` without `[n]` markers or anchors."""
    return _ANCHORS.sub("", _MARKERS.sub("", text)).strip()


def strip_apparatus(value: Any) -> Any:
    """A deep copy of `value` without cites, anchors or citation markers anywhere."""
    out = copy.deepcopy(value)
    for obj in iter_objects(out):
        for key in _APPARATUS:
            obj.pop(key, None)
        for key, item in obj.items():
            if isinstance(item, str) and key in ("text", "caption", "title"):
                obj[key] = clean_text(item)
    return out


# --- sections -----------------------------------------------------------------------------


def spans(value: Any) -> str:
    items = [s for s in value if isinstance(s, dict)] if isinstance(value, list) else []
    return render_spans(strip_apparatus(items)).strip()


def _blocks(value: Any) -> str:
    blocks = [b for b in value if isinstance(b, dict)] if isinstance(value, list) else []
    return render_blocks(strip_apparatus(blocks)).strip()


def _object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _bullets(lines: list[str]) -> str:
    return "\n".join(f"- {line}" for line in lines if line)


def _span_list(value: Any) -> str:
    """A list of span lists (limitations, assumptions…) as bullets."""
    return _bullets([spans(item) for item in value]) if isinstance(value, list) else ""


def core_ideas(card: dict[str, Any]) -> str:
    items = []
    for item in card.get("contributions") or []:
        text = spans(item.get("spans")) if isinstance(item, dict) else ""
        if text:
            items.append(f"**{str(item.get('kind', '')).capitalize()}**: {text}")
    return _bullets(items)


def how_it_works(card: dict[str, Any], explainer: dict[str, Any]) -> str:
    parts = [_blocks(card.get("method"))]
    for key, title in (("intuition", "Intuition"), ("walkthrough", "Walkthrough")):
        if body := _blocks(explainer.get(key)):
            parts.append(f"### {title}\n\n{body}")
    if analogy := spans(explainer.get("analogy")):
        parts.append(f"### An analogy\n\n{analogy}")
    return "\n\n".join(p for p in parts if p)


def equations(explainer: dict[str, Any]) -> str:
    out = []
    for eq in explainer.get("equations") or []:
        latex = str(eq.get("latex", "")).strip() if isinstance(eq, dict) else ""
        if latex:
            plain = spans(eq.get("plain"))
            out.append(f"$$\n{latex}\n$$" + (f"\n\n{plain}" if plain else ""))
    return "\n\n".join(out)


def setup(card: dict[str, Any]) -> str:
    setup = _object(card.get("setup"))
    parts = []
    for key, title in (
        ("datasets", "Datasets"),
        ("baselines", "Baselines"),
        ("metrics", "Metrics"),
    ):
        items = [
            f"**{clean_text(str(i.get('name', '')))}**"
            + (f": {t}" if (t := spans(i.get("spans"))) else "")
            for i in setup.get(key) or []
            if isinstance(i, dict)
        ]
        if items:
            parts.append(f"**{title}**\n\n{_bullets(items)}")
    return "\n\n".join(parts)


def _value(row: dict[str, Any]) -> str:
    value, unit = row.get("value"), row.get("unit")
    text = "" if value is None else str(value)
    return f"{text} {unit}".strip() if unit else text


def results(card: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    numbers = [
        f"**{clean_text(str(n.get('value', '')))}**: {spans(n.get('label'))}"
        for n in card.get("numbers") or []
        if isinstance(n, dict)
    ]
    proposed = [r for r in rows if r.get("is_proposed")]
    table = markdown_table(
        ["Method", "Dataset", "Metric", "Value", "Setting"],
        [[str(r.get(k) or "") for k in ("method", "dataset", "metric")]
         + [_value(r), str(r.get("setting") or "")] for r in proposed],
    ) if proposed else _blocks(card.get("results"))  # fmt: skip
    return "\n\n".join(p for p in (_bullets(numbers), table) if p)


def claims(rows: list[dict[str, Any]]) -> str:
    parts = []
    for kind in ClaimKind:
        group = sorted(
            (c for c in rows if c.get("kind") == kind.value),
            key=lambda c: _STRENGTH_ORDER.get(ClaimStrength(c["strength"]), 99),
        )
        if group:
            lines = [f"{clean_text(c['text'])} *({c['strength']})*" for c in group]
            parts.append(f"### {kind.value.capitalize()}\n\n{_bullets(lines)}")
    return "\n\n".join(parts)


def limitations(card: dict[str, Any]) -> str:
    limits = _object(card.get("limitations"))
    parts = [
        (title, _span_list(value))
        for title, value in (
            ("Stated by the authors", limits.get("stated")),
            ("Not stated by the authors", limits.get("unstated")),
            ("Assumptions", card.get("assumptions")),
            ("Open questions", card.get("future_work")),
        )
    ]
    return "\n\n".join(f"**{title}**\n\n{body}" for title, body in parts if body)
