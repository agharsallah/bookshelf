"""The `auto_approve` setting: a skill's fresh artifact approved on arrival, or not."""

import pytest

from app.models.enums import JobKind, Review
from app.pipeline.runner import FakeRunner
from app.services import app_settings
from tests.pipeline.runtime.conftest import body, paragraph, reply
from tests.pipeline.runtime.test_execution import GROUNDED, artifacts_of, run

FLAGGED = reply(body(paragraph("cited", "ch01/s01/p001"), paragraph("made up")))


@pytest.mark.parametrize(
    ("mode", "output", "expected"),
    [
        ("off", GROUNDED, Review.DRAFT),
        ("passing", GROUNDED, Review.APPROVED),
        ("passing", FLAGGED, Review.NEEDS_REVIEW),
        ("all", FLAGGED, Review.APPROVED),
    ],
)
def test_a_new_artifact_is_approved_only_as_far_as_the_mode_allows(
    session, book, make_job, skills_dir, mode, output, expected
):
    app_settings.set_auto_approve(session, mode)

    outcome = run(
        session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), FakeRunner(output), skills_dir
    )

    (artifact,) = artifacts_of(session, book)
    assert artifact.review is expected
    assert outcome.result["review"] == expected.value
    assert (artifact.reviewed_at is not None) is (expected is Review.APPROVED)


def test_an_auto_approved_artifact_keeps_its_gate_flags(session, book, make_job, skills_dir):
    app_settings.set_auto_approve(session, "all")

    job = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    run(session, job, FakeRunner(FLAGGED), skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert artifact.gates["flags"] == ["grounding_below_min"]


def test_a_new_install_waits_for_a_review(session):
    assert app_settings.auto_approve(session) == "off"
