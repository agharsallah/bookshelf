"""A small parsed paper, as `paper_structure` leaves it: roles on the top-level sections, an
abstract unit, a skipped bibliography, `paper_meta` and `paper_references` with `cited_at`.

Helpers, not fixtures, so paper test modules import only what they use.
"""

from typing import Any

from sqlmodel import Session

from app.models import Artifact, Document, PaperMeta, PaperReference
from app.models.enums import ArtifactType, DocumentStatus, Genre, NodeKind, Origin, Review
from tests.pipeline.runtime.conftest import add_document, add_nodes, body, paragraph

ATTENTION_LATEX = r"\mathrm{Attention}(Q, K, V) = \mathrm{softmax}(QK^T / \sqrt{d_k}) V"

# (anchor, kind, text-or-heading, meta), in reading order.
PAPER: list[tuple[str, NodeKind, str, dict[str, Any]]] = [
    ("fm01", NodeKind.CHAPTER, "Abstract", {"role": "abstract"}),
    ("fm01/p001", NodeKind.PARAGRAPH, "We propose a model based solely on attention.", {}),
    ("ch01", NodeKind.CHAPTER, "1 Introduction", {"role": "introduction"}),
    ("ch01/p001", NodeKind.PARAGRAPH, "Recurrent models compute along symbol positions.", {}),
    ("ch01/p002", NodeKind.PARAGRAPH, "This sequential nature precludes parallelization [1].", {}),
    ("ch02", NodeKind.CHAPTER, "2 Model Architecture", {"role": "method"}),
    ("ch02/p001", NodeKind.PARAGRAPH, "The encoder maps symbols to representations.", {}),
    ("ch02/s01", NodeKind.SECTION, "2.1 Scaled Dot-Product Attention", {}),
    ("ch02/s01/p001", NodeKind.PARAGRAPH, "We compute attention on a set of queries.", {}),
    ("ch02/s01/m001", NodeKind.MATH, ATTENTION_LATEX, {"latex": ATTENTION_LATEX}),
    ("ch02/s01/f001", NodeKind.FIGURE, "Figure 1: The attention function", {"image_path": "f.png"}),
    ("ch03", NodeKind.CHAPTER, "3 Results", {"role": "results"}),
    ("ch03/p001", NodeKind.PARAGRAPH, "The big model reaches 28.4 BLEU on English-German [2].", {}),
    (
        "ch03/t001",
        NodeKind.TABLE,
        "Model | BLEU",
        {"header": ["Model", "BLEU"], "rows": [["Big", "28.4"]]},
    ),
    ("bm01", NodeKind.CHAPTER, "References", {"role": "references", "skip": True}),
    ("bm01/p001", NodeKind.PARAGRAPH, "[1] Hochreiter and Schmidhuber. LSTM. 1997.", {}),
]
UNITS = ["ch01", "ch02", "ch03"]
ELEMENTS = {"ch02/s01/m001", "ch02/s01/f001", "ch03/t001"}


def add_paper(
    session: Session,
    *,
    slug: str = "vaswani-attention",
    status: DocumentStatus = DocumentStatus.PARSED,
    nodes: list[tuple[str, NodeKind, str, dict[str, Any]]] | None = None,
) -> Document:
    """A paper with its tree, `paper_meta` and two cited references."""
    doc = add_document(session, slug=slug, status=status)
    doc.genre = Genre.PAPER
    session.add(doc)
    session.commit()
    add_nodes(session, doc, PAPER if nodes is None else nodes)
    session.add(
        PaperMeta(
            document_id=doc.id,
            doi="10.48550/arxiv.1706.03762",
            arxiv_id="1706.03762",
            venue="NeurIPS",
            year=2017,
            abstract="We propose a model based solely on attention.",
            cited_by_count=100_000,
            code_urls=["https://github.com/tensorflow/tensor2tensor"],
        )
    )
    session.add_all(
        [
            PaperReference(document_id=doc.id, ordinal=1, anchor="bm01/p001",
                           raw="Hochreiter and Schmidhuber. LSTM. 1997.", cited_at=["ch01/p002"]),
            PaperReference(document_id=doc.id, ordinal=2, raw="Wu et al. GNMT. 2016.",
                           cited_at=["ch03/p001"]),
        ]
    )  # fmt: skip
    session.commit()
    session.refresh(doc)
    return doc


def without_elements() -> list[tuple[str, NodeKind, str, dict[str, Any]]]:
    return [n for n in PAPER if n[0] not in ELEMENTS]


def store(
    session: Session,
    doc: Document,
    kind: ArtifactType,
    anchor: str | None,
    review: Review = Review.DRAFT,
    content: dict[str, Any] | None = None,
    version: int = 1,
) -> Artifact:
    artifact = Artifact(
        document_id=doc.id, anchor=anchor, type=kind, version=version, origin=Origin.SKILL,
        skill="t", skill_version="1", input_hash=f"{kind}{anchor}{review}", review=review,
        body=content if content is not None else body(paragraph("x", "ch01/p001")),
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact
