"""Chapter intro paragraphs: leaves directly under a chapter that also has sections.

They get a section note of their own on the chapter's anchor (rank isolation: it sees only
the intro), and that note feeds the chapter distillation with the sections' notes.
"""

from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, JobKind, JobState, NodeKind, Origin
from app.pipeline import orchestrator
from app.pipeline.execution import prepare
from app.pipeline.skills import load_catalogue
from app.pipeline.tree import Tree
from tests.pipeline.runtime.conftest import add_document, add_nodes, body, paragraph

INTRO_BOOK = [
    ("ch01", NodeKind.CHAPTER, "Stocks and flows", {}),
    ("ch01/p001", NodeKind.PARAGRAPH, "This chapter introduces the bathtub.", {}),
    ("ch01/s01", NodeKind.SECTION, "Stocks", {}),
    ("ch01/s01/p001", NodeKind.PARAGRAPH, "A stock is the memory of flows.", {}),
    ("ch01/s02", NodeKind.SECTION, "Flows", {}),
    ("ch01/s02/p001", NodeKind.PARAGRAPH, "Flows change stocks over time.", {}),
]


@pytest.fixture
def intro_book(session: Session) -> Document:
    doc = add_document(session, slug="intro-book")
    add_nodes(session, doc, INTRO_BOOK)
    return doc


def blocks_of(session, doc, skills_dir: Path, skill: str, anchor: str) -> list[str]:
    package = load_catalogue(skills_dir)[skill]
    inputs = prepare(session, package, doc, anchor, media_dir=Path("/media")).selection.inputs
    return [b["anchor"] for b in inputs["blocks"]]


def section_note(session: Session, doc: Document, anchor: str) -> None:
    session.add(Artifact(
        document_id=doc.id, anchor=anchor, type=ArtifactType.SECTION_NOTE, version=1,
        origin=Origin.SKILL, skill="distil-section", skill_version="1",
        input_hash=f"note-{anchor}", body=body(paragraph("x", f"{anchor}/p001")),
    ))  # fmt: skip
    session.commit()


def finished_section(session: Session, doc: Document, anchor: str) -> list[Job]:
    job = session.exec(
        select(Job).where(Job.kind == JobKind.DISTIL_SECTION, Job.anchor == anchor)
    ).one()
    queue.complete(session, job)
    return orchestrator.on_job_done(session, job)


def test_the_intro_is_a_section_scope_on_the_chapter_anchor(session, intro_book):
    tree = Tree.load(session, intro_book)
    chapter = tree.by_anchor["ch01"]

    assert [s.anchor for s in tree.section_scopes(chapter)] == ["ch01", "ch01/s01", "ch01/s02"]
    assert tree.scope_of(tree.by_anchor["ch01/p001"]) is chapter
    assert tree.scope_of(tree.by_anchor["ch01/s02/p001"]) is tree.by_anchor["ch01/s02"]


def test_the_intro_note_sees_only_the_intro_but_the_summary_sees_everything(
    session, intro_book, skills_dir
):
    assert blocks_of(session, intro_book, skills_dir, "distil-section", "ch01") == ["ch01/p001"]
    assert blocks_of(session, intro_book, skills_dir, "summarize", "ch01") == [
        "ch01/p001", "ch01/s01/p001", "ch01/s02/p001",
    ]  # fmt: skip


def test_the_chapter_waits_for_the_intro_note_and_then_reads_it_first(
    session, intro_book, skills_dir
):
    orchestrator.on_document_parsed(session, intro_book)
    sections = session.exec(select(Job).where(Job.kind == JobKind.DISTIL_SECTION)).all()
    assert sorted(j.anchor or "" for j in sections) == ["ch01", "ch01/s01", "ch01/s02"]
    for anchor in ("ch01/s01", "ch01/s02"):
        section_note(session, intro_book, anchor)
    assert finished_section(session, intro_book, "ch01/s02") == []

    section_note(session, intro_book, "ch01")
    [chapter_job] = finished_section(session, intro_book, "ch01")

    assert (chapter_job.kind, chapter_job.anchor, chapter_job.state) == (
        JobKind.DISTIL_CHAPTER, "ch01", JobState.QUEUED,
    )  # fmt: skip
    package = load_catalogue(skills_dir)["distil-chapter"]
    notes = prepare(session, package, intro_book, "ch01").selection.inputs["section_notes"]
    assert [n["anchor"] for n in notes] == ["ch01", "ch01/s01", "ch01/s02"]
