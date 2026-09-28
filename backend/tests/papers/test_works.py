"""OpenAlex work JSON → `Work`: the fields Papers relies on, from a recorded-shape fixture."""

import json
from datetime import date
from pathlib import Path

import pytest

from app.papers.works import (
    normalize_arxiv_id,
    normalize_doi,
    parse_work,
    reconstruct_abstract,
    short_openalex_id,
)

FIXTURE = Path(__file__).parent / "fixtures" / "work_transformer.json"


def load() -> dict:
    return json.loads(FIXTURE.read_text())


def test_abstract_is_rebuilt_in_position_order_from_the_inverted_index():
    inverted = {"world": [1], "hello": [0, 2], "again.": [3]}
    assert reconstruct_abstract(inverted) == "hello world hello again."


def test_a_missing_or_empty_inverted_index_is_no_abstract():
    assert reconstruct_abstract(None) is None
    assert reconstruct_abstract({}) is None


def test_parse_work_maps_every_field_papers_uses():
    work = parse_work(load())
    assert work.openalex_id == "W2626778328"
    assert work.doi == "10.65215/2q58a426"
    assert work.arxiv_id == "1706.03762"
    assert work.title == "Attention Is All You Need"
    assert work.authors == ("Ashish Vaswani", "Noam Shazeer")
    assert (work.year, work.publication_date) == (2017, date(2017, 6, 12))
    assert work.venue == "Neural Information Processing Systems"  # not the arXiv repository
    assert (
        work.abstract == "The dominant sequence transduction models are The Transformer is simpler."
    )
    assert work.cited_by_count == 26936
    assert work.pdf_url == "https://oa.example.org/download/108.pdf"  # best_oa_location first
    assert work.fields == ("Natural Language Processing Techniques", "Topic Modeling")
    assert work.referenced_works == ("W1632114991", "W1810943226")  # deduplicated
    assert work.related_works == ("W2965373594", "W2964308564")


def test_a_sparse_work_falls_back_to_arxiv_pdf_and_concepts():
    data = {
        "id": "https://openalex.org/W1",
        "doi": "https://doi.org/10.48550/arXiv.2101.00001",
        "title": "Sparse",
        "concepts": [
            {"display_name": "Physics", "score": 0.7},
            {"display_name": "Noise", "score": 0.1},
        ],
        "publication_date": "not a date",
    }
    work = parse_work(data)
    assert work.arxiv_id == "2101.00001"
    assert work.pdf_url == "https://arxiv.org/pdf/2101.00001"
    assert work.fields == ("Physics",)
    assert (work.venue, work.publication_date, work.abstract) == (None, None, None)
    assert work.cited_by_count == 0


def test_oversized_or_blank_fields_are_fitted_to_the_column_checks():
    """OpenAlex sometimes serves a full text as the abstract, or an empty OA pdf_url: a value
    past a length check would fail the whole candidates rebuild."""
    data = {
        "id": "W1",
        "display_name": "T" * 1500,
        "doi": "https://doi.org/10.1/" + "x" * 400,
        "abstract_inverted_index": {"word": list(range(5000))},
        "primary_location": {"source": {"display_name": "V" * 600}},
        "best_oa_location": {"pdf_url": ""},
        "locations": [{"pdf_url": "https://oa.example.org/" + "p" * 3000}],
    }
    work = parse_work(data)
    assert len(work.title) == 1000
    assert work.venue is not None and len(work.venue) == 500
    assert work.abstract is not None and len(work.abstract) <= 20000
    assert work.doi is None  # a truncated DOI would be a different DOI
    assert work.pdf_url is None  # blank and oversized URLs are no URL


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("arXiv:1706.03762v5", "1706.03762"),
        ("https://arxiv.org/abs/2310.06825v2", "2310.06825"),
        ("hep-th/9901001", "hep-th/9901001"),
    ],
)
def test_arxiv_ids_are_normalized_without_version(raw, expected):
    assert normalize_arxiv_id(raw) == expected


def test_ids_and_dois_are_normalized_and_garbage_is_refused():
    assert short_openalex_id("https://openalex.org/w42") == "W42"
    assert normalize_doi("doi:10.1000/ABC") == "10.1000/abc"
    for bad, fn in (
        ("A123", short_openalex_id),
        ("nope", normalize_doi),
        ("x", normalize_arxiv_id),
    ):
        with pytest.raises(ValueError):
            fn(bad)
