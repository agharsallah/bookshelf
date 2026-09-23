"""Fixtures for the distillation runtime: a small book, tmp skill packages, body builders.

Skill packages are written to `tmp_path`, so these tests never depend on the real
`skills/` content (which evolves independently); only the render contract is shared.
"""

import json
import uuid
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.pipeline import get_skills_dir
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.main import create_app
from app.models import Document, Job, Node
from app.models.enums import DocumentKind, DocumentStatus, JobKind, NodeKind
from app.pipeline.gates import RENDER_BLOCKS_ID

SKILL_MD = """---
name: {name}
description: test skill
argument-hint: <document-slug> <anchor>
---

<!-- interactive:start -->
## Interactive use
curl the inputs endpoint, then write to skills/.outbox/.
<!-- interactive:end -->

## Method
Distil faithfully.

Output only the JSON object. No prose, no code fences.
"""

ELEMENT_SCHEMA = {
    "type": "object",
    "required": ["blocks", "confidence"],
    "properties": {
        "blocks": {"$ref": f"{RENDER_BLOCKS_ID}#/$defs/blocks"},
        "takeaway": {"$ref": f"{RENDER_BLOCKS_ID}#/$defs/span"},
        "confidence": {"$ref": f"{RENDER_BLOCKS_ID}#/$defs/confidence"},
    },
}

# name -> meta overrides. Every skill defaults to the render contract `{blocks}`.
SKILLS: dict[str, dict[str, Any]] = {
    "describe-figure": {
        "job_kind": "describe_figure",
        "artifact_type": "figure_description",
        "scope": "block",
        "selector": "element_context",
        "tier": "explore",
        "vision": True,
        "schema": ELEMENT_SCHEMA,
    },
    "explain-code": {
        "job_kind": "explain_code",
        "artifact_type": "code_explanation",
        "scope": "block",
        "selector": "element_context",
        "tier": "explore",
        "schema": ELEMENT_SCHEMA,
    },
    "summarize": {
        "job_kind": "summarize",
        "artifact_type": "chapter_summary",
        "scope": "chapter",
        "selector": "scope_blocks",
        "tier": "explore",
    },
    "distil-section": {
        "job_kind": "distil_section",
        "artifact_type": "section_note",
        "scope": "section",
        "selector": "scope_blocks",
        "tier": "distil",
    },
    "distil-chapter": {
        "job_kind": "distil_chapter",
        "artifact_type": "chapter_distillation",
        "scope": "chapter",
        "selector": "chapter_section_notes",
        "tier": "distil",
    },
    "structure-note": {
        "job_kind": "structure_note",
        "artifact_type": "structured_note",
        "scope": "note",
        "selector": "note_context",
        "tier": "explore",
    },
    "make-quiz": {
        "job_kind": "derive",
        "artifact_type": "quiz",
        "scope": "chapter",
        "selector": "scope_blocks",
        "tier": "distil",
    },
    "parse-outline": {
        "artifact_type": "outline_override",
        "scope": "document",
        "selector": "outline_pages",
        "tier": "explore",
        "schema": {"type": "object"},
    },
}


def write_skill(root: Path, name: str, **meta: Any) -> Path:
    directory = root / name
    directory.mkdir(parents=True, exist_ok=True)
    schema = meta.pop("schema", {"$ref": RENDER_BLOCKS_ID})
    full = {"name": name, "version": 1, "description": f"{name} (test)", **meta}
    (directory / "meta.yaml").write_text(yaml.safe_dump(full), encoding="utf-8")
    (directory / "SKILL.md").write_text(SKILL_MD.format(name=name), encoding="utf-8")
    (directory / "schema.json").write_text(json.dumps(schema), encoding="utf-8")
    return directory


@pytest.fixture
def skills_dir(tmp_path: Path) -> Path:
    root = tmp_path / "skills"
    for name, meta in SKILLS.items():
        write_skill(root, name, **dict(meta))
    return root


