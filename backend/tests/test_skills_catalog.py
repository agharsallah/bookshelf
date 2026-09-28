"""The skill catalogue (`skills/*/`) honours the package contract in `skills/README.md`.

Pure file checks, no database or model calls: every skill directory must carry a
parseable `meta.yaml` with closed-vocabulary values, a `SKILL.md` that works both as a
Claude Code skill and as a bare batch prompt, a valid 2020-12 `schema.json` that reuses
the render contract, and an `example.json` that satisfies that schema.
"""

import copy
import json
import re
from collections.abc import Callable, Iterator
from functools import cache
from pathlib import Path
from typing import Any

import pytest
import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from app.models.enums import ArtifactType, ConceptKind, Genre, JobKind, Relation, Tier

ROOT = Path(__file__).resolve().parents[2]
SKILLS_DIR = ROOT / "skills"
CONTRACT_PATH = ROOT / "contracts" / "render-blocks.schema.json"
CONTRACT_ID = "https://bookshelf.local/contracts/render-blocks.schema.json"

SCOPES = {"document", "chapter", "section", "block", "note"}
SELECTORS = {
    "outline_pages",
    "element_context",
    "scope_blocks",
    "chapter_section_notes",
    "document_chapters",
    "document_distillations",
    "document_quotes",
    "chapter_distillation",
    "chapter_salience",
    "note_context",
    # Papers (app/papers/selectors/)
    "paper_unit_blocks",
    "paper_distillations",
    "paper_explainer",
    "paper_claims",
    "paper_assessment",
    "paper_review",
    "paper_notation",
    "paper_journal_club",
    "paper_results",
    "paper_citations",
    "paper_concepts",
}
REQUIRED_META = {
    "name",
    "version",
    "description",
    "tier",
    "job_kind",
    "artifact_type",
    "scope",
    "selector",
    "vision",
    "gates",
}
# Jobs Python runs itself; every other JobKind must be backed by at least one skill.
# `grade_recall` runs the grade-recall utility skill inline (app/recall/grading.py).
PYTHON_JOBS = {
    JobKind.PARSE,
    JobKind.EMBED,
    JobKind.EXPORT,
    JobKind.NARRATE,
    JobKind.GRADE_RECALL,
    # Papers (docs/PAPERS.md §3-§5): Python jobs; the last three run a utility skill inline.
    JobKind.PAPER_STRUCTURE,
    JobKind.PAPER_ENRICH,
    JobKind.PAPER_CANDIDATES,
    JobKind.PAPER_WATCH,
    JobKind.PAPER_FETCH,
    JobKind.RELATE_CLAIMS,
    JobKind.RECOMMEND_NEXT,
    JobKind.SYNTHESIZE_PAPERS,
}
# Skill-backed kinds whose skill package is not written yet. The paper-skills stage removes
# each entry as it adds the package (and adds the kind to `SKILL_JOB_KINDS`); keep it empty.
PENDING_SKILL_JOBS: set[JobKind] = set()
OUTPUT_LINE = "Output only the JSON object. No prose, no code fences."
INTERACTIVE = re.compile(r"<!-- interactive:start -->.*?<!-- interactive:end -->\n?", re.S)
FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.S)
SECTIONS = ("## Role", "## Method", "## Hard rules", "## Output")

SKILL_NAMES = sorted(
    p.name for p in SKILLS_DIR.iterdir() if p.is_dir() and not p.name.startswith(("_", "."))
)


def _is_utility(name: str) -> bool:
    """No job and no artifact: Python runs it inline through the `ModelRunner` (README)."""
    meta = yaml.safe_load((SKILLS_DIR / name / "meta.yaml").read_text())
    return meta.get("job_kind") is None and meta.get("artifact_type") is None


UTILITY_SKILLS = [name for name in SKILL_NAMES if _is_utility(name)]
CONTENT_SKILLS = [name for name in SKILL_NAMES if name not in UTILITY_SKILLS]


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    """Override conftest's per-test truncate: these checks never touch the database."""
    yield


@cache
def _registry() -> Registry[Any]:
    contract = json.loads(CONTRACT_PATH.read_text())
    registry: Registry[Any] = Registry().with_resource(
        CONTRACT_ID, Resource.from_contents(contract)
    )
    return registry


def _json(name: str, file: str) -> Any:
    return json.loads((SKILLS_DIR / name / file).read_text())


def _meta(name: str) -> dict[str, Any]:
    meta = yaml.safe_load((SKILLS_DIR / name / "meta.yaml").read_text())
    assert isinstance(meta, dict)
    return meta


def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(_json(name, "schema.json"), registry=_registry())


def _batch_prompt(skill_md: str) -> str:
    """What the batch runner pipes to `claude -p`: frontmatter and interactive part removed."""
    return INTERACTIVE.sub("", FRONTMATTER.sub("", skill_md, count=1))


def test_catalogue_is_not_empty() -> None:
    assert len(SKILL_NAMES) >= 16


