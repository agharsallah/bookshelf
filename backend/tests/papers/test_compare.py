"""Results comparison (docs/PAPERS.md §5): the pure pivot, and `GET /papers/compare`."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Concept
from app.models.enums import ArtifactType, ConceptKind, Review
from app.papers.compare import PaperResults, compare
from tests.papers.paper_fixtures import add_paper, store
from tests.pipeline.runtime.conftest import add_document

A, B = uuid.UUID(int=1), uuid.UUID(int=2)


def row(method: str, value: float, **extra: Any) -> dict[str, Any]:
    return {
        "method": method,
        "dataset": "WMT 2014 EN-DE",
        "metric": "BLEU",
        "value": value,
        "unit": None,
        "higher_is_better": True,
        "is_proposed": False,
        "cites": ["ch03/t001"],
        **extra,
    }


def cells(result, method: str) -> list[tuple[float, bool]]:
    found = next(r for r in result.rows if r.method == method)
    return [(c.value, c.best) for c in found.cells]


def test_rows_pivot_into_methods_by_dataset_and_metric_with_names_casefolded():
    result = compare(
        [
            PaperResults(A, [row("Transformer", 28.4, is_proposed=True), row("GNMT", 24.6)]),
            PaperResults(
                B,
                [
                    row("  gnmt ", 24.7, dataset="wmt 2014 en-de"),
                    row("GNMT", 38.9, dataset="WMT 2014 EN-FR"),
                ],
            ),
        ]
    )

    assert [(c.dataset, c.metric, len(c.cells)) for c in result.columns] == [
        ("WMT 2014 EN-DE", "BLEU", 3),
        ("WMT 2014 EN-FR", "BLEU", 1),
    ]
    assert [r.method for r in result.rows] == ["GNMT", "Transformer"]
    gnmt = result.rows[0].cells
    assert [(c.document_id, c.value) for c in gnmt] == [(A, 24.6), (B, 24.7), (B, 38.9)]
    assert gnmt[0].cites == ["ch03/t001"]  # as given: the caller qualifies


def test_concept_names_join_spellings_a_casefold_cannot():
    canon = {
        "method": {"transformer (big)": "transformer", "transformer": "transformer"},
        "dataset": {
            "wmt14 en-de": "wmt 2014 english-german",
            "wmt 2014 en-de": "wmt 2014 english-german",
        },
    }
    result = compare(
        [
            PaperResults(A, [row("Transformer (big)", 28.4)]),
            PaperResults(B, [row("Transformer", 27.3, dataset="WMT14 En-De")]),
        ],
        canon,
    )

    assert [(c.dataset, len(c.cells)) for c in result.columns] == [("wmt 2014 english-german", 2)]
    assert [r.method for r in result.rows] == ["transformer"]


def test_best_honours_the_columns_direction():
    ppl = {"metric": "perplexity", "higher_is_better": False}
    result = compare(
        [
            PaperResults(
                A, [row("X", 4.9, **ppl), row("Y", 4.3, **ppl), row("Z", 28.0), row("W", 28.4)]
            )
        ]
    )

    by_metric = {c.metric: c for c in result.columns}
    assert (by_metric["perplexity"].higher_is_better, by_metric["perplexity"].best) == (False, 4.3)
    assert by_metric["BLEU"].best == 28.4
    assert cells(result, "Y") == [(4.3, True)] and cells(result, "X") == [(4.9, False)]
    assert cells(result, "W") == [(28.4, True)] and cells(result, "Z") == [(28.0, False)]


def test_other_units_are_not_ranked_and_a_lone_cell_is_not_best():
    acc = {"metric": "accuracy"}
    result = compare(
        [
            PaperResults(
                A,
                [
                    row("X", 91.0, unit="%", **acc),
                    row("Y", 0.95, **acc),
                    row("Z", 90.0, unit="%", **acc),
                    row("Solo", 1.0, dataset="Other"),
                ],
            )
        ]
    )

    column = next(c for c in result.columns if c.metric == "accuracy")
    assert (column.unit, column.best) == ("%", 91.0)
    assert [(c.value, c.comparable, c.best) for c in column.cells] == [
        (91.0, True, True),
        (0.95, False, False),
        (90.0, True, False),
    ]
    assert cells(result, "Solo") == [(1.0, False)]


def test_rows_without_a_number_or_a_name_are_skipped():
    result = compare([PaperResults(A, [row("X", float("nan")), row("", 1.0), {"value": 2}])])

    assert (result.columns, result.rows) == ([], [])


# --- The API ---------------------------------------------------------------------------------


def results(session: Session, doc, rows: list[dict[str, Any]], review=Review.APPROVED):
    artifact = store(session, doc, ArtifactType.RESULTS_TABLE, None, review, {"rows": rows})
    artifact.input_hash = f"results:{doc.id}"  # the fixture's hash is per type, not per paper
    session.add(artifact)
    session.commit()
    return artifact


def test_compare_joins_papers_through_concept_aliases(client: TestClient, session: Session):
    first, second, third = (add_paper(session, slug=s) for s in ("vaswani", "gehring", "draft"))
    results(session, first, [row("Transformer (big)", 28.4, is_proposed=True)])
    results(
        session,
        second,
        [row("ConvS2S", 25.2, is_proposed=True), row("transformer", 27.0, dataset="WMT14 En-De")],
    )
    results(session, third, [row("Other", 99.0)], review=Review.DRAFT)
    session.add_all(
        [
            Concept(
                canonical="transformer", kind=ConceptKind.METHOD, aliases=["transformer (big)"]
            ),
            Concept(
                canonical="wmt 2014 english-german",
                kind=ConceptKind.DATASET,
                aliases=["wmt 2014 en-de", "wmt14 en-de"],
            ),
            Concept(canonical="convs2s", kind=ConceptKind.DATASET),  # wrong kind: not a method name
        ]
    )
    session.commit()

    response = client.get(f"/api/v1/papers/compare?ids=vaswani,{second.id}&ids=draft")

    assert response.status_code == 200, response.text
    data = response.json()
    assert [
        (p["slug"], p["rows"], p["results_artifact_id"] is not None) for p in data["papers"]
    ] == [("vaswani", 1, True), ("gehring", 2, True), ("draft", 0, False)]
    [column] = data["columns"]
    assert (column["dataset"], column["best"], column["cells"]) == (
        "wmt 2014 english-german",
        28.4,
        3,
    )
    assert data["rows"][0]["cells"][0]["cites"] == [f"{second.id}#ch03/t001"]
    methods = {
        r["method"]: [(c["paper_id"], c["value"], c["best"]) for c in r["cells"]]
        for r in data["rows"]
    }
    assert methods == {
        "ConvS2S": [(str(second.id), 25.2, False)],
        "transformer": [(str(first.id), 28.4, True), (str(second.id), 27.0, False)],
    }


def test_compare_refuses_no_papers_and_names_a_non_paper_missing(
    client: TestClient, session: Session
):
    add_document(session, slug="a-book")

    assert client.get("/api/v1/papers/compare?ids=").status_code == 422
    assert client.get("/api/v1/papers/compare").status_code == 422
    assert client.get("/api/v1/papers/compare?ids=a-book").status_code == 404
