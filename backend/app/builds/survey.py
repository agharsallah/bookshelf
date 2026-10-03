"""What a build is told about an existing repository (docs/BUILDS.md B20, B21).

    survey_local(path, base_branch=…)     from the git object store at the base branch, never
                                          the working tree (your uncommitted work is yours)
    survey_github(gh, full_name, base)    through `gh api` (the tree, then each file), no clone
    render_survey_md(survey, …)           the one markdown the planner input, the kickoff and
                                          the context view's Repository tab all show

A survey is the tree to depth 2 (at most 200 entries, folders end with `/`), the stack
detected from file names (pyproject.toml, package.json, Cargo.toml… to depth 3), the README
excerpt (≤ 4000 chars), and the repository's own agent instructions (CLAUDE.md, AGENTS.md at
the root and in each parent of the target folder, .github/copilot-instructions.md; ≤ 8000
chars each). Both sources reduce to `(type, path)` entries plus a `read(path)`, so one pure
function (`survey_from`) builds it.
"""

from collections.abc import Callable, Iterable
from pathlib import Path

from app.builds.git import Git, GitError
from app.builds.github import GitHub
from app.schemas.build_target import InstructionFile, RepoSurvey

TREE_DEPTH = 2
TREE_LIMIT = 200
STACK_DEPTH = 3
README_CHARS = 4000
INSTRUCTION_CHARS = 8000
INSTRUCTION_NAMES = ("CLAUDE.md", "AGENTS.md")
ROOT_INSTRUCTIONS = (".github/copilot-instructions.md",)

# file name → (stack label, toolchain or None)
_MARKERS: dict[str, tuple[str, str | None]] = {
    "pyproject.toml": ("Python", "python"), "requirements.txt": ("Python", "python"),
    "setup.py": ("Python", "python"), "uv.lock": ("uv", "python"),
    "poetry.lock": ("Poetry", "python"), "environment.yml": ("Conda", "python"),
    "package.json": ("Node", "node"), "pnpm-lock.yaml": ("pnpm", "node"),
    "package-lock.json": ("npm", "node"), "yarn.lock": ("Yarn", "node"),
    "pnpm-workspace.yaml": ("pnpm workspace (monorepo)", "node"),
    "turbo.json": ("Turborepo (monorepo)", "node"), "nx.json": ("Nx (monorepo)", "node"),
    "lerna.json": ("Lerna (monorepo)", "node"), "tsconfig.json": ("TypeScript", "node"),
    "deno.json": ("Deno", None), "Cargo.toml": ("Rust", None), "go.mod": ("Go", None),
    "pom.xml": ("Maven", None), "build.gradle": ("Gradle", None),
    "build.gradle.kts": ("Gradle", None), "CMakeLists.txt": ("CMake", None),
    "Makefile": ("Make", None), "Gemfile": ("Ruby", None), "composer.json": ("PHP", None),
    "Dockerfile": ("Docker", None), "docker-compose.yml": ("Docker Compose", None),
}  # fmt: skip
_PREFIX_MARKERS: dict[str, tuple[str, str | None]] = {
    "astro.config.": ("Astro", "node"), "vite.config.": ("Vite", "node"),
    "next.config.": ("Next.js", "node"), "svelte.config.": ("Svelte", "node"),
}  # fmt: skip

Entries = list[tuple[str, str]]  # (type `blob` | `tree`, path)
Read = Callable[[str], str | None]


def _depth(path: str) -> int:
    return path.count("/") + 1


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else f"{text[: limit - 1].rstrip()}…"


def survey_tree(entries: Entries) -> list[str]:
    """The entries to depth 2, folders with a trailing `/`, sorted, at most 200."""
    shown = sorted(f"{path}/" if kind == "tree" else path
                   for kind, path in entries if _depth(path) <= TREE_DEPTH)  # fmt: skip
    return shown[:TREE_LIMIT]


def detect_stack(paths: Iterable[str]) -> tuple[list[str], list[str]]:
    """Stack labels (`Python (backend/pyproject.toml)`) and toolchains from file names."""
    labels: list[str] = []
    toolchains: set[str] = set()
    names = [p for p in paths if _depth(p) <= STACK_DEPTH]
    for path in sorted(names, key=lambda p: (_depth(p), p)):
        name = path.rsplit("/", 1)[-1]
        found = _MARKERS.get(name) or next(
            (v for prefix, v in _PREFIX_MARKERS.items() if name.startswith(prefix)), None
        )
        if found is None:
            continue
        label, toolchain = found
        labels.append(f"{label} ({path})")
        if toolchain:
            toolchains.add(toolchain)
    if "index.html" in names and not toolchains:
        labels.append("Static site (index.html)")
        toolchains.add("static")
    return labels, sorted(toolchains)


