"""`synthesize_papers`: cites across the set only, one version per changed input, drafts."""

import json
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs.registry import PermanentJobError
from app.models import Claim, Document, Job, PaperSet, PaperSynthesis
from app.models.enums import ArtifactType, ClaimKind, ClaimStrength, JobKind, NodeKind, Review
from app.papers import synthesis
from app.papers.selectors.sets import results_matrix, set_input
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import Skill, load_skill
from tests.api.factories import make_artifact, make_node
from tests.papers.conftest import make_paper


@pytest.fixture
def skill() -> Skill:
    return load_skill(get_settings().skills_dir / synthesis.SKILL_NAME)


def carded(session: Session, title: str, value: float) -> Document:
    """A paper with a card (tldr cites ch01/p001) and one result (cites ch04/t001)."""
    paper = make_paper(session, title)
    make_node(session, paper, "ch01/p001", NodeKind.PARAGRAPH)
    make_node(session, paper, "ch04/t001", NodeKind.TABLE)
    card = {"tldr": [{"text": f"{title} works.", "cites": ["ch01/p001"]}], "question": []}
    make_artifact(session, paper, type=ArtifactType.PAPER_CARD, body=card)
    row = {"method": title, "dataset": "NQ", "metric": "EM", "value": value, "unit": None,
           "higher_is_better": True, "is_proposed": True, "cites": ["ch04/t001"]}  # fmt: skip
    make_artifact(session, paper, type=ArtifactType.RESULTS_TABLE, body={"rows": [row]})
    return paper


def a_set(session: Session) -> tuple[PaperSet, Document, Document]:
    a, b = carded(session, "Gated", 53.4), carded(session, "Light", 51.3)
    paper_set = PaperSet(name="Readers", document_ids=[a.id, b.id])
    session.add(paper_set)
    session.commit()
    return paper_set, a, b


def span(text: str, *cites: str) -> dict[str, Any]:
    return {"text": text, "cites": list(cites)}


def output(a: Document, b: Document, *, extra: str | None = None) -> str:
    cites_b = [f"{b.slug}:ch01/p001"] + ([extra] if extra else [])
    blocks = [
        {"type": "heading", "level": 2, "text": "Gating"},
        {"type": "paragraph", "spans": [span("Both gate.", f"{a.slug}:ch01/p001", *cites_b)]},
    ]
    table = {"type": "table", "header": ["Paper", "EM"], "rows": [
        [span("Gated", f"{a.slug}:ch01/p001"), span("53.4", f"{a.slug}:ch04/t001")],
        [span("Light", f"{b.slug}:ch01/p001"), span("51.3", f"{b.slug}:ch04/t001")],
    ]}  # fmt: skip
    return json.dumps({"blocks": blocks, "table": table})


def test_the_input_qualifies_cites_and_pivots_results(session: Session):
    paper_set, a, b = a_set(session)
    session.add(
        Claim(document_id=a.id, artifact_id=make_artifact(session, a).id, key="C1", text="t",
              kind=ClaimKind.RESULT, strength=ClaimStrength.MEASURED, evidence=["ch04/t001"])
    )  # fmt: skip
    session.commit()

    given = set_input(session, paper_set)

    first, _ = given.inputs["papers"]
    assert first["card"]["tldr"][0]["cites"] == [f"{a.slug}:ch01/p001"]
    assert first["claims"][0]["cites"] == [f"{a.slug}:ch04/t001"]
    assert set(given.valid) == {f"{d.slug}:{x}" for d in (a, b) for x in ("ch01/p001", "ch04/t001")}
    (column,) = given.inputs["comparison"]["columns"]
    assert column == {"dataset": "NQ", "metric": "EM", "higher_is_better": True}
    cells = [r["cells"][0]["value"] for r in given.inputs["comparison"]["rows"]]
    assert cells == [53.4, 51.3]


def test_results_matrix_lines_up_names_case_insensitively():
    rows = [{"method": "X", "dataset": "NQ", "metric": "EM", "value": 1, "cites": ["a:p1"]}]
    other = [{"method": "Y", "dataset": "nq ", "metric": "em", "value": 2, "cites": []}]
    matrix = results_matrix([("a", rows), ("b", other)])
    assert len(matrix["columns"]) == 1
    assert [r["cells"][0]["value"] for r in matrix["rows"]] == [1, 2]


def test_a_synthesis_is_stored_as_a_draft_with_its_citations(session: Session, skill: Skill):
    paper_set, a, b = a_set(session)
    runner = FakeRunner(output(a, b))

    row, ran, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    assert ran and row.version == 1 and row.review == Review.DRAFT
    assert row.origin == f"skill:synthesize-papers@{skill.version}"
    assert set(row.citations) == {
        f"{d.slug}:{x}" for d in (a, b) for x in ("ch01/p001", "ch04/t001")
    }
    assert set(row.body) == {"blocks", "table"}


