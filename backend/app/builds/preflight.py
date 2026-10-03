"""Preflight (docs/BUILDS.md B10): what a build needs, checked before anything is created.

Each check is a small function over a `Probe` (find a binary, run a command), so tests fake
the machine. A failing `error` blocks the build; a failing `warning` only says what the repo
will lack. Every failing check carries a human `message` and an actionable `fix`.

    tools     claude_cli · git_cli · git_identity · [gh_cli · gh_auth · gh_scope] · workspace
    target    an existing repository (§7c): `targets.target_checks` (target_repo,
              target_permission, target_archived / target_path, target_worktree, then
              target_base, target_branch, target_folder); a local one skips the gh checks
    paper     paper_card (error without a card, warning for a draft) · claims · results ·
              explainer (warnings)

The machine checks run commands, so with the real probe they are cached for `CACHE_SECONDS`
per process: the form asks again on every visibility change.
"""

import os
import re
import shutil
import subprocess
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from sqlmodel import Session

from app.builds import targets
from app.builds.checks import Level, PreflightCheck, failed, passed
from app.builds.context import PaperBrief, missing_context, paper_brief
from app.builds.github import GhCli, GitHub
from app.core.config import Settings, get_settings
from app.models import Document
from app.models.build import BuildVisibility
from app.schemas.build_target import BuildTarget, TargetInspection

__all__ = ["Level", "Preflight", "PreflightCheck", "Probe", "preflight"]
CACHE_SECONDS = 60.0
_TIMEOUT = 10.0
_SCOPES = re.compile(r"Token scopes:\s*(.*)", re.IGNORECASE)
_GIT_IDENTITY_FIX = (
    'git config --global user.name "Your Name" && git config --global user.email "you@example.com"'
)
_CLAUDE_FIX = (
    "Install Claude Code (https://claude.com/claude-code), then run `claude` once to sign in."
)
_GH_FIX = "Install it (https://cli.github.com), or choose visibility `local`."
_NO_CARD = "This paper has no card yet: there is nothing to build from."
_NO_CARD_FIX = "Run Dissect on the paper, then approve the paper card in Review."
_DRAFT_CARD = "The paper card is a draft: the build would use unreviewed text."
_DRAFT_FIX = "Approve the paper card in Review."


class Probe(Protocol):
    def which(self, binary: str) -> str | None: ...

    def run(self, argv: Sequence[str], timeout: float) -> tuple[int, str, str]: ...