def instruction_paths(files: set[str], folder: str | None) -> list[str]:
    """CLAUDE.md / AGENTS.md at the root and in each parent folder of `folder`, then the
    root-only ones, as far as the repository has them."""
    parts = folder.split("/")[:-1] if folder else []
    dirs = [""] + ["/".join(parts[: i + 1]) + "/" for i in range(len(parts))]
    wanted = [f"{d}{name}" for d in dirs for name in INSTRUCTION_NAMES]
    wanted += list(ROOT_INSTRUCTIONS)
    return [p for p in wanted if p in files]


def survey_from(entries: Entries, read: Read, *, folder: str | None = None) -> RepoSurvey:
    """The survey of a repository given its entries and a way to read one file."""
    files = {path for kind, path in entries if kind == "blob"}
    stack, toolchains = detect_stack(files)
    readme_path = next((p for p in sorted(files) if "/" not in p
                        and p.lower() in ("readme.md", "readme")), None)  # fmt: skip
    readme = read(readme_path) if readme_path else None
    instructions = []
    for path in instruction_paths(files, folder):
        if (text := read(path)) is not None and text.strip():
            instructions.append(InstructionFile(path=path, text=_cut(text, INSTRUCTION_CHARS)))
    return RepoSurvey(
        tree=survey_tree(entries), stack=stack,
        readme=_cut(readme, README_CHARS) if readme and readme.strip() else None,
        instructions=instructions, toolchains=toolchains,  # type: ignore[arg-type]
    )  # fmt: skip


def survey_local(
    path: Path | str, *, base_branch: str, folder: str | None = None, git_bin: str = "git"
) -> RepoSurvey:
    """A local repository at `base_branch`, read from git's object store. Raises
    `GitError` when the branch cannot be read."""
    git = Git(git_bin, Path(path))
    ref = f"refs/heads/{base_branch}"
    if not git.ref_exists(ref):
        raise GitError(f"no branch {base_branch!r} in {path}")
    return survey_from(git.ls_tree(ref), lambda p: git.show_file(ref, p), folder=folder)


def survey_github(
    gh: GitHub, full_name: str, base_branch: str, *, folder: str | None = None
) -> RepoSurvey:
    """A GitHub repository at `base_branch`, through the API (no clone)."""
    return survey_from(
        gh.tree(full_name, base_branch),
        lambda p: gh.file(full_name, p, base_branch),
        folder=folder,
    )


# --- markdown -----------------------------------------------------------------------------


def _fence(text: str, lang: str = "") -> list[str]:
    ticks = "```"
    while ticks in text:
        ticks += "`"
    return [f"{ticks}{lang}", text.rstrip(), ticks]


def render_survey_md(
    survey: RepoSurvey,
    *,
    where: str,
    base_branch: str | None,
    folder: str | None,
    instructions: bool = True,
) -> str:
    """The survey as the planner and the agent read it. With `instructions`, the
    repository's own instruction files follow in full under *This repository's
    conventions*; without, they are only named."""
    at = f" at `{base_branch}`" if base_branch else ""
    parts = ["# Repository", "", f"`{where}`{at}."]
    if folder:
        parts += ["", f"The build goes in `{folder}/`; everything else is read-only context."]
    parts += ["", "## Detected stack", ""]
    parts += [f"- {label}" for label in survey.stack] or ["- Nothing recognised from file names."]
    parts += ["", f"## Tree (to depth {TREE_DEPTH}, at most {TREE_LIMIT} entries)", ""]
    parts += _fence("\n".join(survey.tree) or "(empty)", "text")
    if survey.readme:
        parts += ["", "## README (excerpt)", "", *_fence(survey.readme, "markdown")]
    if survey.instructions and instructions:
        parts += ["", "## This repository's conventions", "",
                  "Its own instruction files, read as they are on the base branch. Follow them "
                  "for style, layout and tooling inside the folder; the build's rules outrank "
                  "them."]  # fmt: skip
        for item in survey.instructions:
            parts += ["", f"### `{item.path}`", "", *_fence(item.text, "markdown")]
    elif survey.instructions:
        names = ", ".join(f"`{i.path}`" for i in survey.instructions)
        parts += ["", f"Instruction files found (not used for this build): {names}."]
    return "\n".join(parts).rstrip() + "\n"
