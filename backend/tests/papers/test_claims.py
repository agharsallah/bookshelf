"""Claims as first-class atoms (docs/PAPERS.md P4, P5): the extract-claims contract and its
gates, and the projection of the approved claim_set into `claims` rows."""

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Claim, Document, Edge, Job
from app.models.enums import (
    ArtifactType,
    ClaimKind,
    ClaimStrength,
    DocumentStatus,
    EdgeStatus,
    EntityKind,
    JobKind,
    JobState,
    Relation,
)
from app.papers import materialize
from app.papers.claims import check_claims, claim_id, is_measurement
from app.pipeline import authoring, gates
from app.pipeline.execution import execute_skill_job, prepare
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import load_catalogue
from tests.papers.claim_fixtures import (
    ATTENTION,
    PARALLEL,
    RECURRENT,
    approve_claims,
    claim,
    claim_set,
    claims_of,
    two_papers,
)
from tests.papers.paper_fixtures import UNITS, add_paper, store
from tests.pipeline.runtime.conftest import body, paragraph

SKILLS_DIR = get_settings().skills_dir
SKILL = load_catalogue(SKILLS_DIR)["extract-claims"]


@pytest.fixture
def paper(session: Session) -> Document:
    doc = add_paper(session)
    for unit in UNITS:
        store(session, doc, ArtifactType.CHAPTER_DISTILLATION, unit,
              content=body(paragraph(f"{unit} distilled", f"{unit}/p001")))  # fmt: skip
    return doc


def problems(session: Session, paper: Document, output: dict[str, Any]) -> list[str]:
    prepared = prepare(session, SKILL, paper, None)
    return check_claims(output, prepared.selection)


# --- The contract ----------------------------------------------------------------------


def test_claim_vocabularies_match_the_enums():
    item = SKILL.schema["properties"]["claims"]["items"]["properties"]
    assert item["kind"]["enum"] == [k.value for k in ClaimKind]
    assert item["strength"]["enum"] == [s.value for s in ClaimStrength]


def test_the_schema_refuses_an_uncited_claim_and_a_malformed_key():
    uncited = claim_set({**claim("C1", ATTENTION), "cites": []})
    bad_key = claim_set(claim("claim-1", ATTENTION))
    assert any("cites" in p for p in gates.schema_errors(SKILL.schema, uncited))
    assert any("key" in p for p in gates.schema_errors(SKILL.schema, bad_key))


def test_the_paper_claims_selector_offers_units_roles_and_the_card(session, paper):
    prepared = prepare(session, SKILL, paper, None)
    inputs = prepared.selection.inputs
    assert [u["role"] for u in inputs["unit_distillations"]] == [
        "introduction", "method", "results",
    ]  # fmt: skip
    assert inputs["paper_card"] is None
    assert prepared.selection.chapters == tuple(UNITS)


# --- Gates -----------------------------------------------------------------------------


def test_a_measured_claim_must_cite_a_results_passage_a_table_or_a_figure(session, paper):
    intro_only = claim_set(claim("C1", ATTENTION, "measured", "ch01/p001"))
    assert problems(session, paper, intro_only) == [
        "claims: C1 is measured but cites no measurement; cite the results, experiments or "
        "appendix passage, table or figure that shows it, or grade it argued"
    ]
    for cites in (["ch03/p001"], ["ch03/t001"], ["ch02/s01/f001"]):
        ok = claim_set(claim("C1", ATTENTION, "measured", *cites))
        assert problems(session, paper, ok) == [], cites
    argued = claim_set(claim("C1", PARALLEL, "argued", "ch01/p002"))
    assert problems(session, paper, argued) == []


def test_an_appendix_passage_measures_but_a_method_passage_does_not():
    # Papers move extra ablations to an appendix (BERT's Appendix C): a measured claim may
    # cite them there.
    roles = {"ch02": "method", "ch09": "appendix", "ch03": "results"}

    assert is_measurement("ch09/s02/p001", roles)
    assert is_measurement("ch03/p004", roles)
    assert not is_measurement("ch02/s01/p001", roles)


def test_keys_and_texts_are_unique(session, paper):
    output = claim_set(
        claim("C1", ATTENTION), claim("C1", RECURRENT), claim("C3", ATTENTION.upper())
    )
    found = problems(session, paper, output)
    assert "claims: key C1 is used twice; keys must be unique (C1, C2, …)" in found
    assert "claims: C3 repeats C1 word for word; merge them" in found


def test_a_batch_run_retries_a_bad_strength_and_stores_the_claim_set(session, paper):
    bad = claim_set(claim("C1", ATTENTION, "measured", "ch01/p001"))
    good = claim_set(claim("C1", ATTENTION, "measured", "ch03/t001"),
                     claim("C2", PARALLEL, "argued", "ch01/p002"))  # fmt: skip
    job = queue.enqueue(
        session, JobSpec(kind=JobKind.DERIVE, document_id=paper.id, skill="extract-claims")
    )
    assert job is not None
    runner = FakeRunner(json.dumps(bad), json.dumps(good))

    outcome = execute_skill_job(
        session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/m")
    )

    assert outcome.state is JobState.DONE, outcome.result
    assert len(runner.calls) == 2 and "cites no measurement" in runner.calls[1]["prompt"]
    artifact = session.get(Artifact, outcome.result["artifact_id"])
    assert artifact is not None and artifact.type is ArtifactType.CLAIM_SET
    assert artifact.gates["grounding"] == 1.0


# --- Materialization -------------------------------------------------------------------


