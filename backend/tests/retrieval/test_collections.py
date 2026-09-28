"""`ensure_collections`: the §10 layout, created once, safe to call on every job."""

import pytest
from qdrant_client import QdrantClient, models

from app.retrieval.collections import CollectionMismatchError, ensure_collections


def test_creates_blocks_and_distillations_with_named_dense_and_bm25_vectors(
    qdrant: QdrantClient,
) -> None:
    report = ensure_collections(dense_dim=384, client=qdrant)

    assert sorted(report.created) == ["blocks", "claims", "distillations", "documents"]
    for name in ("blocks", "distillations"):
        params = qdrant.get_collection(name).config.params
        assert params.vectors == {
            "text": models.VectorParams(size=384, distance=models.Distance.COSINE)
        }
        assert params.sparse_vectors == {
            "bm25": models.SparseVectorParams(modifier=models.Modifier.IDF)
        }


def test_documents_collection_holds_metadata_only(qdrant: QdrantClient) -> None:
    ensure_collections(dense_dim=384, client=qdrant)

    params = qdrant.get_collection("documents").config.params
    assert params.vectors == {}
    assert not params.sparse_vectors


def test_declares_the_payload_indexes_of_each_collection(qdrant: QdrantClient) -> None:
    report = ensure_collections(dense_dim=384, client=qdrant)

    assert set(report.indexes["blocks"]) == {
        "document_id", "anchor", "chapter_no", "section_path", "kind", "tags", "model_id",
        "char_len",
    }  # fmt: skip
    assert set(report.indexes["distillations"]) == {
        "document_id", "anchor", "type", "level", "tags", "review", "model_id",
    }  # fmt: skip
    assert set(report.indexes["documents"]) == {"slug", "tags"}


def test_second_call_keeps_collections_and_their_points(qdrant: QdrantClient) -> None:
    ensure_collections(dense_dim=384, client=qdrant)
    qdrant.upsert(
        "documents",
        points=[models.PointStruct(id="5f0c1c1e-3f7b-4d1e-9a51-2b1f7a0f9c01", vector={})],
    )

    report = ensure_collections(dense_dim=384, client=qdrant)

    assert report.created == []
    assert sorted(report.existing) == ["blocks", "claims", "distillations", "documents"]
    assert qdrant.count("documents").count == 1


def test_a_dense_size_change_is_refused_unless_recreating(qdrant: QdrantClient) -> None:
    ensure_collections(dense_dim=384, client=qdrant)

    with pytest.raises(CollectionMismatchError, match="blocks"):
        ensure_collections(dense_dim=768, client=qdrant)

    report = ensure_collections(dense_dim=768, client=qdrant, recreate=True)
    assert sorted(report.created) == ["blocks", "claims", "distillations"]
    vectors = qdrant.get_collection("blocks").config.params.vectors
    assert isinstance(vectors, dict)
    assert vectors["text"].size == 768
