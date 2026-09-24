"""Indexing: what reaches Qdrant, under which ids, and what a re-run touches."""

import uuid
from typing import Any

from qdrant_client import QdrantClient
from sqlmodel import Session

from app.jobs.registry import JobContext
from app.models import Job
from app.models.enums import JobKind, Review
from app.pipeline.handlers.embed import run_embed
from app.retrieval.embedding import FakeEmbedder, set_embedder
from app.retrieval.indexing import index_document, rebuild_all
from app.retrieval.points import NAMESPACE
from tests.retrieval.conftest import Shelf


def _payloads(client: QdrantClient, name: str) -> dict[str, dict[str, Any]]:
    records, _ = client.scroll(name, limit=100, with_payload=True)
    return {str(r.id): dict(r.payload or {}) for r in records}


def _by_anchor(client: QdrantClient, name: str) -> dict[str, dict[str, Any]]:
    return {p["anchor"]: p for p in _payloads(client, name).values()}


def _index(session: Session, shelf: Shelf, embedder: FakeEmbedder, **kw: Any) -> dict[str, Any]:
    return index_document(session, shelf.meadows, embedder=embedder, **kw)


def test_every_leaf_becomes_a_block_point_with_its_address_payload(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)

    blocks = _by_anchor(collections, "blocks")
    assert sorted(blocks) == ["ch01/s01/p001", "ch01/s01/p002", "ch02/p001", "ch02/p002"]
    first = blocks["ch01/s01/p001"]
    assert {k: first[k] for k in ("document_id", "chapter_no", "section_path", "kind")} == {
        "document_id": str(shelf.meadows.id),
        "chapter_no": 1,
        "section_path": ["ch01", "ch01/s01"],
        "kind": "paragraph",
    }
    assert first["tags"] == ["systems"]
    assert first["char_len"] == len("A stock is the memory of flows.")
    assert first["model_id"] == embedder.model_id


def test_only_approved_artifacts_are_indexed_as_distillations(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)

    distillations = list(_payloads(collections, "distillations").values())
    assert [(d["anchor"], d["type"], d["review"]) for d in distillations] == [
        ("ch02", "chapter_distillation", "approved")
    ]
    assert distillations[0]["level"] == "chapter"
    assert distillations[0]["artifact_id"] == str(shelf.distillation.id)


def test_point_ids_are_uuid5_of_the_address(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)

    doc = shelf.meadows.id
    block_id = str(uuid.uuid5(NAMESPACE, f"block:{doc}:ch02/p001"))
    distillation_id = str(uuid.uuid5(NAMESPACE, f"distillation:{doc}:ch02:chapter_distillation"))
    assert _payloads(collections, "blocks")[block_id]["anchor"] == "ch02/p001"
    assert _payloads(collections, "distillations")[distillation_id]["anchor"] == "ch02"
    assert _payloads(collections, "documents")[str(doc)]["slug"] == "meadows-systems"


def test_a_rerun_without_changes_embeds_nothing(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)
    calls = len(embedder.dense_calls)

    second = _index(session, shelf, embedder)

    assert second["blocks"] == {"embedded": 0, "unchanged": 4, "payload_updated": 0, "deleted": 0}
    assert second["distillations"]["embedded"] == 0
    assert len(embedder.dense_calls) == calls


def test_only_the_edited_block_is_re_embedded(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)
    node = shelf.nodes["m3"]
    node.text = "A balancing loop resists change."
    session.add(node)
    session.commit()
    embedder.dense_calls.clear()

    counts = _index(session, shelf, embedder)

    assert counts["blocks"]["embedded"] == 1
    assert embedder.dense_calls == ["A balancing loop resists change."]


def test_vanished_blocks_and_unapproved_artifacts_are_deleted(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)
    session.delete(shelf.nodes["m4"])
    shelf.distillation.review = Review.REJECTED
    session.add(shelf.distillation)
    session.commit()

    counts = _index(session, shelf, embedder)

    assert counts["blocks"]["deleted"] == 1
    assert counts["distillations"]["deleted"] == 1
    assert "ch02/p002" not in _by_anchor(collections, "blocks")
    assert _payloads(collections, "distillations") == {}


def test_a_model_change_re_embeds_every_point(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, collections: QdrantClient
) -> None:
    _index(session, shelf, embedder)
    upgraded = FakeEmbedder(model_id="fake-dense-v2+fake-bm25")

    counts = index_document(session, shelf.meadows, embedder=upgraded)

    assert counts["blocks"]["embedded"] == 4
    assert {p["model_id"] for p in _payloads(collections, "blocks").values()} == {
        "fake-dense-v2+fake-bm25"
    }


def test_rebuild_indexes_every_document_and_drops_deleted_ones(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, qdrant: QdrantClient
) -> None:
    first = rebuild_all(session, embedder=embedder)
    assert first["documents"] == 2
    session.delete(shelf.senge)
    session.commit()

    second = rebuild_all(session, embedder=embedder)

    assert second["orphans_removed"] == 1
    doc_ids = {p["document_id"] for p in _payloads(qdrant, "blocks").values()}
    assert doc_ids == {str(shelf.meadows.id)}
    assert list(_payloads(qdrant, "documents")) == [str(shelf.meadows.id)]


def test_embed_job_indexes_its_document_and_without_one_rebuilds_all(
    session: Session, shelf: Shelf, embedder: FakeEmbedder, qdrant: QdrantClient
) -> None:
    set_embedder(embedder)
    one = run_embed(JobContext(session, Job(kind=JobKind.EMBED, document_id=shelf.senge.id)))
    assert one.result["blocks"]["embedded"] == 2

    everything = run_embed(JobContext(session, Job(kind=JobKind.EMBED)))
    assert everything.result["documents"] == 2
    assert qdrant.count("blocks").count == 6


def test_deleting_a_document_queues_the_purge_of_its_points(
    session: Session, indexed: Shelf, embedder: FakeEmbedder, qdrant: QdrantClient
) -> None:
    from sqlmodel import select

    from app.services.documents import delete_document

    senge_id = str(indexed.senge.id)
    delete_document(session, indexed.senge)
    purge = session.exec(select(Job).where(Job.kind == JobKind.EMBED)).one()

    run_embed(JobContext(session, purge))

    doc_ids = {p["document_id"] for p in _payloads(qdrant, "blocks").values()}
    doc_ids |= {p["document_id"] for p in _payloads(qdrant, "distillations").values()}
    assert doc_ids == {str(indexed.meadows.id)}
    assert senge_id not in _payloads(qdrant, "documents")
    assert _payloads(qdrant, "blocks")  # Meadows is untouched: no rebuild ran
