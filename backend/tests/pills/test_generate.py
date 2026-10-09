"""When make-pills is queued (`app.pills.generate`): lazily, ranked, within a daily cap."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlmodel import Session, select

from app.core.errors import NotFoundError
from app.models import Document, Job, ModelRun, ReadingPosition
from app.models.enums import ArtifactType, JobKind, JobState, Review, Tier
from app.pills import generate
from app.pills.feed import scope
from app.pills.feed.config import FeedConfig, FeedSources
from app.services import app_settings
from app.services.errors import InvalidInputError
from tests.api.factories import make_artifact
from tests.pills.conftest import make_shelf_book


def distil(session: Session, book: Document, *anchors: str, kind=ArtifactType.CHAPTER_DISTILLATION):
    for anchor in anchors:
        make_artifact(session, book, type=kind, anchor=anchor, body={"blocks": []})


def read(session: Session, book: Document, unit: str, progress: float, minutes_ago: int = 0):
    at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    position = ReadingPosition(
        document_id=book.id, unit=unit, anchor=unit, progress=progress, updated_at=at
    )
    session.add(position)
    session.commit()


def queued(session: Session) -> list[tuple[uuid.UUID | None, str | None]]:
    jobs = session.exec(
        select(Job).where(Job.skill == "make-pills").order_by(Job.created_at, Job.priority)
    ).all()
    return [(j.document_id, j.anchor) for j in jobs]


def top_up(session: Session, config: FeedConfig | None = None, unseen: int = 0) -> list[uuid.UUID]:
    """A top-up over the documents the feed resolves `config` to (the default: the shelf)."""
    documents = scope.resolve(session, config or FeedConfig()).documents
    return generate.top_up(session, list(documents), unseen)


def test_a_full_feed_or_auto_generation_off_queues_nothing(session, book):
    distil(session, book, "ch01", "ch02")

    assert top_up(session, unseen=generate.LOW_WATER) == []
    app_settings.set_pills_settings(session, {"auto_generate": False})
    assert top_up(session) == []
    assert queued(session) == []


def test_chapters_in_progress_go_first_then_the_next_unread(session, book):
    distil(session, book, "ch01", "ch02", "ch03", "ch04", "ch05")
    distil(session, book, "ch02", kind=ArtifactType.PILL_SET)  # composed already
    read(session, book, "ch01", 1.0, minutes_ago=30)  # finished
    read(session, book, "ch03", 0.4)  # in progress (past ch02, which was skipped)

    ids = top_up(session)

    assert len(ids) == 2
    assert queued(session) == [(book.id, "ch03"), (book.id, "ch04")]
    job = session.get(Job, ids[0])
    assert job is not None
    assert (job.kind, job.input_hash, job.payload) == (
        JobKind.DERIVE,
        "skill:make-pills:plain",
        {"params": {"style": "plain"}},
    )


def test_an_unopened_book_starts_at_its_first_chapter_and_rejected_sets_do_not_count(session, book):
    distil(session, book, "ch02", "ch04")
    make_artifact(session, book, type=ArtifactType.PILL_SET, anchor="ch02", review=Review.REJECTED)
    make_artifact(
        session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch01",
        review=Review.REJECTED,
    )  # fmt: skip

    top_up(session)

    assert queued(session) == [(book.id, "ch02"), (book.id, "ch04")]


def test_the_book_read_most_recently_comes_first_and_scope_is_honoured(session, book):
    other = make_shelf_book(session, title="Other", slug="other")
    distil(session, book, "ch01")
    distil(session, other, "ch01")
    read(session, book, "ch01", 0.2, minutes_ago=60)
    read(session, other, "ch01", 0.2, minutes_ago=1)

    top_up(session, unseen=0)
    assert queued(session) == [(other.id, "ch01"), (book.id, "ch01")]

    for job in session.exec(select(Job)).all():
        session.delete(job)
    session.commit()
    config = FeedConfig(sources=FeedSources(documents=[book.slug]))
    top_up(session, config)
    assert queued(session) == [(book.id, "ch01")]


def test_the_daily_cap_counts_every_make_pills_job_of_the_day(session, book):
    distil(session, book, "ch01", "ch02", "ch03", "ch04", "ch05")
    app_settings.set_pills_settings(session, {"max_chapters_per_day": 3})

    assert len(top_up(session)) == 2
    assert len(top_up(session)) == 1  # a third, then the day is spent
    assert top_up(session) == []
    assert [a for _, a in queued(session)] == ["ch01", "ch02", "ch03"]


def test_a_chapter_tried_today_waits_for_tomorrow(session, book):
    distil(session, book, "ch01", "ch02")
    session.add(
        Job(
            kind=JobKind.DERIVE,
            document_id=book.id,
            anchor="ch01",
            skill="make-pills",
            state=JobState.FAILED,
            payload={},
        )
    )
    session.commit()

    top_up(session)

    assert [a for _, a in queued(session)] == ["ch01", "ch02"]  # the failed one, then ch02


def test_enqueue_queues_named_or_every_open_chapter_with_an_estimate(session, book):
    distil(session, book, "ch01", "ch02", "ch03")
    distil(session, book, "ch03", kind=ArtifactType.PILL_SET)

    ids, estimate = generate.enqueue(session, book.slug, None, "socratic")
    again, _ = generate.enqueue(session, str(book.id), ["ch01"], "socratic")

    jobs = [session.get_one(Job, i) for i in ids]
    assert [j.anchor for j in jobs] == ["ch01", "ch02"]
    assert again == ids[:1]  # still waiting: the same job
    assert estimate is None  # no history yet
    assert jobs[0].input_hash == "skill:make-pills:socratic"


def test_enqueue_refuses_what_it_cannot_run(session, book):
    distil(session, book, "ch01")

    with pytest.raises(InvalidInputError, match="ch02"):
        generate.enqueue(session, book.slug, ["ch01", "ch02"], None)
    with pytest.raises(InvalidInputError, match="style"):
        generate.enqueue(session, book.slug, ["ch01"], "limerick")
    with pytest.raises(NotFoundError):
        generate.enqueue(session, "no-such-book", None, None)
    assert queued(session) == []


def run(session: Session, skill: str, tokens: int, *, job: uuid.UUID, tier=Tier.EXPLORE):
    session.add(
        ModelRun(
            job_id=job,
            kind=JobKind.DERIVE,
            skill=skill,
            tier=tier,
            ok=True,
            input_tokens=tokens,
            output_tokens=0,
            duration_ms=1,
            prompt_chars=1,
        )
    )
    session.commit()


def jobs(session: Session, n: int) -> list[uuid.UUID]:
    made = [Job(kind=JobKind.DERIVE, state=JobState.DONE, payload={}) for _ in range(n)]
    session.add_all(made)
    session.commit()
    return [j.id for j in made]


def test_estimates_average_the_skill_then_its_tier_then_give_up(session):
    assert generate.estimate_tokens(session, "make-pills", 2) is None

    a, b, c = jobs(session, 3)
    run(session, "make-quiz", 4000, job=a)
    run(session, "write-guide", 90000, job=b, tier=Tier.REASON)  # another tier: ignored
    assert generate.estimate_tokens(session, "make-pills", 2) == 8000

    run(session, "make-pills", 1000, job=c)
    run(session, "make-pills", 500, job=c)  # a retry: same job, its tokens add up
    assert generate.estimate_tokens(session, "make-pills", 3) == 4500
    assert generate.estimate_tokens(session, "make-pills", 0) == 0


def test_make_pills_is_never_an_auto_derive_choice():
    from app.core.config import get_settings
    from app.pipeline.skills import load_catalogue

    catalogue = load_catalogue(get_settings().skills_dir)
    assert "make-pills" in catalogue
    for group in app_settings.GROUPS:
        assert "make-pills" not in app_settings.eligible(catalogue, group)
