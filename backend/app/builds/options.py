"""A build's options and stops, filled in layers (docs/BUILDS.md §3, §7, §7c): the form,
then the preset, then the settings (`app_settings.build_defaults`); and the preflight a
create or an approve runs over them. `app.builds.service` re-exports what it used to hold.
"""

import re
from collections.abc import Mapping
from dataclasses import asdict
from typing import Any

from pydantic import ValidationError
from sqlmodel import Session

from app.builds.agents import Preset
from app.builds.github import GitHub
from app.builds.preflight import Preflight, Probe, preflight
from app.core.config import get_settings
from app.core.errors import ConflictError
from app.models import Document
from app.models.build import BuildVisibility
from app.models.enums import Genre
from app.schemas.build_options import BuildAdvanced
from app.schemas.build_target import merge_target
from app.schemas.builds import BuildOptions, BuildOptionsInput, BuildStops, BuildStopsInput
from app.services import app_settings
from app.services.errors import InvalidInputError

_NOT_NAME = re.compile(r"[^a-z0-9._-]+")


def suggested_repo_name(document: Document, preset: str | None) -> str:
    """The name a build gets until its plan suggests one: `<paper slug>[-<preset>]`."""
    raw = f"{document.slug}-{preset}" if preset else f"{document.slug}-build"
    return _NOT_NAME.sub("-", raw.lower()).strip("-.")[:100] or "paper-build"


def resolve_options(
    given: BuildOptionsInput, preset: Preset | None, defaults: app_settings.BuildDefaults,
    *, repo_name: str,
) -> BuildOptions:  # fmt: skip
    """The form's options over the preset's stack over the settings. A `local` build
    whose pull request delivery came from the settings (not the form) pushes nowhere, so it
    falls back to `push_main`; one asked for explicitly is refused by the schema. Into an
    existing GitHub repository (§7c) the delivery is `pull_request` unless the form asks
    for `push_main`; what only a new repository has is normalized out by `BuildOptions`."""
    visibility = given.visibility or defaults.visibility
    sent_advanced = given.advanced.changes() if given.advanced else {}
    advanced = {**asdict(defaults.advanced), **sent_advanced}
    target = merge_target({}, given.target.changes() if given.target else {})
    if target.get("kind", "new") != "new":
        if target["kind"] == "github" and "delivery" not in sent_advanced:
            advanced["delivery"] = "pull_request"
    elif visibility is BuildVisibility.LOCAL:
        advanced["delivery"] = "push_main"
    return _validated(
        repo_name=given.repo_name or repo_name,
        visibility=visibility,
        owner=given.owner if given.owner is not None else defaults.owner,
        claude_attribution=_first(given.claude_attribution, defaults.claude_attribution),
        link_paper=_first(given.link_paper, defaults.link_paper),
        stack=given.stack or (preset.stack if preset else None),
        allow_web=_first(given.allow_web, False),
        context=given.context.changes() if given.context else {},
        references=[r.model_dump(mode="json") for r in given.references or []],
        advanced=BuildAdvanced.model_validate(advanced).model_dump(mode="json"),
        target=target,
    )


def _validated(**fields: Any) -> BuildOptions:
    """`BuildOptions` from merged layers; a combination that does not hold is a `422`."""
    try:
        return BuildOptions.model_validate(fields)
    except ValidationError as exc:
        problems = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise InvalidInputError(f"Invalid build options: {problems}", field="body.options") from exc


def merge_options(
    current: Mapping[str, Any], given: BuildOptionsInput | None, *, repo_name: str | None = None
) -> BuildOptions:
    """`current` (stored options) with what `given` sends: plain fields replaced when sent,
    `context`, `advanced` and `target` merged key by key (`merge_target`), `references`
    replaced as a list. `repo_name` names a new repository whose options had none (one
    that was an existing repository's)."""
    if given is None:
        return _validated(**current)
    changes = given.changes()
    merged = {**current, **{k: v for k, v in changes.items() if k not in _NESTED}}
    for key in _NESTED:
        if key in changes:
            merged[key] = {**(current.get(key) or {}), **changes[key]}
    if "target" in changes:
        merged["target"] = merge_target(current.get("target"), changes["target"])
    if not merged.get("repo_name") and repo_name:
        merged["repo_name"] = repo_name
    return _validated(**merged)


_NESTED = ("context", "advanced")


def check_shelf_references(session: Session, options: BuildOptions) -> None:
    """Every shelf reference names a paper on the shelf (`422` otherwise)."""
    for ref in options.references:
        if ref.kind != "shelf":
            continue
        paper = session.get(Document, ref.document_id)
        if paper is None or paper.genre is not Genre.PAPER:
            raise InvalidInputError(
                f"Reference {ref.title!r}: no paper {ref.document_id} on the shelf.",
                field="body.options.references",
            )


def checked_options(
    session: Session, paper: Document, options: BuildOptions, *, probe: Probe | None,
    github: GitHub | None, own: bool = False,
) -> BuildOptions:  # fmt: skip
    """Preflight (`ConflictError` with the failing checks in `details`); an existing
    repository's blank base branch becomes the one the inspection found."""
    check: Preflight = preflight(
        session, paper, visibility=options.visibility, probe=probe, target=options.target,
        github=github, push_main=options.advanced.delivery == "push_main", own=own,
    )  # fmt: skip
    if not check.ready:
        raise ConflictError(
            "This build cannot start yet: " + "; ".join(c.message for c in check.errors),
            [asdict(c) for c in check.errors],
        )
    found = check.inspection.default_branch if check.inspection else None
    if options.target.existing and options.target.base_branch is None and found:
        target = options.target.model_copy(update={"base_branch": found})
        options = options.model_copy(update={"target": target})
    return options


def resolve_stops(
    given: BuildStopsInput, preset: Preset | None, defaults: app_settings.BuildDefaults
) -> BuildStops:
    """The form's stops over the preset's over the settings; minutes capped by the hard cap."""
    from_preset = preset.stops if preset else {}
    minutes = _first(given.max_minutes, from_preset.get("max_minutes"), defaults.max_minutes)
    return BuildStops(
        max_minutes=min(minutes, get_settings().build_hard_cap_minutes),
        max_commits=_first(given.max_commits, from_preset.get("max_commits"),
                           defaults.max_commits),
        max_budget_usd=_first(given.max_budget_usd, from_preset.get("max_budget_usd"),
                              defaults.max_budget_usd),
        done_when=_first(given.done_when, from_preset.get("done_when"), []),
    )  # fmt: skip


def _first(*values: Any) -> Any:
    return next((v for v in values if v is not None), None)


def merge_fields(current: Mapping[str, Any], override: Any) -> dict[str, Any]:
    """`current` with every field the override sets (a pydantic model or None)."""
    return {**current, **(override.model_dump(exclude_none=True) if override else {})}