def test_every_skill_backed_job_kind_has_a_skill() -> None:
    covered = {_meta(name)["job_kind"] for name in SKILL_NAMES}
    assert set(JobKind) - PYTHON_JOBS - PENDING_SKILL_JOBS <= covered
    assert not covered & PYTHON_JOBS
    assert not covered & PENDING_SKILL_JOBS, "a pending kind now has a skill: drop it"


def test_each_artifact_type_is_produced_by_one_skill_per_genre() -> None:
    """A paper skill may write a book type (distil-paper-section → chapter_distillation):
    `skill_for_artifact_type` picks by genre, so the pair (type, genre) must be unique."""
    produced = [(_meta(n)["artifact_type"], _meta(n).get("genre")) for n in CONTENT_SKILLS]
    assert len(produced) == len(set(produced))
    for name in CONTENT_SKILLS:
        Genre(_meta(name).get("genre") or "book")


def test_paper_skills_that_write_book_types_are_marked_as_paper_skills() -> None:
    by_type: dict[str, list[str]] = {}
    for name in CONTENT_SKILLS:
        by_type.setdefault(_meta(name)["artifact_type"], []).append(name)
    shared = {t: names for t, names in by_type.items() if len(names) > 1}
    assert "chapter_distillation" in shared
    for names in shared.values():
        assert sum(_meta(n).get("genre") is None for n in names) == 1


@pytest.mark.parametrize("name", SKILL_NAMES)
def test_meta_follows_the_contract(name: str) -> None:
    meta = _meta(name)
    assert meta.keys() >= REQUIRED_META
    assert meta["name"] == name
    assert isinstance(meta["version"], int)
    assert meta["version"] >= 1
    assert isinstance(meta["description"], str)
    assert meta["description"].strip()
    Tier(meta["tier"])
    if name not in UTILITY_SKILLS:  # utility skills build their own input, store no artifact
        ArtifactType(meta["artifact_type"])
        assert meta["selector"] in SELECTORS
    if meta["job_kind"] is not None:  # null = interactive-only skill
        assert JobKind(meta["job_kind"]) not in PYTHON_JOBS
    assert meta["scope"] in SCOPES
    assert isinstance(meta["selector"], str)
    assert isinstance(meta["vision"], bool)
    if (book_wide := meta.get("document_selector")) is not None:  # chapter skill, also book-wide
        assert meta["scope"] == "chapter"
        assert book_wide in SELECTORS
        assert 0 < meta["gates"].get("coverage_min", 0) <= 1, "book-wide runs must check coverage"
    if (book_tier := meta.get("document_tier")) is not None:
        assert meta.get("document_selector") is not None
        Tier(book_tier)

    gates = meta["gates"]
    assert 0 <= gates["grounding_min"] <= 1
    if (band := gates.get("compression")) is not None:
        low, high = band
        assert 0 < low < high <= 1
    if (cap := gates.get("max_words")) is not None:
        assert isinstance(cap, int)
        assert cap > 0


@pytest.mark.parametrize("name", SKILL_NAMES)
def test_skill_md_serves_both_entry_points(name: str) -> None:
    text = (SKILLS_DIR / name / "SKILL.md").read_text()

    front = FRONTMATTER.match(text)
    assert front, "SKILL.md must open with YAML frontmatter"
    fm = yaml.safe_load(front.group(1))
    assert fm["name"] == name
    assert fm["description"].strip()
    assert fm["argument-hint"].strip()

    assert text.count("<!-- interactive:start -->") == 1
    assert text.count("<!-- interactive:end -->") == 1
    interactive = INTERACTIVE.search(text)
    assert interactive
    needles = ("$ARGUMENTS", f"/skills/{name}/inputs", "skills/.outbox/", "/artifacts/import")
    for needle in needles[:1] if name in UTILITY_SKILLS else needles:
        assert needle in interactive.group(0)

    prompt = _batch_prompt(text)
    assert prompt.rstrip().endswith(OUTPUT_LINE)
    assert "$ARGUMENTS" not in prompt, "batch prompt must not depend on interactive arguments"
    assert "curl " not in prompt
    positions = [prompt.find(section) for section in SECTIONS]
    assert -1 not in positions, f"missing one of {SECTIONS}"
    assert positions == sorted(positions)


@pytest.mark.parametrize("name", SKILL_NAMES)
def test_schema_is_a_closed_2020_12_schema(name: str) -> None:
    schema = _json(name, "schema.json")
    Draft202012Validator.check_schema(schema)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False


@pytest.mark.parametrize("name", SKILL_NAMES)
def test_example_satisfies_schema(name: str) -> None:
    errors = [e.message for e in _validator(name).iter_errors(_json(name, "example.json"))]
    assert errors == []


@pytest.mark.parametrize("name", SKILL_NAMES)
def test_schema_rejects_unknown_top_level_keys(name: str) -> None:
    example = copy.deepcopy(_json(name, "example.json"))
    example["commentary"] = "models like to add this"
    assert not _validator(name).is_valid(example)


