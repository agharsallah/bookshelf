"""Markdown, JSON, CSV and reading-PDF exports, on demand and via the export job."""

import csv
import io
import json
from pathlib import Path

import pymupdf
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext
from app.models.enums import ArtifactType, JobKind, Review
from app.pipeline.handlers.export import run_export
from tests.api.factories import make_artifact, make_book

URL = "/api/v1/exports"
CHART = {
    "type": "chart",
    "kind": "bar",
    "title": "Inflow",
    "x": {"label": "year", "values": [2000, 2001]},
    "series": [{"name": "rain", "values": [3, 4]}],
    "cites": ["ch02/f001"],
}
TABLE = {
    "type": "table",
    "header": ["Loop"],
    "rows": [[{"text": "balancing", "cites": ["ch01/s01/p001"]}]],
}


def pdf_text(content: bytes) -> str:
    """Every page's text, with ligatures (the serif font's "fl", "fi") spelled out."""
    flags = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES
    document = pymupdf.open(stream=content, filetype="pdf")
    return "\n".join(page.get_text(flags=flags) for page in document)


def seed(session: Session):
    book = make_book(session, title="Thinking in Systems", authors=["Donella Meadows"])
    summary = {"blocks": [{"type": "paragraph", "spans": [{"text": "Approved v2.", "cites": []}]}]}
    make_artifact(session, book, anchor="ch01", version=1, body={"blocks": [TABLE]})
    make_artifact(session, book, anchor="ch01", version=2, body=summary)
    make_artifact(
        session, book, anchor="ch02", type=ArtifactType.SECTION_NOTE, body={"blocks": [CHART]}
    )
    make_artifact(
        session,
        book,
        anchor="ch02",
        type=ArtifactType.FAQ,
        review=Review.DRAFT,
        body={"blocks": [{"type": "heading", "level": 2, "text": "Draft only"}]},
    )
    return book


def test_markdown_has_the_tree_with_anchor_ids_and_approved_artifacts(
    client: TestClient, session: Session
):
    book = seed(session)

    response = client.get(f"{URL}/{book.slug}.md")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/markdown")
    text = response.text
    assert text.startswith("# Thinking in Systems\n\n*Donella Meadows*")
    assert '<a id="ch01"></a>\n\n## Heading ch01' in text
    assert '<a id="ch01/s01"></a>\n\n### Heading ch01/s01' in text
    assert '<a id="ch01/s01/p001"></a>Text of ch01/s01/p001.' in text
    assert "| Stock | Flow |\n| --- | --- |\n| Water | Rain |" in text
    assert "![Figure 2.1 A bathtub](/api/v1/media/doc/f001.png)" in text
    assert text.index("ch01/s01/p001") < text.index("ch01/s02/t001") < text.index("ch02/f001")
    assert "Approved v2." in text  # latest approved version replaces v1
    assert "| balancing" not in text
    assert "| 2000 | 3 |" in text
    assert "Draft only" not in text


def test_json_is_the_full_tree_plus_latest_approved_artifacts(client: TestClient, session: Session):
    book = seed(session)

    body = client.get(f"{URL}/{book.id}.json").json()

    assert (body["format"], body["version"], body["document"]["slug"]) == (
        "bookshelf.export",
        1,
        book.slug,
    )
    assert [n["anchor"] for n in body["tree"]] == ["ch01", "ch02"]
    assert body["tree"][0]["children"][0]["children"][0]["text"] == "Text of ch01/s01/p001."
    assert [(a["anchor"], a["type"], a["version"]) for a in body["artifacts"]] == [
        ("ch01", "chapter_summary", 2),
        ("ch02", "section_note", 1),
    ]
    assert body["artifacts"][1]["body"] == {"blocks": [CHART]}


def test_csv_flattens_table_nodes_and_chart_blocks_with_source_anchors(
    client: TestClient, session: Session
):
    book = seed(session)

    response = client.get(f"{URL}/{book.slug}/tables.csv")

    assert response.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(response.text)))
    cells = [
        (r["source"], r["anchor"], r["row"], r["column"], r["header"], r["value"]) for r in rows
    ]
    assert cells == [
        ("node", "ch01/s02/t001", "1", "1", "Stock", "Water"),
        ("node", "ch01/s02/t001", "1", "2", "Flow", "Rain"),
        ("node", "ch01/s02/t001", "2", "1", "Stock", "Money"),
        ("node", "ch01/s02/t001", "2", "2", "Flow", "Income"),
        ("artifact", "ch02", "1", "1", "year", "2000"),
        ("artifact", "ch02", "1", "2", "rain", "3"),
        ("artifact", "ch02", "2", "1", "year", "2001"),
        ("artifact", "ch02", "2", "2", "rain", "4"),
    ]
    assert rows[0]["caption"] == "Table 1.1 Stocks and flows"
    assert {r["cites"] for r in rows if r["source"] == "artifact"} == {"ch02/f001"}
    assert rows[-1]["artifact_type"] == "section_note"


