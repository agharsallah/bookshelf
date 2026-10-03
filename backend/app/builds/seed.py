"""The build repository's first commit: README, the paper's ideas, the approved plan.

The render functions are pure (plan dict → markdown); `seed_repo` writes the files it is
given and commits. Which files those are is `app.builds.workspace_files.seed_files`, the
same renderer the context preview uses (docs/BUILDS.md B11).

Whether the paper is named follows `link_paper`: without it neither the README nor the seed
commit mention its title, so an experiment can stay unattributed. The *Built with Claude
Code* line follows `coauthor` (the attribution setting).
"""

from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any

from app.builds.git import Git

_SHORT_TITLE = 50

_GITIGNORE_BASE = [".DS_Store", "*.log", ".env", ".env.*", "!.env.example", ".idea/", ".vscode/"]
_GITIGNORE: dict[str, list[str]] = {
    "python": ["__pycache__/", "*.py[cod]", ".venv/", "venv/", ".pytest_cache/",
               ".mypy_cache/", ".ruff_cache/", "*.egg-info/", "dist/", "build/",
               ".ipynb_checkpoints/", "checkpoints/", "runs/", "wandb/"],
    "node": ["node_modules/", "dist/", ".astro/", ".next/", ".cache/", "coverage/",
             "*.tsbuildinfo", ".pnpm-store/"],
    "rust": ["target/"],
    "go": ["bin/", "*.test", "*.out"],
    "jvm": ["target/", "build/", ".gradle/", "*.class"],
    "c": ["build/", "*.o", "*.a", "*.so", "*.out"],
}  # fmt: skip
_ALIASES = {
    "py": "python", "pytorch": "python", "torch": "python", "jax": "python", "uv": "python",
    "numpy": "python", "js": "node", "ts": "node", "typescript": "node", "javascript": "node",
    "pnpm": "node", "npm": "node", "web": "node", "astro": "node", "cargo": "rust",
    "golang": "go", "java": "jvm", "kotlin": "jvm", "gradle": "jvm", "maven": "jvm",
    "cpp": "c", "c++": "c", "cmake": "c", "make": "c",
}  # fmt: skip


def short_title(title: str, limit: int = _SHORT_TITLE) -> str:
    """The paper title cut at a word boundary (and before a subtitle) for a commit subject."""
    head = title.split(":", 1)[0].strip() or title.strip()
    if len(head) <= limit:
        return head
    cut = head[:limit].rsplit(" ", 1)[0]
    return f"{cut or head[:limit]}…"


def seed_message(title: str, *, link_paper: bool) -> str:
    return (
        f"chore: seed repository from {short_title(title)}"
        if link_paper
        else ("chore: seed repository")
    )


