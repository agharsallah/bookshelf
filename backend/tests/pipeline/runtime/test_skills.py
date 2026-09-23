"""Skill packages: loading, the batch prompt rendering, and input hashing."""

import json
from pathlib import Path

from app.models.enums import JobKind, Tier
from app.pipeline.hashing import input_hash
from app.pipeline.skills import load_catalogue, render_prompt, skill_for_job_kind
from tests.pipeline.runtime.conftest import SKILL_MD, write_skill


def test_render_strips_frontmatter_and_interactive_section_and_appends_input():
    prompt = render_prompt(SKILL_MD.format(name="distil-section"), {"scope": {"anchor": "ch01"}})

    assert prompt == (
        "## Method\nDistil faithfully.\n\nOutput only the JSON object. No prose, no code fences."
        '\n\n## Input\n\n{\n  "scope": {\n    "anchor": "ch01"\n  }\n}\n'
    )


def test_render_keeps_a_skill_without_frontmatter_intact():
    assert render_prompt("Just do it.", {}) == "Just do it.\n\n## Input\n\n{}\n"


def test_catalogue_loads_valid_packages_and_skips_broken_ones(skills_dir: Path):
    broken = write_skill(skills_dir, "broken", tier="galaxy-brain", scope="chapter", selector="x")
    (skills_dir / ".outbox").mkdir()

    catalogue = load_catalogue(skills_dir)

    assert broken.name not in catalogue
    assert catalogue["distil-chapter"].meta.tier is Tier.DISTIL
    assert catalogue["distil-chapter"].version == "1"
    assert catalogue["parse-outline"].meta.job_kind is None


def test_job_kind_maps_to_its_skill_but_derive_does_not(skills_dir: Path):
    catalogue = load_catalogue(skills_dir)

    assert skill_for_job_kind(catalogue, JobKind.DISTIL_CHAPTER).name == "distil-chapter"
    assert skill_for_job_kind(catalogue, JobKind.DERIVE) is None
    assert skill_for_job_kind(catalogue, JobKind.EMBED) is None


def test_input_hash_ignores_key_order_but_not_content_or_version():
    inputs = {"scope": {"anchor": "ch01", "kind": "chapter"}, "blocks": [1, 2]}
    reordered = json.loads(
        json.dumps({"blocks": [1, 2], "scope": {"kind": "chapter", "anchor": "ch01"}})
    )

    base = input_hash("distil-chapter", "1", inputs)

    assert base == input_hash("distil-chapter", "1", reordered)
    assert base != input_hash("distil-chapter", "2", inputs)
    assert base != input_hash("distil-section", "1", inputs)
    assert base != input_hash("distil-chapter", "1", {**inputs, "blocks": [2, 1]})
    assert len(base) == 64
