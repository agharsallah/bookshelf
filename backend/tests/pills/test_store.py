"""`store.sync_document`: idempotent, retires what is gone, brings back what returns."""

import logging
import uuid
from typing import Any

import pytest
from sqlmodel import Session, col, select

from app.audio import store as audio_store
from app.core.config import get_settings
from app.models import Concept, Document, Edge, Node, node_ref
from app.models.enums import ArtifactType, ConceptKind, EntityKind, PillKind, Relation, Review
from app.models.pill import Pill
from app.pills.store import sync_document
from tests.api.factories import make_artifact
from tests.pills.conftest import make_shelf_book
from tests.pills.fixtures import example


def quiz(session: Session, document: Document, body: dict[str, Any], **overrides: Any):
    fields: dict[str, Any] = {"type": ArtifactType.QUIZ, "anchor": "ch03", "skill": "make-quiz"}
    return make_artifact(session, document, body=body, **(fields | overrides))


def live(session: Session, document: Document) -> list[Pill]:
    return list(
        session.exec(
            select(Pill)
            .where(Pill.document_id == document.id, col(Pill.retired_at).is_(None))
            .order_by(col(Pill.created_at), col(Pill.source_key))
        ).all()
    )


def test_a_second_sync_changes_nothing(session: Session, book: Document):
    quiz(session, book, example("make-quiz"))
    make_artifact(
        session,
        book,
        type=ArtifactType.FLASHCARDS,
        anchor="ch02",
        body=example("make-flashcards"),
        review=Review.DRAFT,
    )

    first = sync_document(session, book)
    ids = {p.id for p in live(session, book)}
    second = sync_document(session, book)

    assert first.created == len(example("make-quiz")["items"]) + 5
    assert second.as_dict() == {
        "created": 0,
        "updated": 0,
        "unretired": 0,
        "retired": 0,
        "unchanged": len(ids),
    }
    assert {p.id for p in live(session, book)} == ids
    flips = [p for p in live(session, book) if p.kind is PillKind.FLIP]
    assert flips and all(p.draft for p in flips)  # a draft artifact's pills say so


def test_a_sync_is_logged_with_its_counts(
    session: Session, book: Document, caplog: pytest.LogCaptureFixture
):
    quiz(session, book, example("make-quiz"))

    with caplog.at_level(logging.INFO, logger="app.pills.store"):
        synced = sync_document(session, book)

    (record,) = [r for r in caplog.records if r.name == "app.pills.store"]
    assert record.__dict__["pills"] == synced.as_dict()


def test_front_matter_gives_no_pills(session: Session, book: Document):
    chapter = session.exec(
        select(Node).where(Node.document_id == book.id, Node.anchor == "ch03")
    ).one()
    chapter.meta = {"front_matter": True}
    session.add(chapter)
    session.commit()
    quiz(session, book, example("make-quiz"))

    sync_document(session, book)

    assert live(session, book) == []


def test_a_dropped_item_is_retired_and_comes_back_when_its_version_does(
    session: Session, book: Document
):
    body = example("make-quiz")
    v1 = quiz(session, book, body)
    sync_document(session, book)
    dropped = next(
        p for p in live(session, book) if p.body["question"] == body["items"][0]["question"]
    )

    v2 = quiz(session, book, {"items": body["items"][1:]}, version=2, input_hash="v2")
    retired = sync_document(session, book)

    assert retired.retired == 1 and retired.created == 0
    session.refresh(dropped)
    assert dropped.retired_at is not None

    v2.review = Review.REJECTED  # v1 is the preferred version again
    session.add(v2)
    session.commit()
    back = sync_document(session, book)

    assert back.unretired == 1
    session.refresh(dropped)
    assert dropped.retired_at is None
    assert dropped.source_artifact_id == v1.id


def test_an_edited_item_updates_in_place_when_its_key_holds(session: Session, book: Document):
    body = example("make-quiz")
    quiz(session, book, body)
    sync_document(session, book)
    pill = live(session, book)[0]

    edited = example("make-quiz")
    edited["items"][0]["explanation"][0]["text"] = "Explained again, in other words than before."
    quiz(session, book, edited, version=2, input_hash="v2")
    synced = sync_document(session, book)

    # every row now points at v2; none is replaced, so ids (and their events) hold
    assert (synced.created, synced.retired, synced.updated) == (0, 0, len(body["items"]))
    session.refresh(pill)
    assert pill.body["explanation"][0]["text"] == "Explained again, in other words than before."