def test_render_block_slips_are_repaired_before_the_checks(session: Session, skill: Skill):
    # A real run wrote its group headings as `{type: heading, spans: [...]}`; the render
    # contract wants `text`, and the retry repeated the slip. It is repaired, not failed.
    paper_set, a, b = a_set(session)
    slipped = json.loads(output(a, b))
    slipped["blocks"][0] = {"type": "heading", "level": 2, "spans": [span("Gating", "x")]}
    runner = FakeRunner(json.dumps(slipped))

    row, ran, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    assert ran and len(runner.calls) == 1
    assert row.body["blocks"][0] == {"type": "heading", "level": 2, "text": "Gating"}


@pytest.mark.parametrize(
    ("extra", "problem"),
    [
        ("ch01/p001", "cite only"),  # bare anchor: ambiguous across the set
        ("stranger:ch01/p001", "cite only"),  # not a member
        ("{b}:ch09/p009", "cite only"),  # a member, but not a passage the input offered
    ],
)
def test_cites_outside_the_set_are_asked_for_again(
    session: Session, skill: Skill, extra: str, problem: str
):
    paper_set, a, b = a_set(session)
    runner = FakeRunner(output(a, b, extra=extra.format(b=b.slug)), output(a, b))

    row, _, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    assert len(runner.calls) == 2 and problem in runner.calls[1]["prompt"]
    assert all(c.split(":")[0] in {a.slug, b.slug} for c in row.citations)


def test_every_member_must_be_cited_and_bad_blocks_fail_for_good(session: Session, skill: Skill):
    paper_set, a, b = a_set(session)
    only_a = json.loads(output(a, b))
    only_a["blocks"][1]["spans"][0]["cites"] = [f"{a.slug}:ch01/p001"]
    only_a["table"]["rows"] = only_a["table"]["rows"][:1]
    chart = json.loads(output(a, b))
    chart["blocks"].append({"type": "code", "text": "x", "cites": [f"{a.slug}:ch01/p001"]})
    runner = FakeRunner(json.dumps(only_a), json.dumps(chart))

    with pytest.raises(PermanentJobError):
        synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    assert "uncited: " + b.slug in runner.calls[1]["prompt"]
    assert session.exec(select(PaperSynthesis)).first() is None


def test_an_unchanged_input_keeps_its_version_and_a_change_adds_one(session: Session, skill: Skill):
    paper_set, a, b = a_set(session)
    runner = FakeRunner(output(a, b))
    first, _, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    same, ran, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)
    assert (same.id, ran, len(runner.calls)) == (first.id, False, 1)

    forced, ran, _ = synthesis.synthesize(
        session, paper_set, runner=runner, skill=skill, force=True
    )
    assert ran and forced.version == 2

    make_node(session, b, "ch02/p001", NodeKind.PARAGRAPH)
    card = {"tldr": [span("Light, revised.", "ch01/p001", "ch02/p001")], "question": []}
    make_artifact(session, b, type=ArtifactType.PAPER_CARD, body=card, version=2)
    changed, ran, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)
    assert ran and changed.version == 3 and changed.input_hash != first.input_hash


def test_a_rejected_version_does_not_block_a_rerun(session: Session, skill: Skill):
    paper_set, a, b = a_set(session)
    runner = FakeRunner(output(a, b))
    first, _, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)
    first.review = Review.REJECTED
    session.add(first)
    session.commit()

    again, ran, _ = synthesis.synthesize(session, paper_set, runner=runner, skill=skill)

    assert ran and again.version == 2


def test_the_job_refuses_sets_it_cannot_synthesize(session: Session):
    lonely = make_paper(session, "Alone")
    uncarded = make_paper(session, "Bare")
    small = PaperSet(name="one", document_ids=[lonely.id])
    bare = PaperSet(name="bare", document_ids=[lonely.id, uncarded.id])
    session.add_all([small, bare])
    session.commit()
    runner = FakeRunner("{}")
    for paper_set in (small, bare):
        job = Job(kind=JobKind.SYNTHESIZE_PAPERS, payload={"set_id": str(paper_set.id)})
        with pytest.raises(PermanentJobError):
            synthesis.run_synthesis_job(session, job, runner=runner)
    assert runner.calls == []


def test_the_job_reports_its_version(session: Session):
    paper_set, a, b = a_set(session)
    job = Job(kind=JobKind.SYNTHESIZE_PAPERS, payload={"set_id": str(paper_set.id)})

    result = synthesis.run_synthesis_job(session, job, runner=FakeRunner(output(a, b)))

    assert result.result["version"] == 1 and result.result["unchanged"] is False