def test_approving_a_claim_set_materializes_its_claims_and_queues_relate(session):
    a, _ = two_papers(session)

    rows = claims_of(session, a)
    assert set(rows) == {ATTENTION, PARALLEL}
    attention = rows[ATTENTION]
    assert attention.id == claim_id(a.id, ATTENTION)
    assert (attention.key, attention.kind, attention.strength) == (
        "C1", ClaimKind.RESULT, ClaimStrength.MEASURED
    )  # fmt: skip
    assert (attention.evidence, attention.unit) == (["ch03/p001", "ch03/t001"], "ch03")
    assert rows[PARALLEL].unit == "ch01"
    kinds = session.exec(select(Job.kind).where(Job.document_id == a.id)).all()
    assert JobKind.RELATE_CLAIMS in kinds
    assert JobKind.EMBED not in kinds  # not indexed yet: the card's embed picks claims up


def test_materializing_twice_changes_nothing(session):
    a, _ = two_papers(session)
    before = {c.id: c.key for c in claims_of(session, a).values()}

    synced = materialize.sync_claims(session, a)

    assert not synced.changed
    assert {c.id: c.key for c in claims_of(session, a).values()} == before
    assert materialize.materialize_claims(session, a) == []


def test_a_new_version_keeps_surviving_claims_and_drops_the_rest_with_their_edges(session):
    a, b = two_papers(session)
    kept, dropped = claims_of(session, a)[ATTENTION], claims_of(session, a)[PARALLEL]
    other = claims_of(session, b)[RECURRENT]
    session.add(Edge(src_kind=EntityKind.CLAIM, src_id=str(dropped.id),
                     dst_kind=EntityKind.CLAIM, dst_id=str(other.id),
                     relation=Relation.SUPPORTS, origin="human"))  # fmt: skip
    session.add(Edge(src_kind=EntityKind.CLAIM, src_id=str(kept.id), dst_kind=EntityKind.CLAIM,
                     dst_id=str(other.id), relation=Relation.CONTRADICTS, origin="human",
                     status=EdgeStatus.ACCEPTED))  # fmt: skip
    session.commit()

    v2 = approve_claims(
        session, a,
        claim_set(claim("C1", "Attention needs no recurrence.", "argued", "ch02/p001"),
                  claim("C2", ATTENTION, "measured", "ch03/t001")),
        version=2,
    )  # fmt: skip

    rows = claims_of(session, a)
    assert set(rows) == {ATTENTION, "Attention needs no recurrence."}
    survivor = rows[ATTENTION]
    assert (survivor.id, survivor.key, survivor.evidence) == (kept.id, "C2", ["ch03/t001"])
    assert survivor.artifact_id == v2.id
    edges = session.exec(select(Edge)).all()
    assert [(e.src_id, e.relation) for e in edges] == [(str(kept.id), Relation.CONTRADICTS)]


def test_approving_a_changed_claim_set_logs_its_counts_at_info(session, caplog):
    """Regression: the log once passed `created` in `extra`, which clashes with
    LogRecord.created, so every approval with changes failed whenever INFO was on."""
    a, _ = two_papers(session)
    caplog.set_level(logging.INFO, logger=materialize.__name__)

    # ATTENTION changes key (updated), a new claim appears (created), PARALLEL goes (removed).
    updated = claim("C2", ATTENTION, "measured", "ch03/p001", "ch03/t001")
    created = claim("C1", "Attention needs no recurrence.", "argued", "ch02/p001")
    approve_claims(session, a, claim_set(updated, created), version=2)

    [record] = [r for r in caplog.records if r.getMessage() == "Claims materialized"]
    assert record.levelno == logging.INFO
    counts = (record.claims_created, record.claims_updated, record.claims_removed)  # type: ignore[attr-defined]
    assert counts == (1, 1, 1)
    assert record.document_id == str(a.id)  # type: ignore[attr-defined]


def test_reopening_the_latest_falls_back_to_the_previous_approved_version(session):
    a, _ = two_papers(session)
    v2 = approve_claims(session, a, claim_set(claim("C1", RECURRENT.replace("24.6", "25.0"))),
                        version=2)  # fmt: skip
    assert len(claims_of(session, a)) == 1

    authoring.review(session, v2, "reopen")

    assert set(claims_of(session, a)) == {ATTENTION, PARALLEL}


def test_rejecting_the_only_approved_version_withdraws_its_claims(session):
    a, _ = two_papers(session)
    artifact = session.exec(
        select(Artifact).where(Artifact.document_id == a.id, Artifact.type == "claim_set")
    ).one()

    authoring.review(session, artifact, "reject")

    assert claims_of(session, a) == {}


def test_an_indexed_paper_re_embeds_when_its_claims_change(session):
    a, _ = two_papers(session, status=DocumentStatus.INDEXED)
    embeds = session.exec(
        select(Job).where(Job.document_id == a.id, Job.kind == JobKind.EMBED)
    ).all()
    assert len(embeds) == 1


def test_a_human_edit_is_materialized_too(session):
    a, _ = two_papers(session)
    artifact = session.exec(
        select(Artifact).where(Artifact.document_id == a.id, Artifact.type == "claim_set")
    ).one()

    authoring.review(session, artifact, "edit", body=claim_set(claim("C1", ATTENTION)))

    assert set(claims_of(session, a)) == {ATTENTION}
    assert session.exec(select(Claim).where(Claim.document_id == a.id)).one().key == "C1"


def test_a_human_edit_repeating_a_key_keeps_the_first_claim(session):
    """Regression: `unique (artifact_id, key)` made a hand-edited set with two `C1`s fail
    its approval with an IntegrityError."""
    a, _ = two_papers(session)
    artifact = session.exec(
        select(Artifact).where(Artifact.document_id == a.id, Artifact.type == "claim_set")
    ).one()

    authoring.review(
        session, artifact, "edit", body=claim_set(claim("C1", ATTENTION), claim("C1", PARALLEL))
    )

    assert set(claims_of(session, a)) == {ATTENTION}
