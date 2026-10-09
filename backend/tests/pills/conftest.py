"""DB fixtures for the pills tests: a small book whose units cover the skill examples."""

from typing import Any

import pytest
from sqlmodel import Session

from app.models import Document
from app.models.enums import NodeKind
from tests.api.factories import make_document, make_node


def make_shelf_book(session: Session, **overrides: Any) -> Document:
    """ch01..ch06, each with a paragraph; ch03 has s01 (p004, f001 with a crop) and s03."""
    document = make_document(session, **overrides)
    for i in range(1, 7):
        chapter = make_node(session, document, f"ch0{i}", NodeKind.CHAPTER, ordinal=i * 100)
        make_node(
            session,
            document,
            f"ch0{i}/p001",
            NodeKind.PARAGRAPH,
            parent=chapter,
            ordinal=i * 100 + 1,
        )
        if i == 3:
            s01 = make_node(
                session, document, "ch03/s01", NodeKind.SECTION, parent=chapter, ordinal=302
            )
            make_node(
                session, document, "ch03/s01/p004", NodeKind.PARAGRAPH, parent=s01, ordinal=303
            )
            make_node(
                session,
                document,
                "ch03/s01/f001",
                NodeKind.FIGURE,
                parent=s01,
                ordinal=304,
                meta={"caption": "Figure 3.1", "image_path": "book/ch03-f001.png"},
            )
    return document


@pytest.fixture
def book(session: Session) -> Document:
    return make_shelf_book(session, title="Queueing for Managers")