def _milestones(plan: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    raw = plan.get("milestones")
    return [m for m in raw if isinstance(m, Mapping)] if isinstance(raw, list) else []


def _strings(value: Any) -> list[str]:
    return [str(v) for v in value if str(v).strip()] if isinstance(value, list) else []


def _bullets(items: Iterable[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def render_readme(
    *,
    plan: Mapping[str, Any],
    goal: str,
    title: str,
    link_paper: bool,
    coauthor: bool,
    paper_url: str | None = None,
) -> str:
    name = str(plan.get("repo_name") or "").strip() or "Build"
    parts = [f"# {name}", "", goal.strip(), ""]
    if summary := str(plan.get("summary") or "").strip():
        parts += ["## Plan", "", summary, ""]
    if stack := _strings(plan.get("stack")):
        parts += [f"**Stack**: {', '.join(stack)}", ""]
    if milestones := _milestones(plan):
        parts += ["## Milestones", ""]
        parts += [f"- [ ] {m.get('title', '')}" for m in milestones]
        parts += ["", "The full plan is in [docs/PLAN.md](docs/PLAN.md).", ""]
    footer = []
    if link_paper:
        ref = f"[{title}]({paper_url})" if paper_url else title
        footer.append(f"Paper: {ref}. Its core ideas are in [docs/PAPER.md](docs/PAPER.md).")
    if coauthor:
        footer.append(
            f"Built with [Claude Code](https://claude.com/claude-code) from {title}."
            if link_paper
            else "Built with [Claude Code](https://claude.com/claude-code)."
        )
    if footer:
        parts += ["---", "", *(f"{line}\n" for line in footer)]
    return "\n".join(parts).rstrip() + "\n"


_FEEDBACK_CHARS = 120


def plan_heading(
    version: int, *, origin: str, based_on: int | None = None, feedback: str | None = None
) -> str:
    """Which plan version PLAN.md is (docs/BUILDS.md §7b): `Plan v1 (drafted)`,
    `Plan v2 (replanned from v1: "<feedback>")`, `Plan v3 (edited by you, from v2)`."""
    if origin == "human":
        how = f"edited by you, from v{based_on}" if based_on else "edited by you"
    elif based_on is None:
        how = "drafted"
    else:
        how = f"replanned from v{based_on}"
        if text := " ".join((feedback or "").split()):
            cut = text if len(text) <= _FEEDBACK_CHARS else f"{text[: _FEEDBACK_CHARS - 1]}…"
            how += f': "{cut}"'
    return f"Plan v{version} ({how})"


def render_plan(plan: Mapping[str, Any], *, goal: str, heading: str | None = None) -> str:
    """PLAN.md; `heading` (`plan_heading`) names the version under the title."""
    parts = [
        "# Plan",
        "",
        *([f"_{heading}_", ""] if heading else []),
        f"**Goal**: {goal.strip()}",
        "",
    ]
    if summary := str(plan.get("summary") or "").strip():
        parts += [summary, ""]
    if stack := _strings(plan.get("stack")):
        parts += ["## Stack", "", _bullets(stack), ""]
    milestones = _milestones(plan)
    if milestones:
        parts += ["## Milestones", ""]
    for number, m in enumerate(milestones, 1):
        parts += [f"### {number}. {m.get('title', '')}", ""]
        if m.get("commit"):
            parts.append(f"- **Commit**: `{m['commit']}`")
        if m.get("deliverable"):
            parts.append(f"- **Deliverable**: {m['deliverable']}")
        if m.get("done_when"):
            parts.append(f"- **Done when**: {m['done_when']}")
        parts.append("")
    layout = [e for e in plan.get("layout") or [] if isinstance(e, Mapping)]
    if layout:
        parts += ["## Layout", "", "| Path | Purpose |", "|---|---|"]
        parts += [f"| `{e.get('path', '')}` | {e.get('purpose', '')} |" for e in layout]
        parts.append("")
    for key, heading in (("out_of_scope", "Out of scope"), ("risks", "Risks")):
        if items := _strings(plan.get(key)):
            parts += [f"## {heading}", "", _bullets(items), ""]
    return "\n".join(parts).rstrip() + "\n"


def toolchain_family(name: str) -> str | None:
    key = name.strip().lower()
    return key if key in _GITIGNORE else _ALIASES.get(key)


def render_gitignore(toolchains: Sequence[str]) -> str:
    families = sorted({f for t in toolchains if (f := toolchain_family(t)) is not None})
    lines = ["# Editors and OS", *_GITIGNORE_BASE]
    for family in families:
        lines += ["", f"# {family}", *_GITIGNORE[family]]
    return "\n".join(lines) + "\n"


def seed_repo(
    git: Git, files: Mapping[str, str], *, title: str, link_paper: bool, coauthor: bool
) -> str:
    """Write `files` (path → text) into `git.cwd` and make the first commit. → its sha."""
    root = Path(git.cwd)
    for relative, text in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text if text.endswith("\n") else f"{text}\n", "utf-8")
    return git.commit_all(seed_message(title, link_paper=link_paper), coauthor=coauthor)