def test_rejected_artifacts_harvest_nothing(session: Session, book: Document):
    quiz(session, book, example("make-quiz"), review=Review.REJECTED)

    assert sync_document(session, book).created == 0


def test_figures_use_the_node_crop(session: Session, book: Document):
    make_artifact(
        session,
        book,
        type=ArtifactType.FIGURE_DESCRIPTION,
        anchor="ch03/s01/f001",
        body=example("describe-figure"),
    )

    sync_document(session, book)

    (pill,) = live(session, book)
    assert pill.kind is PillKind.FIGURE
    assert pill.body["image_url"] == "media/book/ch03-f001.png"


def _set_text(session: Session, document: Document, anchor: str, text: str) -> None:
    node = session.exec(
        select(Node).where(Node.document_id == document.id, Node.anchor == anchor)
    ).one()
    node.text = text
    session.add(node)


def test_graph_edges_give_connections_and_concepts(session: Session, book: Document):
    other = make_shelf_book(session, slug="meadows-systems", title="Thinking in Systems")
    mine, theirs = node_ref(book.id, "ch03/s01/p004"), node_ref(other.id, "ch01/p001")
    _set_text(
        session,
        book,
        "ch03/s01/p004",
        "Waiting explodes once a team is loaded past eighty percent.",
    )
    _set_text(
        session,
        other,
        "ch01/p001",
        "Buffers are stocks that stabilize a system against variable flows.",
    )
    concept = Concept(canonical="slack", kind=ConceptKind.CONCEPT)
    session.add(concept)
    session.add(
        Edge(
            src_kind=EntityKind.NODE,
            src_id=node_ref(book.id, "ch03"),
            dst_kind=EntityKind.NODE,
            dst_id=node_ref(other.id, "ch01"),
            relation=Relation.ECHOES,
            evidence=[mine, theirs],
            origin="seed:semantic@1",
        )
    )
    session.add(
        Edge(
            src_kind=EntityKind.NODE,
            src_id=mine,
            dst_kind=EntityKind.CONCEPT,
            dst_id=str(concept.id),
            relation=Relation.MENTIONS,
            evidence=[mine],
            origin="seed:mentions@1",
        )
    )
    session.commit()
    quiz(session, book, {"items": [example("make-quiz")["items"][0]]})

    sync_document(session, book)

    pills = {p.kind: p for p in live(session, book)}
    connection = pills[PillKind.CONNECTION]
    assert connection.cites == ["ch03/s01/p004", "meadows-systems:ch01/p001"]
    assert connection.body["relation"] == "echoes"
    assert connection.anchor == "ch03"
    assert pills[PillKind.QUIZ].concepts == ["slack"]  # its explanation cites ch03/s01/p004
    assert sync_document(session, other).created == 1  # the other side has its own pill


def test_voiced_scripts_give_listen_pills(session: Session, book: Document):
    script = make_artifact(
        session,
        book,
        type=ArtifactType.AUDIO_SUMMARY,
        variant="5m-conversation-en",
        body=example("write-audio-summary"),
    )
    audio_dir = get_settings().audio_dir
    key = "0123456789abcdef"
    folder = audio_store.folder(audio_dir, book.id, str(script.id))
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{key}.mp3").write_bytes(b"ID3fake")
    turns = tuple(
        audio_store.Mark(start=float(i), end=float(i + 1), section=s, turn=t)
        for i, (s, t) in enumerate([(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2)])
    )
    audio_store.save(
        audio_dir,
        audio_store.Render(
            key=key,
            document_id=str(book.id),
            source=str(script.id),
            voices=("a",),
            duration=6.0,
            sections=(),
            turns=turns,
        ),
    )

    sync_document(session, book)

    pills = live(session, book)
    assert {p.kind for p in pills} == {PillKind.LISTEN}
    assert pills[0].body["audio_url"].endswith(f"{script.id}/{key}.mp3")
    assert uuid.UUID(str(pills[0].source_artifact_id)) == script.id
