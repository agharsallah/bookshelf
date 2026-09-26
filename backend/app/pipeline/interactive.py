"""Interactive mode (§7 "No API key"): import skill outputs made in a Claude Code session.

An interactive SKILL.md fetches `GET /skills/{name}/inputs` (the exact batch inputs and
their `input_hash`), does the work with you, and writes

    {"skill": "...", "document": "<slug|id>", "anchor": "...", "input_hash": "...", "output": {...}}

plus `"params": {...}` for a skill with run parameters (the same ones the inputs were
fetched with).

to `skills/.outbox/`. Importing re-selects the inputs, refuses a stale `input_hash`, and runs
the same gates as batch mode; the artifact is stored with `run_mode = interactive`.

    uv run python -m app.pipeline.interactive import ../skills/.outbox/*.json
"""

import argparse
import json
import sys
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.audio import narration
from app.audio.speech import default_cast, speaker_count
from app.core.config import get_settings
from app.jobs import queue
from app.models import Artifact
from app.models.enums import RunMode
from app.pipeline import artifacts, execution
from app.pipeline.runner import OutputError
from app.pipeline.selectors import SelectorError
from app.pipeline.skills import ParamError, load_catalogue


class UnknownSkillError(LookupError):
    pass


class UnknownDocumentError(LookupError):
    pass


class InputsChangedError(ValueError):
    """The inputs moved on since the interactive session fetched them."""


def import_output(
    session: Session,
    *,
    skill: str,
    document: str,
    anchor: str | None,
    input_hash: str,
    output: dict[str, Any],
    note_id: uuid.UUID | None = None,
    params: dict[str, Any] | None = None,
    model: str | None = None,
    force: bool = False,
    skills_dir: Path | None = None,
) -> Artifact:
    """Gate and store one interactive result. Raises on unknown refs, stale inputs, gate
    failures (`OutputError`), or an existing artifact for this input (unless `force`)."""
    package = load_catalogue(skills_dir or get_settings().skills_dir).get(skill)
    if package is None:
        raise UnknownSkillError(f"no skill named {skill!r}")
    doc = execution.find_document(session, document)
    if doc is None:
        raise UnknownDocumentError(f"no document {document!r}")
    prepared = execution.prepare(session, package, doc, anchor, note_id=note_id, params=params)
    if prepared.input_hash != input_hash:
        raise InputsChangedError(
            "input_hash does not match the current inputs; re-fetch "
            f"/skills/{skill}/inputs and redo the work (current: {prepared.input_hash})"
        )
    problems = execution.output_problems(prepared, output)
    if problems:
        raise OutputError(problems)
    artifact = execution.build_artifact(
        session, prepared, output, run_mode=RunMode.INTERACTIVE, model=model
    )
    artifact = artifacts.insert(session, artifact, supersede=force)
    if package.meta.narrate:  # voiced with the default cast; the Listen page recasts it
        cast = default_cast(speaker_count(artifact.body), str(prepared.params.get("language")))
        queue.enqueue(session, narration.narrate_spec(artifact, cast))
    return artifact


def import_file(session: Session, path: Path, *, skills_dir: Path | None = None) -> Artifact:
    envelope = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(envelope, dict) or not isinstance(envelope.get("output"), dict):
        shape = "{skill, document, anchor, input_hash, output}"
        raise OutputError([f"{path.name}: expected {shape}"])
    note_id = envelope.get("note_id")
    return import_output(
        session,
        skill=str(envelope.get("skill")),
        document=str(envelope.get("document")),
        anchor=envelope.get("anchor"),
        input_hash=str(envelope.get("input_hash")),
        output=envelope["output"],
        note_id=uuid.UUID(str(note_id)) if note_id else None,
        params=envelope.get("params") if isinstance(envelope.get("params"), dict) else None,
        model=envelope.get("model"),
        force=bool(envelope.get("force")),
        skills_dir=skills_dir,
    )


IMPORT_ERRORS = (
    UnknownSkillError,
    UnknownDocumentError,
    InputsChangedError,
    OutputError,
    SelectorError,
    artifacts.ArtifactExistsError,
    ParamError,
    json.JSONDecodeError,
    OSError,
    ValueError,
)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.pipeline.interactive")
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="import skills/.outbox/*.json results")
    importer.add_argument("files", nargs="+", type=Path)
    args = parser.parse_args(argv)

    from app.db.session import engine  # deferred: `--help` needs no database

    failures = 0
    with Session(engine) as session:
        for path in args.files:
            try:
                artifact = import_file(session, path)
            except IMPORT_ERRORS as exc:
                session.rollback()
                failures += 1
                print(f"FAIL {path}: {exc}", file=sys.stderr)
                continue
            summary = f"{artifact.type.value} v{artifact.version} ({artifact.review.value})"
            print(f"ok   {path}: {summary}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
