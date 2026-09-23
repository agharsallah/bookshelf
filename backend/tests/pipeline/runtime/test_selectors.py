"""Named selectors: the exact input envelope each skill receives."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.models import Artifact, Document
from app.models.enums import ArtifactType, Origin, Review
from app.pipeline.hashing import input_hash
from app.pipeline.selectors import SelectorError, select_inputs
from tests.pipeline.runtime.conftest import add_document, body, paragraph, span


def store(session: Session, doc: Document, kind: ArtifactType, anchor: str, version: int = 1, *,
          review: Review = Review.DRAFT, **extra) -> Artifact:  # fmt: skip
    artifact = Artifact(
        document_id=doc.id, anchor=anchor, type=kind, version=version, origin=Origin.SKILL,
        skill="test", skill_version="1", input_hash=f"{kind}-{anchor}-{version}",
        body=body(paragraph(f"{kind} v{version}", anchor), **extra), review=review,
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact


def select(session: Session, selector: str, doc: Document, anchor: str | None, **kw):
    return select_inputs(session, selector, doc, anchor, media_dir=Path("/media"), **kw)


def test_scope_blocks_lists_leaves_in_reading_order_with_the_envelope(session, book):
    selection = select(session, "scope_blocks", book, "ch01")

    assert selection.inputs["document"] == {
        "slug": "meadows-systems", "title": "Meadows Systems", "authors": ["Donella Meadows"],
        "year": 2008,
    }  # fmt: skip
    assert selection.inputs["scope"] == {
        "anchor": "ch01", "kind": "chapter", "heading": "Stocks and flows", "page_from": 1,
        "page_to": 1,
    }  # fmt: skip
    assert [b["anchor"] for b in selection.inputs["blocks"]] == [
        "ch01/s01/p001", "ch01/s01/f001", "ch01/s02/p001",
    ]  # fmt: skip
    assert selection.source_words == 10 + 5 + 8  # "Figure 1.1 A bathtub" is 5 tokens


def test_skipped_containers_are_invisible(session, book):
    whole = select(session, "scope_blocks", book, None)

    assert "bm01/p001" not in [b["anchor"] for b in whole.inputs["blocks"]]
    with pytest.raises(SelectorError, match="skipped container"):
        select(session, "scope_blocks", book, "bm01")


def test_figures_prefer_approved_and_exclude_unapproved_low_confidence(session, book):
    fig = ArtifactType.FIGURE_DESCRIPTION
    store(session, book, fig, "ch01/s01/f001", 1, review=Review.APPROVED, takeaway=span("t1"))
    store(session, book, fig, "ch01/s01/f001", 2, takeaway=span("t2"))  # newer draft
    store(session, book, ArtifactType.CODE_EXPLANATION, "ch02/c001", confidence="low")

    chapter1 = select(session, "scope_blocks", book, "ch01").inputs["figures"]
    chapter2 = select(session, "scope_blocks", book, "ch02").inputs["figures"]

    assert [(f["anchor"], f["takeaway"]) for f in chapter1] == [("ch01/s01/f001", span("t1"))]
    assert chapter2 == []


def test_element_context_carries_neighbours_and_the_image(session, book):
    selection = select(session, "element_context", book, "ch01/s01/f001")

    assert selection.inputs["element"]["image_path"] == "f001.png"  # media-relative (hashed)
    assert selection.images == (Path("/media/f001.png"),)
    assert [b["anchor"] for b in selection.inputs["context"]] == [
        "ch01/s01/p001", "ch01/s02/p001", "ch02/p001",
    ]  # fmt: skip


def test_chapter_section_notes_use_the_preferred_note_per_section(session, book):
    note = ArtifactType.SECTION_NOTE
    store(session, book, note, "ch01/s01", 1)
    store(session, book, note, "ch01/s01", 2, review=Review.REJECTED)
    store(session, book, note, "ch01/s02", 1, review=Review.APPROVED)

    notes = select(session, "chapter_section_notes", book, "ch01").inputs["section_notes"]

    assert [(n["anchor"], n["heading"]) for n in notes] == [
        ("ch01/s01", "Stocks"),
        ("ch01/s02", "Flows"),
    ]
    assert notes[0]["body"] == body(paragraph("section_note v1", "ch01/s01"))


def test_selectors_refuse_scopes_with_nothing_to_read_yet(session, book):
    with pytest.raises(SelectorError, match="no section notes yet"):
        select(session, "chapter_section_notes", book, "ch01")
    with pytest.raises(SelectorError, match="no chapter distillations yet"):
        select(session, "document_chapters", book, None)


def test_document_chapters_includes_other_books_theses(session, book):
    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch02")
    other = add_document(session, slug="senge-fifth")
    brief = {
        "sections": [{"key": "thesis", "title": "Thesis", "blocks": [paragraph("Learn.", "x1")]}]
    }
    session.add(Artifact(document_id=other.id, type=ArtifactType.BOOK_BRIEF, version=1,
                         origin=Origin.HUMAN, input_hash="h", body=brief))  # fmt: skip
    session.commit()

    inputs = select(session, "document_chapters", book, None).inputs

    assert [c["anchor"] for c in inputs["chapter_distillations"]] == ["ch02"]
    assert [(s["slug"], s["thesis"]) for s in inputs["shelf"]] == [("senge-fifth", "Learn.")]
    assert inputs["existing_concepts"] == []


def test_same_state_gives_the_same_hash_and_new_input_changes_it(session, book):
    first = select(session, "scope_blocks", book, "ch01/s01").inputs
    again = select(session, "scope_blocks", book, "ch01/s01").inputs
    store(session, book, ArtifactType.FIGURE_DESCRIPTION, "ch01/s01/f001", confidence="high")
    enriched = select(session, "scope_blocks", book, "ch01/s01").inputs

    assert input_hash("s", "1", first) == input_hash("s", "1", again)
    assert input_hash("s", "1", first) != input_hash("s", "1", enriched)
