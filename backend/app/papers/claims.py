"""Claims, the atom of a paper (docs/PAPERS.md P4): the rules a claim set obeys, and the
identity a claim keeps across versions.

* **Gate** (`check_claims`, registered in `app.papers.checks`): keys unique, texts unique,
  every claim cited, and a `measured` claim cites a measurement: a passage of a `results`,
  `experiments` or `appendix` unit, a table (`t…`) or a figure (`f…`). The schema already
  guarantees the shape, so this only states what a JSON Schema cannot.
* **Identity** (`claim_id`): a UUIDv5 of the document and the claim's normalised text. A
  new version of the claim set that keeps a claim (whatever its key) keeps the claim's row,
  its Qdrant point and every edge a human reviewed on it; a reworded claim is a new claim.
"""

import re
import uuid
from collections.abc import Collection, Iterable, Mapping
from typing import Any

from app.models.enums import ClaimStrength, SectionRole
from app.pipeline.selectors import Selection

NAMESPACE = uuid.UUID("0b6a4f0e-2f43-5d0c-9a51-6c1a1e7d3c22")
# Units whose passages measure: a result claimed there was measured by the paper. Appendices
# count: they hold the extra ablations and per-task results papers move out of the body.
MEASURING_ROLES = frozenset(
    {SectionRole.RESULTS.value, SectionRole.EXPERIMENTS.value, SectionRole.APPENDIX.value}
)
# Leaf prefixes of the parse anchors (D4) that are measurements in themselves.
MEASURING_LEAVES = ("t", "f")

_SPACE = re.compile(r"\s+")
_LEAF_PREFIX = re.compile(r"^([a-z]+)[0-9]+$")


def normalised(text: str) -> str:
    """The claim text as its identity sees it: case and spacing do not make a new claim."""
    return _SPACE.sub(" ", text).strip().lower()


def claim_id(document_id: uuid.UUID, text: str) -> uuid.UUID:
    """The stable id of a claim of `document_id` (see the module docstring)."""
    return uuid.uuid5(NAMESPACE, f"claim:{document_id}:{normalised(text)}")


def unit_roles(inputs: Mapping[str, Any]) -> dict[str, str | None]:
    """Unit anchor → role, from `inputs.unit_distillations`."""
    items = inputs.get("unit_distillations") or []
    return {i["anchor"]: i.get("role") for i in items if isinstance(i, dict) and "anchor" in i}


def unit_of_anchor(anchor: str, units: Collection[str]) -> str | None:
    """The unit an anchor lives in (its first segment, when that is a unit)."""
    top = anchor.split("/", 1)[0]
    return top if top in units else None


def claim_unit(cites: Iterable[str], units: Collection[str]) -> str | None:
    """The unit a claim belongs to: that of its first cite inside a unit, else None (a
    claim resting on the abstract alone)."""
    return next((u for c in cites if (u := unit_of_anchor(c, units)) is not None), None)


def is_measurement(anchor: str, roles: Mapping[str, str | None]) -> bool:
    """A table, a figure, or any passage of a results / experiments unit."""
    leaf = _LEAF_PREFIX.match(anchor.rsplit("/", 1)[-1])
    if leaf is not None and leaf.group(1) in MEASURING_LEAVES:
        return True
    unit = unit_of_anchor(anchor, roles)
    return unit is not None and roles.get(unit) in MEASURING_ROLES


def check_claims(output: dict[str, Any], selection: Selection) -> list[str]:
    """Cross-field problems of an `extract-claims` output, phrased for the retry."""
    roles = unit_roles(selection.inputs)
    problems: list[str] = []
    keys: set[str] = set()
    texts: dict[str, str] = {}
    for claim in output["claims"]:
        key = claim["key"]
        if key in keys:
            problems.append(f"claims: key {key} is used twice; keys must be unique (C1, C2, …)")
        keys.add(key)
        same = texts.setdefault(normalised(claim["text"]), key)
        if same != key:
            problems.append(f"claims: {key} repeats {same} word for word; merge them")
        if not claim["cites"]:
            problems.append(f"claims: {key} cites nothing; cite the passages it rests on")
        elif claim["strength"] == ClaimStrength.MEASURED.value and not any(
            is_measurement(c, roles) for c in claim["cites"]
        ):
            problems.append(
                f"claims: {key} is measured but cites no measurement; cite the results, "
                "experiments or appendix passage, table or figure that shows it, or grade it argued"
            )
    return problems
