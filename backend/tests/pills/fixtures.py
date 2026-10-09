"""Shared builders for the pills tests: real skill outputs (`skills/*/example.json`) and a
harvest context whose units cover their anchors."""

import json
import uuid
from functools import cache
from typing import Any

from app.core.config import REPO_ROOT
from app.models.enums import ArtifactType, Genre
from app.pills.harvest import HarvestContext, HarvestInput, SourceArtifact, Unit

CONTRACTS = REPO_ROOT / "contracts"
DOC_ID = uuid.UUID("6f1c2a7e-3b4d-4c5e-8f90-1a2b3c4d5e6f")
UNITS = tuple(Unit(f"ch0{i}", f"Chapter {i}") for i in range(1, 7))


@cache
def _example(skill: str) -> str:
    return (REPO_ROOT / "skills" / skill / "example.json").read_text(encoding="utf-8")


def example(skill: str) -> dict[str, Any]:
    """A fresh copy of the skill's example output."""
    return json.loads(_example(skill))


def pill_examples() -> dict[str, dict[str, Any]]:
    return json.loads((CONTRACTS / "pill.examples.json").read_text(encoding="utf-8"))["examples"]


def context(**overrides: Any) -> HarvestContext:
    fields: dict[str, Any] = {
        "document_id": DOC_ID,
        "slug": "okafor-queueing",
        "genre": Genre.BOOK,
        "units": UNITS,
    }
    return HarvestContext(**(fields | overrides))


def source(
    type: ArtifactType, body: dict[str, Any], *, anchor: str | None = None, **overrides: Any
) -> SourceArtifact:
    fields: dict[str, Any] = {
        "id": uuid.UUID(int=7),
        "type": type,
        "anchor": anchor,
        "variant": None,
        "body": body,
        "draft": False,
        "skill_version": "1",
    }
    return SourceArtifact(**(fields | overrides))


def harvest_input(
    type: ArtifactType, body: dict[str, Any], *, anchor: str | None = None, **ctx: Any
) -> HarvestInput:
    return HarvestInput(context(**ctx), source(type, body, anchor=anchor))


def api_examples() -> dict[str, dict[str, Any]]:
    """One body per pills API response (`api` in contracts/pill.examples.json)."""
    return json.loads((CONTRACTS / "pill.examples.json").read_text(encoding="utf-8"))["api"]
