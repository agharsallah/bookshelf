"""`store_tree` against the real Postgres test database: upsert by anchor, never notes."""

import uuid

import pytest
from sqlmodel import Session, select

from app.models import Document, Node, Note
from app.models.enums import DocumentKind
from app.pipeline.parse import ParsedDocument, store_tree
from app.pipeline.parse import store as store_module
from app.pipeline.parse.anchors import content_hash
from app.pipeline.parse.markdown import parse_markdown

V1 = "# Book\n\n## One\n\nFirst.\n\nSecond.\n\n### Deep\n\nThird.\n\n## Two\n\nGone soon.\n"
V2 = "# Book\n\n## One\n\nFirst.\n\nSecond, revised.\n\n### Deep\n\nThird.\n"


@pytest.fixture
def document(session: Session) -> Document:
    doc = Document(
        kind=DocumentKind.ARTICLE, slug="book", title="book", sha256="a" * 64,
        source_path="library/book.md",
    )  # fmt: skip
    session.add(doc)
    session.commit()
    return doc


def _stored(session: Session, document: Document) -> dict[str, Node]:
    rows = session.exec(select(Node).where(Node.document_id == document.id)).all()
    return {row.anchor: row for row in rows}


def _store(session: Session, document: Document, parsed: ParsedDocument) -> dict[str, Node]:
    store_tree(session, document, parsed)
    session.commit()
    session.expire_all()
    return _stored(session, document)


def test_first_store_writes_the_tree_with_parents_ordinals_and_depths(session, document):
    rows = _store(session, document, parse_markdown(V1))

    by_id: dict[uuid.UUID | None, str] = {row.id: row.anchor for row in rows.values()}
    shape = {a: (by_id.get(r.parent_id), r.ordinal, r.depth) for a, r in rows.items()}
    assert shape == {
        "ch01": (None, 0, 0),
        "ch01/p001": ("ch01", 0, 1),
        "ch01/p002": ("ch01", 1, 1),
        "ch01/s01": ("ch01", 2, 1),
        "ch01/s01/p001": ("ch01/s01", 0, 2),
        "ch02": (None, 1, 0),
        "ch02/p001": ("ch02", 0, 1),
    }
    assert rows["ch01/p002"].text == "Second."
    assert rows["ch01/p002"].content_hash == content_hash("Second.")
    assert (rows["ch01"].heading, rows["ch01"].text) == ("One", None)


def test_restore_keeps_surviving_ids_updates_changed_rows_and_deletes_vanished(session, document):
    before = _store(session, document, parse_markdown(V1))
    note = Note(document_id=document.id, anchor="ch02/p001", raw="my words")
    session.add(note)
    session.commit()

    after = _store(session, document, parse_markdown(V2))

    assert sorted(after) == ["ch01", "ch01/p001", "ch01/p002", "ch01/s01", "ch01/s01/p001"]
    assert {a: r.id for a, r in after.items()} == {a: before[a].id for a in after}
    assert after["ch01/p002"].text == "Second, revised."
    assert after["ch01/p002"].content_hash == content_hash("Second, revised.")
    assert session.get(Note, note.id) is not None  # notes outlive their anchor (D11)


def test_other_documents_nodes_are_untouched(session, document):
    other = Document(
        kind=DocumentKind.ARTICLE, slug="other", title="other", sha256="b" * 64,
        source_path="library/other.md",
    )  # fmt: skip
    session.add(other)
    session.commit()
    _store(session, other, parse_markdown(V1))

    _store(session, document, parse_markdown(V2))

    assert len(_stored(session, other)) == 7


def test_trees_larger_than_one_batch_keep_parents_valid(session, document, monkeypatch):
    monkeypatch.setattr(store_module, "BATCH_SIZE", 2)

    rows = _store(session, document, parse_markdown(V1))

    assert len(rows) == 7
    assert rows["ch01/s01/p001"].parent_id == rows["ch01/s01"].id


def test_unanchored_tree_is_rejected(session, document):
    parsed = parse_markdown(V1)
    parsed.children[0].anchor = ""

    with pytest.raises(ValueError, match="invalid anchor"):
        store_tree(session, document, parsed)


def test_nodes_of_a_new_document_get_fresh_ids(session, document):
    rows = _store(session, document, parse_markdown(V1))

    assert all(isinstance(r.id, uuid.UUID) for r in rows.values())
    assert len({r.id for r in rows.values()}) == len(rows)
