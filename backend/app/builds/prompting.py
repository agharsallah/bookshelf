"""What the build agent is told, and how its `claude` process is started (docs/BUILDS.md §5).

`kickoff_prompt` is the first user turn (stdin): the goal, the approved plan, the stops and
the working rules (shaped by `options.advanced`: commit style, tests, the branch of a pull
request delivery, the reader's extra instructions). `agent_argv` is the CLI line. The agent
gets no network and no GitHub: `dontAsk` denies every tool not on `--allowedTools`, and
neither `git push` nor `gh` is on it (B5). Its budget is enforced by the CLI itself
(`--max-budget-usd`, B6); minutes and commits by the watcher (`app.builds.watch`).
"""

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from app.builds.toolchains import FORBIDDEN
from app.core.config import Effort

REPORT_KEYS = ("status", "done", "not_done", "next_steps", "run_it")

_COMMITS = {
    "milestone": """\
- Work through the milestones in order. Commit after each milestone, or after any smaller
  step that stands on its own, with a Conventional Commit message (`feat(model): …`,
  `fix: …`, `test: …`, `docs: …`, `chore: …`). Use the milestone's commit message when it
  fits.""",
    "small": """\
- Work through the milestones in order, in small commits: every step that stands on its
  own is its own commit, several per milestone, each a Conventional Commit (`feat(model): …`,
  `fix: …`, `test: …`, `docs: …`, `chore: …`). The milestone's commit message goes on the
  commit that finishes it.""",
}
_TESTS = {
    "each_milestone": """\
- Run the code and its tests before every commit. Never commit something you have not run.
  Every milestone adds or extends a test for what it builds.""",
    "smoke": """\
- Run the code and its tests before every commit. Never commit something you have not run.
  Tests stay at one fast smoke test or check that the whole thing runs: no test per
  milestone, the reader asked for less.""",
    "none": """\
- Run the code before every commit. Never commit something you have not run. Write no
  test suite: the reader asked for none (a plan's test milestone becomes a run check).""",
}
_RULES = """\
- Keep it minimal: the smallest code that meets the goal clearly. No speculative features,
  no extra frameworks.
- Keep README.md's milestone checklist current: tick a milestone (`- [x]`) in the commit
  that finishes it.
- Never push, never add a git remote, never call GitHub. The runner publishes your commits.
- Stay inside this repository. Do not read or write files outside it."""
_PLAN_LATER = "_The plan is drafted after you start: its summary and milestones go here._"

_REPORT = """\
## When you finish

Stop when the goal is reached and every *done when* criterion holds, or when you cannot
make further progress. Then end your last message with exactly one fenced `json` block,
a BuildReport:

```json
{"status": "goal_reached | partial | gave_up",
 "done": ["what works now"],
 "not_done": ["what is missing"],
 "next_steps": ["what to do next"],
 "run_it": "the commands that run it, e.g. `uv run python train.py`"}
```"""


