"""`paper_enrich`: OpenAlex fills paper_meta and resolves the bibliography, links references
to shelf papers both ways, and never overwrites what you set by hand."""

import httpx
from sqlmodel import Session, select

from app.jobs.queue import JobSpec
from app.models import Job, PaperMeta, PaperReference
from app.models.enums import CitationIntent, Genre, JobKind, PaperMetaSource
from app.papers.enrich import queue_enrich
from app.papers.http import set_http_client_factory
from app.pipeline.handlers.paper_external import run_paper_enrich
from tests.api.factories import make_document
from tests.papers.conftest import job_context, make_paper
from tests.papers.fake_openalex import FakeOpenAlex


def reference(session: Session, document_id, ordinal: int, **fields) -> PaperReference:
    row = PaperReference(document_id=document_id, ordinal=ordinal, raw=f"[{ordinal}] ...", **fields)
    session.add(row)
    session.commit()
    return row


def enrich(session: Session, document_id) -> dict:
    ctx = job_context(session, JobSpec(kind=JobKind.PAPER_ENRICH, document_id=document_id))
    return run_paper_enrich(ctx).result


def seed(openalex: FakeOpenAlex) -> None:
    openalex.add(
        "W100",
        "Attention Is All You Need",
        doi="10.1/attn",
        year=2017,
        abstract="self attention replaces recurrence",
        venue="NeurIPS",
        cited_by_count=900,
        referenced_works=["W1", "W2", "W3"],
    )
    openalex.add("W1", "Adam: A Method for Stochastic Optimization", doi="10.1/adam", year=2014)
    openalex.add("W2", "Layer Normalization", year=2016)
    openalex.add("W3", "Neural Machine Translation by Jointly Learning", year=2014)


def test_enrich_fills_meta_and_resolves_references_by_doi_and_title(
    session: Session, openalex: FakeOpenAlex
):
    seed(openalex)
    paper = make_paper(session, "Attention is all you need", meta={"doi": "10.1/ATTN"})
    by_doi = reference(session, paper.id, 1, doi="10.1/adam")
    by_title = reference(session, paper.id, 2, title="Layer normalization", year=2016)
    unknown = reference(session, paper.id, 3, title="A paper OpenAlex does not list")

    result = enrich(session, paper.id)

    assert result["matched"] and result["openalex_id"] == "W100"
    assert result["references_resolved"] == 2
    meta = session.get(PaperMeta, paper.id)
    session.refresh(meta)
    assert (meta.openalex_id, meta.venue, meta.year, meta.cited_by_count) == (
        "W100",
        "NeurIPS",
        2017,
        900,
    )
    assert meta.abstract == "self attention replaces recurrence"
    assert meta.fields == ["Machine Learning"] and meta.reference_count == 3
    assert meta.source == PaperMetaSource.OPENALEX and meta.enriched_at is not None
    for row in (by_doi, by_title, unknown):
        session.refresh(row)
    assert (by_doi.openalex_id, by_title.openalex_id, unknown.openalex_id) == ("W1", "W2", None)
    assert by_doi.title == "Adam: A Method for Stochastic Optimization"  # blank filled
    assert by_title.title == "Layer normalization"  # parsed value kept
    assert openalex.asked("/works/doi:10.1/attn")


def test_a_record_with_another_papers_title_gives_only_its_ids_and_counts(
    session: Session, openalex: FakeOpenAlex
):
    # OpenAlex's BERT record (found by BERT's own id) carries the DOI, title and abstract of
    # an unrelated 2022 paper next to BERT's citation count.
    openalex.add("W289", "AI-Assisted Pipeline for Health Supplement Content", doi="10.4230/x",
                 year=2022, abstract="geospatial questions", venue="LIPIcs",
                 cited_by_count=45994)  # fmt: skip
    paper = make_paper(session, "BERT: Pre-training of Deep Bidirectional Transformers",
                       meta={"openalex_id": "W289", "abstract": "We introduce BERT."})  # fmt: skip

    enrich(session, paper.id)

    meta = session.get(PaperMeta, paper.id)
    session.refresh(meta)
    assert (meta.openalex_id, meta.cited_by_count) == ("W289", 45994)
    assert (meta.doi, meta.venue, meta.year) == (None, None, None)  # not the 2022 paper's
    assert meta.abstract == "We introduce BERT."


