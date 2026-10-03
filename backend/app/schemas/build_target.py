"""Where a build lands (docs/BUILDS.md §7c): a new repository, or a folder of one you have.

    BuildTarget       stored in `builds.options.target`; rows written before §7c lack it and
                      validate as `kind: new`
    BuildTargetInput  the partial form a create or an approve sends (merged key by key over
                      the stored target; a change of `kind` starts from a blank target)
    RepoChoice        one row of `GET /builds/repos`
    RepoSurvey        what the planner and the agent are told about the repository
    TargetInspection  `POST /builds/target/inspect`: the checks preflight runs, and the survey

Validation is strict because these strings reach `git` and `gh` argv and the agent's
`Write(<folder>/**)` rule: the folder is relative and normalized (no `..`, no `.`, no
leading `/`), the branch a valid git ref name, the repo `owner/name`.
"""

import re
from typing import Annotated, Any, ClassVar, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

TargetKind = Literal["new", "github", "local"]
Confine = Literal["warn", "stop"]
ToolchainName = Literal["python", "node", "static"]

GITHUB_REPO = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$")
_FOLDER_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._-]*$")
_REF_CHARS = re.compile(r"^[A-Za-z0-9._/-]+$")
MAX_FOLDER = 200
MAX_BRANCH = 200
MAX_PATH = 1000


def folder_problem(folder: str) -> str | None:
    """Why `folder` is not a safe relative folder, or None."""
    if len(folder) > MAX_FOLDER:
        return f"the folder is longer than {MAX_FOLDER} characters"
    if folder.startswith("/"):
        return "the folder is relative to the repository root: no leading `/`"
    parts = folder.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return "the folder must be normalized: no `..`, no `.`, no empty segment"
    if any(p == ".git" or not _FOLDER_SEGMENT.match(p) for p in parts):
        return (
            "the folder may use letters, digits, `.`, `_` and `-` "
            "(a segment starts with a letter, digit or `_`)"
        )
    return None


def branch_problem(name: str) -> str | None:
    """Why `name` is not a branch name `git check-ref-format --branch` accepts (the subset
    of it this app allows: no spaces or shell-special characters), or None."""
    if len(name) > MAX_BRANCH or not _REF_CHARS.match(name):
        return "a branch name uses letters, digits, `.`, `_`, `-` and `/`"
    if name.startswith(("-", "/", ".")) or name.endswith(("/", ".")) or name == "@":
        return "a branch name cannot start with `-`, `/` or `.`, nor end with `/` or `.`"
    if ".." in name or "@{" in name or "//" in name:
        return "a branch name cannot contain `..`, `@{` or `//`"
    if any(part.startswith(".") or part.endswith(".lock") for part in name.split("/")):
        return "no part of a branch name may start with `.` or end with `.lock`"
    return None


def folder_slug(folder: str) -> str:
    """`papers/attention` → `papers-attention`: the seed commit's scope."""
    return re.sub(r"[^a-z0-9-]+", "-", folder.lower()).strip("-") or "build"


def branch_slug(folder: str) -> str:
    """The default work branch's name part: the folder's last segment, slugged
    (`papers/attention` → `attention`, so `build/attention`)."""
    return folder_slug(folder.rsplit("/", 1)[-1])