class BuildLike(Protocol):
    goal: str
    options: Any
    stops: Any


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """Read `key` from a dict or a pydantic/dataclass object."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _milestone_lines(plan: Mapping[str, Any]) -> list[str]:
    lines = []
    milestones = plan.get("milestones") or []
    for number, m in enumerate(m for m in milestones if isinstance(m, Mapping)):
        lines.append(f"{number + 1}. **{m.get('title', '')}**, commit `{m.get('commit', '')}`")
        if m.get("deliverable"):
            lines.append(f"   - Deliverable: {m['deliverable']}")
        if m.get("done_when"):
            lines.append(f"   - Done when: {m['done_when']}")
    return lines


def stop_lines(stops: Any) -> list[str]:
    lines = []
    if minutes := _get(stops, "max_minutes"):
        lines.append(f"- Time: at most {minutes} minutes; the run is stopped after that.")
    if commits := _get(stops, "max_commits"):
        lines.append(f"- Commits: at most {commits}; the run is stopped after that many.")
    if (budget := _get(stops, "max_budget_usd")) is not None:
        lines.append(f"- Budget: at most ${float(budget):.2f} of model usage.")
    done_when = [str(c) for c in _get(stops, "done_when") or [] if str(c).strip()]
    if done_when:
        lines.append("- You are done when all of these hold:")
        lines += [f"  - {criterion}" for criterion in done_when]
    return lines


def _advanced(options: Any, key: str, default: Any) -> Any:
    value = _get(_get(options, "advanced") or {}, key, default)
    return default if value is None else value


def _reading_list(options: Any) -> str:
    """The files to read first: the paper and the plan, then what the reader added."""
    lines = ["- Read first: `docs/PAPER.md` (the paper's core ideas) and `docs/PLAN.md` (the "
             "full plan)."]  # fmt: skip
    refs = list(_get(options, "references") or [])
    if refs:
        files = any(_get(r, "kind") == "shelf" or _get(r, "snapshot") for r in refs)
        where = ", their text under `docs/references/`" if files else ""
        lines.append(f"- `docs/REFERENCES.md` lists the reader's references{where}: use them "
                     "where the plan needs more than the paper says.")  # fmt: skip
    if str(_get(_get(options, "context") or {}, "notes") or "").strip():
        lines.append("- `docs/NOTES.md` holds the reader's notes: they outrank the plan's "
                     "defaults, never these rules.")  # fmt: skip
    if _advanced(options, "license", "none") != "none":
        lines.append("- `LICENSE` is the reader's choice: keep it as it is.")
    return "\n".join(lines)


def work_rules(options: Any, *, branch: str | None = None) -> str:
    """`## How to work`, shaped by `options.advanced` (commit style, tests) and the branch."""
    commits = _COMMITS.get(_advanced(options, "commit_style", "milestone"), _COMMITS["milestone"])
    tests = _TESTS.get(_advanced(options, "tests", "each_milestone"), _TESTS["each_milestone"])
    parts = ["## How to work", "", commits, tests, _RULES]
    if branch:
        parts.append(f"- You work on the branch `{branch}`: stay on it. Never switch, create "
                     "or merge branches; the runner opens the pull request.")  # fmt: skip
    parts.append(_reading_list(options))
    return "\n".join(parts)


def kickoff_prompt(
    build: BuildLike,
    plan: Mapping[str, Any] | None,
    stops: Any,
    *,
    resume_goal: str | None = None,
    branch: str | None = None,
) -> str:
    """The first user message. With `resume_goal` (Continue), a shorter follow-up turn: the
    session already holds the plan and the rules, so it restates only what changed. Without
    a plan (a preview before planning) the plan section says it comes later."""
    if resume_goal is not None:
        parts = [
            "# Continue the build",
            "",
            resume_goal.strip() or "Carry on from where you stopped.",
            "",
            "Check `git log` and README.md's checklist for where you are. The same rules",
            "apply: Conventional Commits, run before you commit, never push.",
            "",
            "## Stop conditions",
            "",
            *stop_lines(stops),
            "",
            _REPORT,
        ]
        return "\n".join(parts).rstrip() + "\n"
    options = _get(build, "options")
    stack = _get(options, "stack")
    parts = ["# Build", "", "## Goal", "", build.goal.strip(), ""]
    if stack:
        parts += [f"Stack: {stack}.", ""]
    if plan is None:
        plan = {}
        parts += ["## Plan", "", _PLAN_LATER, ""]
    if summary := str(plan.get("summary") or "").strip():
        parts += ["## Plan", "", summary, ""]
    if tools := [str(s) for s in plan.get("stack") or []]:
        parts += [f"Libraries and languages: {', '.join(tools)}.", ""]
    if milestones := _milestone_lines(plan):
        parts += ["## Milestones", "", *milestones, ""]
    if out := [str(s) for s in plan.get("out_of_scope") or []]:
        parts += ["## Out of scope", "", *(f"- {s}" for s in out), ""]
    parts += ["## Stop conditions", "", *stop_lines(stops), "", work_rules(options, branch=branch)]
    if instructions := str(_advanced(options, "instructions", "") or "").strip():
        parts += ["", "## Extra instructions from the reader", "", instructions]
    parts += ["", _REPORT]
    return "\n".join(parts).rstrip() + "\n"


def settings_json(*, coauthor: bool) -> str:
    """`--settings`: the `Co-Authored-By` trailer only when attribution is on. With it off
    the commit attribution text is emptied too (newer CLIs read `attribution.commit`)."""
    settings: dict[str, Any] = {"includeCoAuthoredBy": coauthor}
    if not coauthor:
        settings["attribution"] = {"commit": ""}
    return json.dumps(settings, separators=(",", ":"))


def agent_argv(
    cli: str,
    model: str,
    *,
    session_id: str,
    resume: bool,
    allowed_tools: Sequence[str],
    brief: str,
    budget: float | None,
    coauthor: bool,
    effort: Effort | str | None = None,
) -> list[str]:
    """The `claude` command line for one build turn (a fresh session, or `--resume`).
    A forbidden pattern on the allowlist is refused here once more (defence in depth)."""
    if bad := [t for t in allowed_tools if any(f in t for f in FORBIDDEN)]:
        raise ValueError(f"forbidden tool patterns: {', '.join(bad)}")
    argv = [cli, "-p", "--model", model]
    if effort:
        argv += ["--effort", str(effort.value if isinstance(effort, Effort) else effort)]
    argv += ["--output-format", "stream-json", "--verbose"]
    argv += ["--resume", session_id] if resume else ["--session-id", session_id]
    argv += [
        "--safe-mode",
        "--strict-mcp-config",
        "--permission-mode", "dontAsk",
        "--permission-prompts", "none",
        "--allowedTools", *allowed_tools,
        "--settings", settings_json(coauthor=coauthor),
        "--append-system-prompt", brief,
    ]  # fmt: skip
    if budget is not None:
        argv += ["--max-budget-usd", f"{float(budget):g}"]
    return argv
