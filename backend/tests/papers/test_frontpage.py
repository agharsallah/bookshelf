"""papers.frontpage: authors, identifiers and year from page one's text."""

# ruff: noqa: RUF001

from app.papers.frontpage import authors_from, read_front_page

TRANSFORMER = """Provided proper attribution is provided, Google hereby grants permission
Attention Is All You Need
Ashish Vaswani∗
Google Brain
avaswani@google.com
Noam Shazeer∗
Google Brain
Łukasz Kaiser∗
Illia Polosukhin∗‡
illia.polosukhin@gmail.com
Abstract
The dominant sequence transduction models are based on complex recurrent networks.
31st Conference on Neural Information Processing Systems (NIPS 2017), Long Beach, CA, USA.
arXiv:1706.03762v7 [cs.CL] 2 Aug 2023
"""


def test_the_transformer_front_page_yields_authors_ids_and_the_venue_year():
    front = read_front_page(TRANSFORMER, title="Attention Is All You Need")

    assert front.authors == ["Ashish Vaswani", "Noam Shazeer", "Łukasz Kaiser", "Illia Polosukhin"]
    assert (front.arxiv_id, front.year, front.doi) == ("1706.03762", 2017, None)


def test_a_title_over_two_lines_and_comma_separated_authors():
    text = (
        "BERT: Pre-training of\nDeep Transformers\n"
        "Jacob Devlin, Ming-Wei Chang and Kenton Lee\nAbstract"
    )

    assert authors_from(text, "BERT: Pre-training of Deep Transformers") == [
        "Jacob Devlin", "Ming-Wei Chang", "Kenton Lee"
    ]  # fmt: skip


def test_without_a_venue_line_the_arxiv_id_dates_the_paper_and_a_doi_is_read():
    front = read_front_page(
        "A Title\nAda Lovelace\narXiv:1810.04805v2\nDOI: 10.1145/3292500.3330701.", title="A Title"
    )

    assert (front.year, front.doi) == (2018, "10.1145/3292500.3330701")