@pytest.mark.parametrize("name", [n for n in CONTENT_SKILLS if n != "parse-outline"])
def test_schema_rejects_invented_anchor_shapes(name: str) -> None:
    """Every content skill routes cites through the contract's anchor pattern."""
    example = _json(name, "example.json")
    raw = json.dumps(example)
    anchors = re.findall(r'"(?:cites|evidence)": \["([^"]+)"', raw)
    assert anchors, "example must cite at least one anchor"
    broken = json.loads(raw.replace(f'"{anchors[0]}"', '"Chapter 3, page 41"', 1))
    assert not _validator(name).is_valid(broken)


def _para(text: str = "x") -> dict[str, Any]:
    return {"type": "paragraph", "spans": [{"text": text, "cites": ["ch01/p001"]}]}


def _swap_brief_sections(out: dict[str, Any]) -> None:
    out["sections"][0], out["sections"][1] = out["sections"][1], out["sections"][0]


def _drop_brief_idea(out: dict[str, Any]) -> None:
    out["sections"][1]["blocks"][0]["items"] = out["sections"][1]["blocks"][0]["items"][:4]


def _guide_map_without_diagram(out: dict[str, Any]) -> None:
    out["sections"][1]["blocks"] = out["sections"][1]["blocks"][1:]


def _guide_unknown_role(out: dict[str, Any]) -> None:
    out["journey"][0]["role"] = "summary"


def _guide_two_themes(out: dict[str, Any]) -> None:
    out["themes"] = out["themes"][:2]


def _guide_long_number(out: dict[str, Any]) -> None:
    out["numbers"][0]["value"] = "about eighty percent of capacity"


def _two_paragraphs(out: dict[str, Any]) -> None:
    out["blocks"] = out["blocks"][:2]


def _append_paragraph(out: dict[str, Any]) -> None:
    out["blocks"].append(_para())


def _second_cite(out: dict[str, Any]) -> None:
    out["blocks"][0]["cites"].append("ch09/p001")


def _two_choices(out: dict[str, Any]) -> None:
    out["items"][0]["choices"] = out["items"][0]["choices"][:2]


def _faq_prose_detail(out: dict[str, Any]) -> None:
    out["items"][-1]["detail"].append(_para())


def _capitalised_concept(out: dict[str, Any]) -> None:
    out["concepts"][0]["canonical"] = "Little's Law"


def _edge_without_evidence(out: dict[str, Any]) -> None:
    out["edges"][0]["evidence"] = []


def _chart_without_data(out: dict[str, Any]) -> None:
    out["blocks"] = [_para()]


def _table_copied_into_explanation(out: dict[str, Any]) -> None:
    out["blocks"].append({"type": "table", "header": ["a"], "rows": [[{"text": "1", "cites": []}]]})


def _mark_two_cites(out: dict[str, Any]) -> None:
    out["marks"][0]["cites"].append("ch03/s01/p002")


def _mark_unknown_tier(out: dict[str, Any]) -> None:
    out["marks"][0]["tier"] = "important"


# Each skill-specific tightening, and a mutation of that skill's example that must break it.
TIGHTENINGS: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
    ("write-brief", _swap_brief_sections),
    ("write-brief", _drop_brief_idea),
    ("write-guide", _swap_brief_sections),
    ("write-guide", _guide_map_without_diagram),
    ("write-guide", _guide_unknown_role),
    ("write-guide", _guide_two_themes),
    ("write-guide", _guide_long_number),
    ("summarize", _two_paragraphs),
    ("extract-quotes", _append_paragraph),
    ("extract-quotes", _second_cite),
    ("make-glossary", _append_paragraph),
    ("make-quiz", _two_choices),
    ("make-faq", _faq_prose_detail),
    ("link-concepts", _capitalised_concept),
    ("link-concepts", _edge_without_evidence),
    ("describe-figure", _chart_without_data),
    ("explain-table", _table_copied_into_explanation),
    ("mark-salience", _mark_two_cites),
    ("mark-salience", _mark_unknown_tier),
]


@pytest.mark.parametrize(
    ("name", "mutate"), TIGHTENINGS, ids=[f"{n}-{m.__name__}" for n, m in TIGHTENINGS]
)
def test_skill_schema_enforces_its_shape(
    name: str, mutate: Callable[[dict[str, Any]], None]
) -> None:
    example = copy.deepcopy(_json(name, "example.json"))
    mutate(example)
    assert not _validator(name).is_valid(example)


def test_link_concepts_vocabularies_match_the_database_enums() -> None:
    props = _json("link-concepts", "schema.json")["properties"]
    kinds = props["concepts"]["items"]["properties"]["kind"]["enum"]
    relations = props["edges"]["items"]["properties"]["relation"]["enum"]
    assert set(kinds) == {k for k in ConceptKind if not k.is_paper_only}
    assert set(relations) == {r for r in Relation if not r.is_derived}