def test_csv_includes_table_blocks_with_cell_cites(client: TestClient, session: Session):
    book = make_book(session)
    make_artifact(session, book, anchor="ch01", body={"blocks": [TABLE]})

    rows = list(csv.DictReader(io.StringIO(client.get(f"{URL}/{book.slug}/tables.csv").text)))

    artifact_rows = [
        (r["header"], r["value"], r["cites"]) for r in rows if r["source"] == "artifact"
    ]
    assert artifact_rows == [("Loop", "balancing", "ch01/s01/p001")]


def test_reading_pdf_keeps_approved_notes_in_chapter_order(client: TestClient, session: Session):
    book = seed(session)

    response = client.get(f"{URL}/{book.slug}.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    document = pymupdf.open(stream=response.content, filetype="pdf")
    text = pdf_text(response.content)
    assert "Thinking in Systems" in text
    assert "Donella Meadows" in text
    assert text.index("Approved v2.") < text.index("Inflow")
    assert "Draft only" not in text
    outline = {entry[1]: (entry[0], entry[2]) for entry in document.get_toc()}
    assert outline["Thinking in Systems"] == (1, 1)
    assert outline["Contents"] == (1, 2)
    assert outline["Chapters"][0] == 1
    level, chapter_page = outline["Heading ch01"]
    assert level == 2
    # The contents prints the page each chapter starts on, and links to it.
    contents = document[1].get_text()
    assert "Heading ch01" in contents and str(chapter_page) in contents
    assert chapter_page - 1 in {link["page"] for link in document[1].get_links()}
    # Running head: the book, and the part the page belongs to.
    head = document[chapter_page - 1].get_text()
    assert head.count("Heading ch01") >= 2
    # A citation links to the chapter it comes from (the chart cites ch02/f001).
    ch02_page = outline["Heading ch02"][1]
    cite_links = [link for link in document[ch02_page - 1].get_links() if link.get("kind") == 1]
    assert any(link["page"] == ch02_page - 1 for link in cite_links)


def test_composed_pdf_links_the_edition_and_is_absent_until_then(
    client: TestClient, session: Session
):
    book = seed(session)
    missing = client.get(f"{URL}/{book.slug}.pdf?edition=composed")
    assert missing.status_code == 404

    make_artifact(
        session,
        book,
        type=ArtifactType.READING_EDITION,
        anchor=None,
        body={
            "title": "One argument, told in order",
            "preface": [
                {
                    "type": "paragraph",
                    "spans": [{"text": "Read the through-line first.", "cites": []}],
                }
            ],
            "parts": [
                {
                    "id": "through-line",
                    "title": "Stocks remember",
                    "see": ["ch01"],
                    "blocks": [
                        {"type": "paragraph", "spans": [{"text": "Watch the stock.", "cites": []}]}
                    ],
                },
                {
                    "id": "ch01",
                    "title": "The bathtub",
                    "see": ["through-line"],
                    "blocks": [
                        {
                            "type": "paragraph",
                            "spans": [{"text": "Inflow and outflow.", "cites": []}],
                        }
                    ],
                },
            ],
        },
    )

    assembled_text = pdf_text(client.get(f"{URL}/{book.slug}.pdf").content)
    assert "Read the through-line first." not in assembled_text

    response = client.get(f"{URL}/{book.slug}.pdf?edition=composed")

    assert response.status_code == 200
    document = pymupdf.open(stream=response.content, filetype="pdf")
    text = pdf_text(response.content)
    assert "One argument, told in order" in text
    # The argument opens, then each chapter: the edition's bridge before its notes.
    assert text.index("Watch the stock.") < text.index("Inflow and outflow.")
    assert text.index("Inflow and outflow.") < text.index("Approved v2.")
    assert "WHERE THIS SITS" in text
    assert "SEE ALSO" in text
    # A chapter the edition has no part for still prints its approved notes.
    assert "Heading ch02" in text
    outline = {entry[1]: entry[2] for entry in document.get_toc()}
    assert outline["Stocks remember"] < outline["The bathtub"] < outline["Heading ch02"]
    assert any(link.get("kind") == 1 for page in document for link in page.get_links())


def test_unknown_document_export_is_404(client: TestClient):
    assert client.get(f"{URL}/missing.md").status_code == 404


def test_export_job_writes_the_bundle(session: Session, exports_dir: Path, media_dir: Path):
    book = seed(session)
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, document_id=book.id))
    assert job is not None

    result = run_export(JobContext(session=session, job=job))

    folder = exports_dir / book.slug
    assert sorted(p.name for p in folder.iterdir()) == sorted(
        [f"{book.slug}.md", f"{book.slug}.json", "tables.csv", f"{book.slug}.pdf"]
    )
    markdown = (folder / f"{book.slug}.md").read_text()
    relative_media = f"../../{media_dir.name}/doc/f001.png"
    assert (folder / relative_media).resolve() == (media_dir / "doc/f001.png").resolve()
    assert f"]({relative_media})" in markdown
    assert json.loads((folder / f"{book.slug}.json").read_text())["document"]["id"] == str(book.id)
    assert result.result["artifacts"] == 2
