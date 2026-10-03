"""References: suggestions from the shelf, docs/REFERENCES.md, snapshots with a fake fetcher."""

import uuid
from datetime import UTC, datetime

from sqlmodel import Session

from app.builds.references import (
    MAX_CITED,
    FetchedText,
    reference_path,
    render_references_md,
    snapshot,
    suggested_references,
)
from app.models import PaperReference
from app.schemas.build_options import BuildReference
from app.services.errors import UpstreamError
from tests.builds.factories import known_paper
from tests.papers.conftest import make_paper

URL_REF = BuildReference(kind="url", url="https://blog.example/attention",
                         title="Attention, explained", note="the clearest diagram",
                         snapshot=True)  # fmt: skip
LINK_REF = BuildReference(kind="url", url="https://pytorch.org/docs", title="PyTorch docs")


def cite(session: Session, paper_id: uuid.UUID, ordinal: int, **fields: object) -> None:
    session.add(PaperReference(document_id=paper_id, ordinal=ordinal, raw=f"Ref {ordinal}.",
                               **fields))  # fmt: skip
    session.commit()


def test_suggestions_cover_code_data_the_paper_its_citations_and_the_shelf(session: Session):
    paper = known_paper(session, meta={
        "arxiv_id": "2101.00001", "doi": "10.1/gated",
        "code_urls": ["https://github.com/acme/gated"], "data_urls": ["https://data.acme/nq"],
    })  # fmt: skip
    bert = make_paper(session, "BERT")
    cite(session, paper.id, 1, title="Dense retrieval", arxiv_id="2004.04906")
    cite(session, paper.id, 2, title="BERT", doi="10.18653/v1/N19-1423", target_document_id=bert.id)
    cite(session, paper.id, 3, title="No identifiers")
    cite(session, paper.id, 4, title="Same as 1, again", arxiv_id="2004.04906")
    cite(session, paper.id, 5, title="A DOI only", doi="10.1/x")
    cite(session, paper.id, 6, title="Itself", target_document_id=paper.id, arxiv_id="2101.00001")

    got = [(s.source, s.kind, s.url, s.document_id, s.title)
           for s in suggested_references(session, paper)]  # fmt: skip

    assert got == [
        ("code", "url", "https://github.com/acme/gated", None, "Code: github.com/acme/gated"),
        ("data", "url", "https://data.acme/nq", None, "Data: data.acme/nq"),
        ("paper", "url", "https://arxiv.org/abs/2101.00001", None, "Gated Readers (arXiv)"),
        ("paper", "url", "https://doi.org/10.1/gated", None, "Gated Readers (DOI)"),
        ("cited", "url", "https://arxiv.org/abs/2004.04906", None, "Dense retrieval"),
        ("shelf", "shelf", None, bert.id, "BERT"),
        ("cited", "url", "https://doi.org/10.1/x", None, "A DOI only"),
    ]  # the duplicate arXiv link and the self-citation are dropped


def test_at_most_ten_cited_works_are_suggested(session: Session):
    paper = known_paper(session, meta={})
    for n in range(1, 15):
        cite(session, paper.id, n, title=f"Work {n}", arxiv_id=f"2001.{n:05d}")

    cited = [s for s in suggested_references(session, paper) if s.source == "cited"]

    assert len(cited) == MAX_CITED and cited[0].title == "Work 1"


def test_references_md_lists_title_link_note_and_files():
    shelf_id = uuid.uuid4()
    shelf = BuildReference(kind="shelf", document_id=shelf_id, title="The encoder paper")
    refs = [URL_REF, LINK_REF, shelf]

    text = render_references_md(
        refs, {shelf_id: "BERT: Pre-training"},
        {1: "docs/references/01-attention-explained.md",
         3: "docs/references/03-the-encoder-paper.md"},
    )  # fmt: skip

    assert "1. **[Attention, explained](https://blog.example/attention)**" in text
    assert "   - Why: the clearest diagram" in text
    assert ("   - snapshot: [docs/references/01-attention-explained.md]"
            "(references/01-attention-explained.md)") in text  # fmt: skip
    assert "2. **[PyTorch docs](https://pytorch.org/docs)**\n3." in text  # a link only
    assert "3. **The encoder paper** (the paper *BERT: Pre-training*)" in text
    assert "   - brief: [docs/references/03-the-encoder-paper.md]" in text


def test_only_snapshots_and_shelf_papers_get_a_file():
    assert reference_path(1, URL_REF) == "docs/references/01-attention-explained.md"
    assert reference_path(2, LINK_REF) is None
    shelf = BuildReference(kind="shelf", document_id=uuid.uuid4(), title="Ünïcode & co!")
    assert reference_path(12, shelf) == "docs/references/12-unicode-co.md"


def test_a_snapshot_saves_the_readable_text_with_its_source():
    seen: list[str] = []

    def fetch(url: str) -> FetchedText:
        seen.append(url)
        return FetchedText(url=f"{url}/final", title="Page", text="## Attention\n\nWeights.")

    result = snapshot(URL_REF, "docs/references/01-a.md", fetch=fetch,
                      now=datetime(2026, 10, 3, tzinfo=UTC))  # fmt: skip

    assert seen == ["https://blog.example/attention"] and result.error is None
    assert result.content == (
        "# Attention, explained\n\nSource: <https://blog.example/attention/final> · fetched "
        "2026-10-03\n\n> the clearest diagram\n\n---\n\n## Attention\n\nWeights.\n"
    )


def test_a_failed_snapshot_is_returned_not_raised():
    def fetch(_url: str) -> FetchedText:
        raise UpstreamError("The remote server answered 503.")

    result = snapshot(URL_REF, "docs/references/01-a.md", fetch=fetch)

    assert result.content is None and result.error == "The remote server answered 503."