class RealProbe:
    """The machine this process runs on."""

    def which(self, binary: str) -> str | None:
        return shutil.which(binary)

    def run(self, argv: Sequence[str], timeout: float) -> tuple[int, str, str]:
        try:
            done = subprocess.run(  # noqa: S603 - argv from settings, never a shell
                list(argv), capture_output=True, text=True, timeout=timeout, check=False
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return 127, "", str(exc)
        return done.returncode, done.stdout, done.stderr


@dataclass(frozen=True, slots=True)
class Preflight:
    checks: list[PreflightCheck]
    inspection: TargetInspection | None = None  # an existing repository's (§7c)

    @property
    def ready(self) -> bool:
        """No failing error."""
        return all(c.ok or c.level == "warning" for c in self.checks)

    @property
    def errors(self) -> list[PreflightCheck]:
        return [c for c in self.checks if not c.ok and c.level == "error"]


_ok, _fail = passed, failed


# --- machine checks ------------------------------------------------------------------------


def check_binary(probe: Probe, key: str, binary: str, name: str, fix: str) -> PreflightCheck:
    path = probe.which(binary)
    if path is None:
        return _fail(key, f"{name} (`{binary}`) is not installed or not on PATH.", fix)
    return _ok(key, f"{name} found at {path}.")


def check_git_identity(probe: Probe, git: str) -> PreflightCheck:
    fix = _GIT_IDENTITY_FIX
    if probe.which(git) is None:
        return _fail("git_identity", "git is needed to commit the build.", fix)
    values = {}
    for field in ("user.name", "user.email"):
        code, out, _ = probe.run([git, "config", "--global", field], _TIMEOUT)
        values[field] = out.strip() if code == 0 else ""
    if missing := [f for f, v in values.items() if not v]:
        return _fail(
            "git_identity", f"git has no {' or '.join(missing)}: commits need an author.", fix
        )
    return _ok(
        "git_identity",
        f"Commits will be authored by {values['user.name']} <{values['user.email']}>.",
    )


def _gh_status(probe: Probe, gh: str) -> tuple[int, str]:
    code, out, err = probe.run([gh, "auth", "status"], _TIMEOUT)
    return code, f"{out}\n{err}"


def check_gh_auth(code: int) -> PreflightCheck:
    if code != 0:
        return _fail("gh_auth", "The GitHub CLI is not signed in.", "! gh auth login")
    return _ok("gh_auth", "The GitHub CLI is signed in.")


def token_scopes(status: str) -> set[str] | None:
    """The classic token's scopes from `gh auth status`, or None when it lists none
    (a fine-grained token, or an older gh): then the repo creation itself will tell."""
    match = _SCOPES.search(status)
    if match is None:
        return None
    return {s.strip().strip("'\"") for s in match.group(1).split(",") if s.strip()}


def check_gh_scope(code: int, status: str) -> PreflightCheck:
    fix = "gh auth refresh -s repo"
    if code != 0:
        return _fail("gh_scope", "Sign in to the GitHub CLI first.", fix)
    scopes = token_scopes(status)
    if scopes is not None and "repo" not in scopes:
        shown = ", ".join(sorted(scopes)) or "none"
        return _fail("gh_scope", f"The GitHub token lacks the `repo` scope (has: {shown}).", fix)
    return _ok("gh_scope", "The GitHub token can create and push repositories.")


def check_workspace(folder: Path) -> PreflightCheck:
    fix = f"mkdir -p {folder}  (or set BOOKSHELF_BUILD_WORKSPACE to a writable folder)"
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return _fail("workspace", f"Cannot create the build workspace {folder}: {exc}.", fix)
    if not os.access(folder, os.W_OK | os.X_OK):
        return _fail("workspace", f"The build workspace {folder} is not writable.", fix)
    return _ok("workspace", f"Builds go to {folder}.")


def machine_checks(probe: Probe, settings: Settings, *, github: bool) -> list[PreflightCheck]:
    checks = [
        check_binary(probe, "claude_cli", settings.claude_bin, "Claude Code", _CLAUDE_FIX),
        check_binary(probe, "git_cli", settings.git_bin, "git", "Install git (https://git-scm.com)."),
        check_git_identity(probe, settings.git_bin),
    ]  # fmt: skip
    if github:
        gh = check_binary(probe, "gh_cli", settings.gh_bin, "The GitHub CLI", _GH_FIX)
        code, status = _gh_status(probe, settings.gh_bin) if gh.ok else (127, "")
        checks += [gh, check_gh_auth(code), check_gh_scope(code, status)]
    checks.append(check_workspace(settings.build_workspace))
    return checks


_cache: dict[tuple[object, ...], tuple[float, list[PreflightCheck]]] = {}
_cache_lock = threading.Lock()


def cached_machine_checks(
    settings: Settings, *, github: bool, clock: Callable[[], float] = time.monotonic
) -> list[PreflightCheck]:
    """`machine_checks` with the real probe, remembered for `CACHE_SECONDS`."""
    key = (settings.claude_bin, settings.git_bin, settings.gh_bin, settings.build_workspace, github)
    now = clock()
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    checks = machine_checks(RealProbe(), settings, github=github)
    with _cache_lock:
        _cache[key] = (now, checks)
    return checks


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


# --- paper checks ---------------------------------------------------------------------------

_PAPER_WARNINGS = {
    "claims": ("No claims extracted yet: PAPER.md will have no claims section.",
               "Run extract-claims from the Claims tab, then approve the claim set in Review."),
    "results": ("No results table with the paper's own numbers yet.",
                "Run extract-results from the Results tab."),
    "explainer": ("No explainer yet: PAPER.md will lack the intuition and the key equations.",
                  "Run Simplify in the Explain tab."),
}  # fmt: skip


def paper_checks(brief: PaperBrief) -> list[PreflightCheck]:
    missing = set(missing_context(brief))
    if brief.card is None:
        card = _fail("paper_card", _NO_CARD, _NO_CARD_FIX)
    elif "paper_card" in missing:
        card = _fail("paper_card", _DRAFT_CARD, _DRAFT_FIX, level="warning")
    else:
        card = _ok("paper_card", "The paper card is approved.")
    checks = [card]
    for key, (message, fix) in _PAPER_WARNINGS.items():
        checks.append(
            _fail(key, message, fix, level="warning")
            if key in missing
            else _ok(
                key,
                f"The {key} are in." if key != "explainer" else "An explainer is in.",
                "warning",
            )
        )
    return checks


def preflight(
    session: Session,
    document: Document,
    *,
    visibility: BuildVisibility,
    probe: Probe | None = None,
    settings: Settings | None = None,
    target: BuildTarget | None = None,
    github: GitHub | None = None,
    push_main: bool = False,
    own: bool = False,
) -> Preflight:
    """Every check for building `document` with `visibility` (`local` skips GitHub), or into
    `target` (§7c: a local repository skips GitHub; `github` is the client the target is
    inspected with, the real `gh` when None; `own`: the branch and folder may be this
    build's already)."""
    settings = settings or get_settings()
    existing = target is not None and target.existing
    if existing and target is not None:
        uses_github = target.kind == "github"
    else:
        uses_github = visibility is not BuildVisibility.LOCAL
    machine = (
        machine_checks(probe, settings, github=uses_github)
        if probe is not None
        else cached_machine_checks(settings, github=uses_github)
    )
    target_checks: list[PreflightCheck] = []
    inspection = None
    if existing and target is not None:
        client = github if github is not None or not uses_github else GhCli(settings.gh_bin)
        target_checks, inspection = targets.target_checks(
            target, github=client, git_bin=settings.git_bin, push_main=push_main, own=own,
            with_survey=False,
        )  # fmt: skip
    paper = paper_checks(paper_brief(session, document))
    return Preflight(checks=[*machine, *target_checks, *paper], inspection=inspection)
