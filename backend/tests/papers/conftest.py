"""Fixtures for paper jobs: a fake OpenAlex behind every paper HTTP call, seeded papers."""

import hashlib
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext
from app.models import Document, Job, PaperMeta, PaperRating
from app.models.enums import DocumentKind, Genre, JobKind
from app.papers.http import set_http_client_factory
from app.retrieval.embedding import FakeEmbedder, set_embedder
from tests.papers.fake_openalex import FakeOpenAlex


@pytest.fixture(autouse=True)
def embedder() -> Iterator[FakeEmbedder]:
    """Paper jobs may embed abstracts: never with the real model in tests."""
    fake = FakeEmbedder()
    set_embedder(fake)
    yield fake
    set_embedder(None)


@pytest.fixture
def openalex() -> Iterator[FakeOpenAlex]:
    fake = FakeOpenAlex()
    set_http_client_factory(lambda: httpx.Client(transport=httpx.MockTransport(fake)))
    yield fake
    set_http_client_factory(None)


@pytest.fixture
def papers_dir() -> Iterator[Path]:
    folder = get_settings().library_dir / "papers"
    shutil.rmtree(folder, ignore_errors=True)
    yield folder
    shutil.rmtree(folder, ignore_errors=True)


def make_paper(
    session: Session,
    title: str,
    *,
    stars: int | None = None,
    meta: dict[str, Any] | None = None,
    year: int | None = 2020,
) -> Document:
    token = uuid.uuid4().hex[:8]
    document = Document(
        kind=DocumentKind.PDF,
        slug=f"paper-{token}",
        title=title,
        year=year,
        genre=Genre.PAPER,
        sha256=hashlib.sha256(token.encode()).hexdigest(),
        source_path=f"library/{token}.pdf",
    )
    session.add(document)
    session.flush()
    if meta is not None:
        session.add(PaperMeta(document_id=document.id, **meta))
    if stars is not None:
        session.add(PaperRating(document_id=document.id, stars=stars))
    session.commit()
    session.refresh(document)
    return document


def job_context(session: Session, spec: JobSpec) -> JobContext:
    job = queue.enqueue(session, spec)
    assert job is not None
    return JobContext(session=session, job=job)


def done_watch_job(session: Session, checked: dict[str, str]) -> Job:
    """A finished `paper_watch` run in the job history, as the worker leaves it."""
    from datetime import UTC, datetime

    from app.models.enums import JobState

    job = Job(
        kind=JobKind.PAPER_WATCH,
        state=JobState.DONE,
        result={"checked": checked},
        finished_at=datetime.now(UTC),
        input_hash=uuid.uuid4().hex,
    )
    session.add(job)
    session.commit()
    return job
