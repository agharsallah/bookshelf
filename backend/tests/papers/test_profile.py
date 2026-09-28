"""The paper pipeline profile (docs/PAPERS.md §3): the orchestrator's rules for a paper.

Book behaviour is covered by tests/pipeline/runtime/test_orchestrator.py, unchanged; here a
paper runs through the same entry points (`on_job_done`, `on_review`, `on_document_parsed`).
"""

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job
from app.models.enums import (
    ArtifactType,
    DocumentStatus,
    Genre,
    JobKind,
    JobState,
    Review,
)
from app.papers import profile
from app.papers.profile import PAPER_DERIVES, Derive
from app.pipeline import orchestrator
from app.pipeline.skills import load_catalogue
from tests.papers.paper_fixtures import UNITS, add_paper, store, without_elements
from tests.pipeline.runtime.conftest import BOOK, add_document, add_nodes


def queued(session: Session) -> set[tuple[JobKind, str | None, str | None]]:
    rows = session.exec(select(Job).where(Job.state == JobState.QUEUED)).all()
    return {(j.kind, j.anchor, j.skill) for j in rows}


def done(session: Session, doc: Document, kind: JobKind, anchor: str | None = None,
         state: JobState = JobState.DONE, **result) -> Job:  # fmt: skip
    job = queue.enqueue(session, JobSpec(kind=kind, document_id=doc.id, anchor=anchor))
    assert job is not None
    if state is JobState.FAILED:
        queue.fail(session, job, "boom", retry=False)
    else:
        queue.complete(session, job, state=state, result=result or None)
    return job


def status(session: Session, doc: Document) -> DocumentStatus:
    session.refresh(doc)
    return doc.status


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session)


def test_a_book_keeps_the_book_rules_and_a_paper_gets_the_profile(session, paper):
    book = add_document(session, slug="meadows-systems")

    assert orchestrator.rules_for(book) is orchestrator.BOOK_RULES
    assert orchestrator.rules_for(paper) is profile.RULES


def test_a_parsed_paper_is_structured_first_and_gets_no_book_stages(session, paper):
    orchestrator.on_job_done(session, done(session, paper, JobKind.PARSE))

    assert queued(session) == {(JobKind.PAPER_STRUCTURE, None, None)}
    assert status(session, paper) is DocumentStatus.PARSED


def test_a_confirmed_outline_starts_a_paper_with_structure(session, paper):
    enqueued = orchestrator.on_document_parsed(session, paper)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.PAPER_STRUCTURE, None)]


def test_structure_queues_element_jobs_and_enrichment_but_no_summaries(session, paper):
    orchestrator.on_job_done(session, done(session, paper, JobKind.PAPER_STRUCTURE))

    assert queued(session) == {
        (JobKind.PAPER_ENRICH, None, None),
        (JobKind.DESCRIBE_MATH, "ch02/s01/m001", None),
        (JobKind.DESCRIBE_FIGURE, "ch02/s01/f001", None),
        (JobKind.EXPLAIN_TABLE, "ch03/t001", None),
    }
    assert status(session, paper) is DocumentStatus.ENRICHING


def test_without_elements_every_unit_but_the_abstract_and_references_is_distilled(session):
    paper = add_paper(session, nodes=without_elements())

    orchestrator.on_job_done(session, done(session, paper, JobKind.PAPER_STRUCTURE))

    assert queued(session) == {
        (JobKind.PAPER_ENRICH, None, None),
        *((JobKind.DISTIL_PAPER_SECTION, unit, None) for unit in UNITS),
    }
    assert status(session, paper) is DocumentStatus.DISTILLING


def test_a_failed_structure_job_advances_nothing(session, paper):
    job = done(session, paper, JobKind.PAPER_STRUCTURE, state=JobState.FAILED)

    assert orchestrator.on_job_done(session, job) == []


def test_units_wait_for_the_last_element_job_even_a_failed_one(session, paper):
    queue.enqueue(session, JobSpec(kind=JobKind.DESCRIBE_MATH, document_id=paper.id,
                                   anchor="ch02/s01/m001"))  # fmt: skip
    first = done(session, paper, JobKind.DESCRIBE_FIGURE, "ch02/s01/f001")
    assert orchestrator.on_job_done(session, first) == []

    for job in session.exec(select(Job).where(Job.state == JobState.QUEUED)).all():
        queue.fail(session, job, "boom", retry=False)
        enqueued = orchestrator.on_job_done(session, job)

    assert {(j.kind, j.anchor) for j in enqueued} == {
        (JobKind.DISTIL_PAPER_SECTION, unit) for unit in UNITS
    }
    assert status(session, paper) is DocumentStatus.DISTILLING


def test_the_card_waits_for_every_unit_distillation(session, paper):
    for unit in UNITS[:-1]:
        store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit)
        job = done(session, paper, JobKind.DISTIL_PAPER_SECTION, unit)
        assert orchestrator.on_job_done(session, job) == []

    store(session, paper, ArtifactType.CHAPTER_DISTILLATION, UNITS[-1])
    last = done(session, paper, JobKind.DISTIL_PAPER_SECTION, UNITS[-1], state=JobState.SKIPPED)
    enqueued = orchestrator.on_job_done(session, last)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISSECT_PAPER, None)]


def test_a_corrected_unit_distillation_dissects_the_paper_again(session, paper):
    for unit in UNITS:
        edited = store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit, Review.APPROVED)

    enqueued = orchestrator.on_review(session, edited)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISSECT_PAPER, None)]


