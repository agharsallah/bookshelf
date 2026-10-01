"""Named selectors: the exact input envelope each skill receives."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.models import Artifact, Document
from app.models.enums import ArtifactType, NodeKind, Origin, Review
from app.pipeline.hashing import input_hash
from app.pipeline.selectors import SelectorError, select_inputs
from tests.pipeline.runtime.conftest import add_document, add_nodes, body, paragraph, span


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


def test_element_context_reaches_past_formula_fragments_to_the_defining_prose(session):
    """A formula MuPDF shattered sits among glyph fragments; the context still reaches the
    paragraph that introduces it and the one that defines its symbols."""
    doc = add_document(session, slug="deepseek-r1")
    intro = "For each question q, GRPO samples a group of outputs from the old policy."
    where = "where A_i is the advantage, computed from a group of rewards for each output."
    rate = "We set the learning rate to 3e-6 and the KL coefficient to 0.001."
    fragments = [(f"ch01/p{n:03}", NodeKind.PARAGRAPH, "i=1", {}) for n in range(2, 5)]
    add_nodes(session, doc, [
        ("ch01", NodeKind.CHAPTER, "GRPO", {}),
        ("ch01/p001", NodeKind.PARAGRAPH, intro, {}),
        *fragments,
        ("ch01/m001", NodeKind.MATH, "πθ(oi|q) Ai, clip", {}),
        ("ch01/q001", NodeKind.QUOTE, "� min", {}),
        ("ch01/p005", NodeKind.PARAGRAPH, where, {}),
        ("ch01/p006", NodeKind.PARAGRAPH, rate, {}),
        ("ch01/p007", NodeKind.PARAGRAPH, "Rewards are the source of the training signal.", {}),
    ])  # fmt: skip

    context = select(session, "element_context", doc, "ch01/m001").inputs["context"]

    assert [b["anchor"] for b in context] == [
        "ch01/p001", "ch01/p002", "ch01/p003", "ch01/p004",
        "ch01/q001", "ch01/p005", "ch01/p006",
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


def test_chapter_salience_offers_the_blocks_and_the_distillation_once_there_is_one(session, book):
    before = select(session, "chapter_salience", book, "ch01")
    assert [b["anchor"] for b in before.inputs["blocks"]] == [
        "ch01/s01/p001", "ch01/s01/f001", "ch01/s02/p001",
    ]  # fmt: skip
    assert before.inputs["distillation"] is None

    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch01", review=Review.APPROVED)
    after = select(session, "chapter_salience", book, "ch01")
    assert (
        after.inputs["distillation"]["blocks"][0]["spans"][0]["text"] == "chapter_distillation v1"
    )
    assert input_hash("s", "1", after.inputs) != input_hash("s", "1", before.inputs)


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


def put(session: Session, doc: Document, kind: ArtifactType, anchor: str | None, value) -> None:
    """Store an artifact with exactly `value` as its body."""
    artifact = Artifact(document_id=doc.id, anchor=anchor, type=kind, version=1,
                        origin=Origin.HUMAN, input_hash=f"{kind}-{anchor}", body=value)  # fmt: skip
    session.add(artifact)
    session.commit()


def test_document_distillations_add_the_books_own_synthesis_but_not_the_shelf(session, book):
    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch01")
    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch02")
    thesis = {"key": "thesis", "title": "Thesis", "blocks": [paragraph("Buffer.", "ch01/s01/p001")]}
    weaknesses = {"key": "weaknesses", "title": "Weaknesses", "blocks": []}
    themes = [{"name": "Delays", "spans": [span("Delays.", "ch01/s02/p001", "ch02/p001")]}]
    put(session, book, ArtifactType.BOOK_BRIEF, None, {"sections": [thesis, weaknesses]})
    put(session, book, ArtifactType.BOOK_GUIDE, None, {"sections": [], "themes": themes})

    inputs = select(session, "document_distillations", book, None).inputs

    assert [c["anchor"] for c in inputs["chapter_distillations"]] == ["ch01", "ch02"]
    assert inputs["book_brief"] == [thesis]
    assert inputs["book_themes"] == themes
    assert "shelf" not in inputs
    assert "existing_concepts" not in inputs


def test_document_distillations_run_before_the_brief_and_guide_exist(session, book):
    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch02")

    inputs = select(session, "document_distillations", book, None).inputs

    assert (inputs["book_brief"], inputs["book_themes"]) == ([], [])


def test_document_quotes_offer_chapter_quotes_and_the_passages_distillations_single_out(
    session, book
):
    distil = ArtifactType.CHAPTER_DISTILLATION
    quote = {"type": "quote", "text": "A stock is the memory", "cites": ["ch01/s01/p001"],
             "page": 1, "attribution": "Donella Meadows"}  # fmt: skip
    put(session, book, ArtifactType.QUOTE_SET, "ch01", {"blocks": [quote]})
    callout = {"type": "callout", "tone": "important", "spans": [
        span("Stocks remember.", "ch01/s01/p001"), span("Flows change them.", "ch01/s02/p001"),
        span("See the bathtub.", "ch01/s01/f001")]}  # fmt: skip
    put(session, book, distil, "ch01", body(callout))
    # ch02: a paragraph cited only in plain prose, and code in a callout: neither is a candidate.
    code = {"type": "callout", "tone": "remember", "spans": [span("Loop.", "ch02/c001")]}
    put(session, book, distil, "ch02", body(paragraph("Goals.", "ch02/p001"), code))

    inputs = select(session, "document_quotes", book, None).inputs

    (chapter,) = inputs["chapters"]
    assert (chapter["anchor"], chapter["quotes"]) == ("ch01", [quote])
    # Already quoted (p001) and the figure are left out; the other cited paragraph stays.
    assert [p["anchor"] for p in chapter["passages"]] == ["ch01/s02/p001"]
    assert chapter["passages"][0]["text"] == "Flows change stocks over time at some rate."
    assert inputs["book_brief"] == []


def test_document_quotes_need_something_to_choose_from(session, book):
    with pytest.raises(SelectorError, match="no chapter quotes or distillations yet"):
        select(session, "document_quotes", book, None)