@pytest.fixture
def api(skills_dir: Path) -> Iterator[TestClient]:
    """The real app, reading skill packages from the tmp `skills_dir`."""
    app = create_app()
    app.dependency_overrides[get_skills_dir] = lambda: skills_dir
    with TestClient(app) as client:
        yield client


# --- Body builders ---------------------------------------------------------------------


def span(text: str, *cites: str) -> dict[str, Any]:
    return {"text": text, "cites": list(cites)}


def paragraph(text: str, *cites: str) -> dict[str, Any]:
    return {"type": "paragraph", "spans": [span(text, *cites)]}


def body(*blocks: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {"blocks": list(blocks), **extra}


def reply(value: dict[str, Any]) -> str:
    return json.dumps(value)


# --- A small book ----------------------------------------------------------------------

# (anchor, kind, text-or-heading, meta). Parents are implied by the anchor path.
BOOK: list[tuple[str, NodeKind, str, dict[str, Any]]] = [
    ("ch01", NodeKind.CHAPTER, "Stocks and flows", {}),
    ("ch01/s01", NodeKind.SECTION, "Stocks", {}),
    ("ch01/s01/p001", NodeKind.PARAGRAPH, "A stock is the memory of the history of flows.", {}),
    ("ch01/s01/f001", NodeKind.FIGURE, "Figure 1.1 A bathtub", {"image_path": "f001.png"}),
    ("ch01/s02", NodeKind.SECTION, "Flows", {}),
    ("ch01/s02/p001", NodeKind.PARAGRAPH, "Flows change stocks over time at some rate.", {}),
    ("ch02", NodeKind.CHAPTER, "Feedback", {}),
    ("ch02/p001", NodeKind.PARAGRAPH, "Balancing loops seek a goal and resist change.", {}),
    ("ch02/c001", NodeKind.CODE, "while level < goal:\n    level += inflow", {}),
    ("bm01", NodeKind.PART, "Bibliography", {"skip": True}),
    ("bm01/p001", NodeKind.PARAGRAPH, "Forrester, J. Industrial Dynamics.", {}),
]


def add_document(
    session: Session,
    *,
    slug: str = "meadows-systems",
    status: DocumentStatus = DocumentStatus.PARSED,
) -> Document:
    doc = Document(
        kind=DocumentKind.PDF,
        slug=slug,
        title=slug.replace("-", " ").title(),
        authors=["Donella Meadows"],
        year=2008,
        source_path=f"library/{slug}.pdf",
        sha256=uuid.uuid4().hex * 2,
        page_count=10,
        status=status,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)
    return doc


def add_nodes(
    session: Session, doc: Document, spec: list[tuple[str, NodeKind, str, dict[str, Any]]]
) -> dict[str, Node]:
    nodes: dict[str, Node] = {}
    for ordinal, (anchor, kind, content, meta) in enumerate(spec):
        parent = nodes.get(anchor.rsplit("/", 1)[0]) if "/" in anchor else None
        node = Node(
            document_id=doc.id,
            parent_id=parent.id if parent else None,
            anchor=anchor,
            kind=kind,
            ordinal=ordinal,
            depth=anchor.count("/"),
            heading=content if kind.is_container else None,
            text=None if kind.is_container else content,
            page_from=1 + ordinal // 4,
            page_to=1 + ordinal // 4,
            meta=meta,
        )
        session.add(node)
        session.flush()
        nodes[anchor] = node
    session.commit()
    return nodes


@pytest.fixture
def book(session: Session) -> Document:
    doc = add_document(session)
    add_nodes(session, doc, BOOK)
    return doc


@pytest.fixture
def make_job(session: Session) -> Callable[..., Job]:
    def make(kind: JobKind, doc: Document, anchor: str | None = None, **payload: Any) -> Job:
        job = queue.enqueue(
            session, JobSpec(kind=kind, document_id=doc.id, anchor=anchor, payload=payload)
        )
        assert job is not None
        return job

    return make


@pytest.fixture
def other_book(session: Session) -> Document:
    doc = add_document(session, slug="senge-fifth-discipline")
    add_nodes(session, doc, BOOK)
    return doc