def test_approving_the_card_distils_the_paper_and_queues_embed_and_the_derives(session, paper):
    card = store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED)

    enqueued = orchestrator.on_review(session, card)

    found = [(j.kind, j.skill, j.input_hash, j.payload) for j in enqueued]
    assert found[:2] == [
        (JobKind.EMBED, None, None, {}),
        (JobKind.DERIVE, "simplify-paper", "skill:simplify-paper:practitioner",
         {"params": {"level": "practitioner"}}),
    ]  # fmt: skip
    assert [key for _, _, key, _ in found[1:]] == [d.key for d in PAPER_DERIVES]  # all apply
    assert status(session, paper) is DocumentStatus.DISTILLED


def test_a_dissect_run_that_hits_the_approved_card_resumes_indexing(session, paper):
    card = store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED)
    job = done(session, paper, JobKind.DISSECT_PAPER, state=JobState.SKIPPED,
               artifact_id=str(card.id))  # fmt: skip

    enqueued = orchestrator.on_job_done(session, job)

    assert JobKind.EMBED in {j.kind for j in enqueued}
    assert status(session, paper) is DocumentStatus.DISTILLED


def test_a_new_card_waits_for_its_approval(session, paper):
    draft = store(session, paper, ArtifactType.PAPER_CARD, None)
    job = done(session, paper, JobKind.DISSECT_PAPER, artifact_id=str(draft.id))

    assert orchestrator.on_job_done(session, job) == []
    assert status(session, paper) is DocumentStatus.PARSED


def test_an_approved_element_explanation_re_distils_its_unit_only(session, paper):
    formula = store(session, paper, ArtifactType.MATH_DESCRIPTION, "ch02/s01/m001", Review.APPROVED)

    enqueued = orchestrator.on_review(session, formula)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISTIL_PAPER_SECTION, "ch02")]


def test_an_explanation_inside_the_abstract_re_distils_nothing(session, paper):
    explanation = store(session, paper, ArtifactType.FIGURE_DESCRIPTION, "fm01/p001",
                        Review.APPROVED)  # fmt: skip

    assert orchestrator.on_review(session, explanation) == []


def test_an_untagged_paper_distils_every_chapter(session):
    untagged = [(a, k, t, {**m, "role": None}) if "/" not in a else (a, k, t, m)
                for a, k, t, m in without_elements()]  # fmt: skip
    paper = add_paper(session, nodes=untagged)

    enqueued = orchestrator.on_job_done(session, done(session, paper, JobKind.PAPER_STRUCTURE))

    units = {j.anchor for j in enqueued if j.kind is JobKind.DISTIL_PAPER_SECTION}
    assert units == {"fm01", *UNITS}  # the skipped bibliography stays invisible


def test_a_book_never_gets_paper_stages(session):
    book = add_document(session)
    add_nodes(session, book, BOOK)

    orchestrator.on_job_done(session, done(session, book, JobKind.PARSE))

    kinds = {kind for kind, _, _ in queued(session)} - {JobKind.PARSE}
    assert kinds == {JobKind.DESCRIBE_FIGURE, JobKind.EXPLAIN_CODE, JobKind.SUMMARIZE}


# --- The derive set is data ----------------------------------------------------------------


def test_an_appended_derive_is_queued_on_card_approval(session, paper, monkeypatch):
    extra = Derive("an-appended-skill")
    monkeypatch.setattr(profile, "PAPER_DERIVES", [*PAPER_DERIVES, extra])
    card = store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED)

    enqueued = orchestrator.on_review(session, card)

    derives = [(j.skill, j.input_hash) for j in enqueued if j.kind is JobKind.DERIVE]
    assert derives[0] == ("simplify-paper", "skill:simplify-paper:practitioner")
    assert derives[-1] == ("an-appended-skill", "skill:an-appended-skill")


def test_a_derive_whose_condition_fails_is_not_queued(session):
    no_math = add_paper(session, nodes=without_elements())
    card = store(session, no_math, ArtifactType.PAPER_CARD, None, Review.APPROVED)

    enqueued = orchestrator.on_review(session, card)

    skills = {j.skill for j in enqueued if j.kind is JobKind.DERIVE}
    assert "make-journal-club" in skills
    assert "make-notation" not in skills  # no formula, no notation table
    assert "explain-math" not in skills  # nor maths to explain


@pytest.mark.parametrize(
    "kind",
    [ArtifactType.PAPER_REVIEW, ArtifactType.PAPER_ASSESSMENT, ArtifactType.NOTATION_TABLE,
     ArtifactType.JOURNAL_CLUB, ArtifactType.PAPER_EXPLAINER, ArtifactType.MATH_EXPLAINER],
)  # fmt: skip
def test_approving_a_by_product_of_an_indexed_paper_reindexes_it(session, kind):
    paper = add_paper(session, status=DocumentStatus.INDEXED)
    approved = store(session, paper, kind, None, Review.APPROVED)

    enqueued = orchestrator.on_review(session, approved)

    assert [j.kind for j in enqueued] == [JobKind.EMBED]


@pytest.mark.parametrize("derive", PAPER_DERIVES, ids=lambda d: d.key)
def test_each_derive_matches_its_skill_package(derive: Derive):
    """A derive names a document-scope paper skill; its params resolve, and its key is the
    one `POST /jobs` builds for the same run, so a manual run and the pipeline dedupe."""
    skill = load_catalogue(get_settings().skills_dir)[derive.skill]

    assert skill.meta.job_kind is JobKind.DERIVE
    assert skill.meta.scope == "document"
    assert skill.meta.genre is Genre.PAPER
    params = skill.meta.resolve_params(derive.params)
    assert skill.meta.variant_of(params) == derive.variant