def _blank_to_none(value: Any) -> Any:
    return None if isinstance(value, str) and not value.strip() else value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _TargetFields(_Strict):
    """The shared field checks; `BuildTarget` adds the rules between them."""

    repo: Annotated[str, StringConstraints(strip_whitespace=True, max_length=140)] | None = None
    path: Annotated[str, StringConstraints(strip_whitespace=True, max_length=MAX_PATH)] | None = (
        None
    )
    base_branch: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None
    folder: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None
    branch: Annotated[str, StringConstraints(strip_whitespace=True)] | None = None

    @field_validator("repo", "path", "base_branch", "folder", "branch", mode="before")
    @classmethod
    def _blank(cls, value: Any) -> Any:
        return _blank_to_none(value)

    @field_validator("repo")
    @classmethod
    def _repo(cls, value: str | None) -> str | None:
        if value is not None and not GITHUB_REPO.match(value):
            raise ValueError("`repo` is a GitHub repository as `owner/name`")
        return value

    @field_validator("path")
    @classmethod
    def _path(cls, value: str | None) -> str | None:
        if value is not None and (not value.startswith("/") or "\x00" in value):
            raise ValueError("`path` is the absolute path of a git repository on this machine")
        return value.rstrip("/") or "/" if value is not None else None

    @field_validator("folder")
    @classmethod
    def _folder(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.rstrip("/") if len(value) > 1 else value
        if problem := folder_problem(value):
            raise ValueError(problem)
        return value

    @field_validator("base_branch", "branch")
    @classmethod
    def _branch(cls, value: str | None) -> str | None:
        if value is not None and (problem := branch_problem(value)):
            raise ValueError(problem)
        return value


class BuildTarget(_TargetFields):
    """`options.target`. For `github` and `local` the folder is required; `push_branch`
    only means something for `local` (a GitHub branch is always pushed)."""

    kind: TargetKind = "new"
    use_repo_instructions: bool = True
    confine: Confine = "warn"
    push_branch: bool = False

    @model_validator(mode="after")
    def _fits_its_kind(self) -> "BuildTarget":
        if self.kind == "new":
            given = [k for k in ("repo", "path", "base_branch", "folder", "branch")
                     if getattr(self, k) is not None]  # fmt: skip
            if given or self.push_branch:
                raise ValueError(
                    "a new repository takes no "
                    + ", ".join(f"`{k}`" for k in given or ["push_branch"])
                )
            return self
        if self.folder is None:
            raise ValueError("building into an existing repository needs a `folder`")
        if self.kind == "github":
            if self.repo is None or self.path is not None:
                raise ValueError("a GitHub target needs `repo` (`owner/name`) and no `path`")
            if self.push_branch:
                raise ValueError(
                    "`push_branch` is for a local target: a GitHub branch is always pushed"
                )
        elif self.path is None or self.repo is not None:
            raise ValueError("a local target needs an absolute `path` and no `repo`")
        return self

    @property
    def existing(self) -> bool:
        return self.kind != "new"

    @property
    def label(self) -> str:
        """`octo/site`, the local path, or `a new repository`."""
        return self.repo or self.path or "a new repository"


class BuildTargetInput(_TargetFields):
    """A partial target: `changes()` is what was sent (a null clears a field)."""

    NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"repo", "path", "base_branch", "folder", "branch"}
    )

    kind: TargetKind | None = None
    use_repo_instructions: bool | None = None
    confine: Confine | None = None
    push_branch: bool | None = None

    def changes(self) -> dict[str, Any]:
        sent = self.model_dump(mode="json", exclude_unset=True)
        return {k: v for k, v in sent.items() if v is not None or k in self.NULLABLE}


def merge_target(current: dict[str, Any] | None, given: dict[str, Any]) -> dict[str, Any]:
    """`given` (a `BuildTargetInput.changes()`) over `current`; a new `kind` starts blank,
    so switching from GitHub to local does not carry the `repo` along."""
    base = dict(current or {})
    if "kind" in given and given["kind"] != base.get("kind", "new"):
        base = {}
    return {**base, **given}


# --- what the form and the planner see ---------------------------------------------------


class RepoChoice(BaseModel):
    """One repository you can build into (`GET /builds/repos`)."""

    full_name: str
    description: str | None
    visibility: Literal["PUBLIC", "PRIVATE", "INTERNAL"]  # as gh spells it
    default_branch: str | None
    updated_at: str | None
    can_push: bool


class InstructionFile(BaseModel):
    path: str  # relative to the repository root
    text: str  # cut at 8000 characters


class RepoSurvey(BaseModel):
    """The repository at its base branch: the tree to depth 2 (at most 200 entries, folders
    end with `/`), the detected stack, the README excerpt, its own agent instructions."""

    tree: list[str] = Field(default_factory=list)
    stack: list[str] = Field(default_factory=list)
    readme: str | None = None
    instructions: list[InstructionFile] = Field(default_factory=list)
    toolchains: list[ToolchainName] = Field(default_factory=list)


class TargetCheck(BaseModel):
    """A `PreflightCheck` (the same shape `GET /builds/preflight` lists)."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    ok: bool
    level: Literal["error", "warning"]
    message: str
    fix: str | None


class TargetInspection(BaseModel):
    """`ok` when no error is among `problems`. `default_branch` is GitHub's default branch,
    or the branch checked out in a local repository; `folder_*` are read at the base."""

    ok: bool
    problems: list[TargetCheck]
    default_branch: str | None
    branches: list[str]
    folder_exists: bool
    folder_empty: bool
    survey: RepoSurvey | None