def test_a_parsed_abstract_is_kept_and_a_missing_one_filled(
    session: Session, openalex: FakeOpenAlex
):
    seed(openalex)
    own = {"doi": "10.1/attn", "abstract": "The paper's own words."}
    parsed = make_paper(session, "Attention is all you need", meta=own)

    enrich(session, parsed.id)

    meta = session.get(PaperMeta, parsed.id)
    session.refresh(meta)
    assert meta.abstract == "The paper's own words." and meta.venue == "NeurIPS"


def test_a_human_row_keeps_its_fields_and_only_blanks_are_filled(
    session: Session, openalex: FakeOpenAlex
):
    seed(openalex)
    meta = {"doi": "10.1/attn", "venue": "My venue", "source": PaperMetaSource.HUMAN}
    paper = make_paper(session, "Attention", meta=meta)
    enrich(session, paper.id)
    row = session.get(PaperMeta, paper.id)
    session.refresh(row)
    assert (row.venue, row.source) == ("My venue", PaperMetaSource.HUMAN)
    assert (row.openalex_id, row.cited_by_count) == ("W100", 900)  # blanks and counts


def test_a_human_edit_made_while_openalex_answers_is_not_overwritten(
    session: Session, openalex: FakeOpenAlex
):
    """Regression: the session is released for the HTTP calls; applying OpenAlex onto the
    meta loaded before them clobbered a concurrent `PATCH /meta`."""
    seed(openalex)
    paper = make_paper(session, "Attention", meta={"doi": "10.1/attn"})
    engine = session.get_bind()

    def human_edits_then_answers(request: httpx.Request) -> httpx.Response:
        with Session(engine) as other:
            row = other.get(PaperMeta, paper.id)
            row.venue, row.source = "Fixed by hand", PaperMetaSource.HUMAN
            other.add(row)
            other.commit()
        return openalex(request)

    set_http_client_factory(
        lambda: httpx.Client(transport=httpx.MockTransport(human_edits_then_answers))
    )
    enrich(session, paper.id)

    row = session.get(PaperMeta, paper.id)
    session.refresh(row)
    assert (row.venue, row.source) == ("Fixed by hand", PaperMetaSource.HUMAN)
    assert row.openalex_id == "W100"  # blanks still filled


def test_references_link_to_shelf_papers_in_both_directions(
    session: Session, openalex: FakeOpenAlex
):
    seed(openalex)
    adam = make_paper(session, "Adam", meta={"openalex_id": "W1"})
    paper = make_paper(session, "Attention", meta={"doi": "10.1/attn"})
    cites_adam = reference(session, paper.id, 1, doi="10.1/adam", intent=CitationIntent.USES)
    later = make_paper(session, "Transformers later", meta={})
    cites_attention = reference(session, later.id, 1, openalex_id="W100")
    already = reference(session, later.id, 2, openalex_id="W100", target_document_id=adam.id)

    result = enrich(session, paper.id)

    assert (result["references_linked"], result["cited_by_shelf_linked"]) == (1, 1)
    for row in (cites_adam, cites_attention, already):
        session.refresh(row)
    assert cites_adam.target_document_id == adam.id
    assert cites_attention.target_document_id == paper.id
    assert already.target_document_id == adam.id  # never replaced


def test_an_unmatched_paper_is_marked_enriched_but_left_as_parsed(
    session: Session, openalex: FakeOpenAlex
):
    paper = make_paper(session, "Nobody indexed this", meta={"venue": "Parsed venue"})
    result = enrich(session, paper.id)
    meta = session.get(PaperMeta, paper.id)
    session.refresh(meta)
    assert result["matched"] is False
    assert (meta.venue, meta.source, meta.openalex_id) == (
        "Parsed venue",
        PaperMetaSource.PARSED,
        None,
    )
    assert meta.enriched_at is not None


def test_queue_enrich_queues_papers_only_and_dedupes(session: Session):
    paper = make_paper(session, "A paper")
    book = make_document(session, genre=Genre.BOOK)
    first, second = queue_enrich(session, paper), queue_enrich(session, paper)
    assert first is not None and second is not None and first.id == second.id
    assert queue_enrich(session, book) is None
    kinds = session.exec(select(Job.kind).where(Job.kind == JobKind.PAPER_ENRICH)).all()
    assert kinds == [JobKind.PAPER_ENRICH]
