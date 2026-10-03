"""How a build's agent is started, worked out once for the runner and the context view (B11).

resolve_toolchains(agent, build)  `advanced.toolchains`, else the preset's, else inferred
                                  from the plan's and the form's stack; for an existing
                                  repository (§7c) the survey's toolchains join the last two
resolve_model / resolve_effort    `advanced.model` / `.effort`, `auto` = the agent's tier
branch_of(options)                `build/<repo_name>` for a pull request delivery; for an
                                  existing repository its work branch (`targets.work_branch`)
repo_context(options, surveyed)   the kickoff's view of an existing repository
launch_spec(build, agent, …)      the argv, the kickoff prompt and what went into them
elide_brief(argv)                 the argv with the agent brief replaced, for display
"""

from dataclasses import dataclass
from typing import Any

from app.builds.agents import AgentPackage
from app.builds.prompting import RepoContext, agent_argv, kickoff_prompt
from app.builds.seed import toolchain_family
from app.builds.targets import NO_SURVEY, Surveyed, work_branch
from app.builds.toolchains import TOOLCHAINS, allowed_tools
from app.core.config import Settings
from app.models.build import Build, BuildVisibility
from app.pipeline.models import cli_alias, cli_effort
from app.schemas.builds import BuildOptions

BRIEF_PLACEHOLDER = "<agent brief>"
_BRIEF_FLAG = "--append-system-prompt"


@dataclass(frozen=True, slots=True)
class LaunchSpec:
    argv: list[str]
    prompt: str
    model: str
    effort: str
    allowed_tools: list[str]
    toolchains: list[str]
    branch: str | None


def options_of(build: Build) -> BuildOptions:
    return BuildOptions.model_validate(build.options)


def resolve_toolchains(
    agent: AgentPackage, build: Build, surveyed: Surveyed = NO_SURVEY
) -> list[str]:
    options = options_of(build)
    if options.advanced.toolchains is not None:
        return list(dict.fromkeys(options.advanced.toolchains))
    preset = agent.preset(build.preset)
    if preset is not None:
        chosen = list(preset.toolchains)
    else:
        stack = [*(build.plan or {}).get("stack", []), options.stack or ""]
        words = {w.strip("+,").lower() for item in stack for w in str(item).split()}
        chosen = sorted({f for w in words if (f := toolchain_family(w)) in TOOLCHAINS})
    found = surveyed.survey.toolchains if surveyed.survey else []
    return list(dict.fromkeys([*chosen, *sorted(found)]))


def resolve_model(agent: AgentPackage, options: BuildOptions, settings: Settings) -> str:
    chosen = options.advanced.model
    return cli_alias(agent.tier, settings) if chosen == "auto" else chosen


def resolve_effort(agent: AgentPackage, options: BuildOptions, settings: Settings) -> str:
    chosen = options.advanced.effort
    return cli_effort(agent.tier, settings).value if chosen == "auto" else chosen


def branch_of(options: BuildOptions) -> str | None:
    """The branch the agent works on: a GitHub build delivered as a pull request, or any
    build into an existing repository (its base itself for a GitHub `push_main`)."""
    if options.target.existing:
        push_main = options.advanced.delivery == "push_main"
        return work_branch(options.target, options.target.base_branch, push_main=push_main)
    if options.visibility is BuildVisibility.LOCAL:
        return None
    return f"build/{options.repo_name}" if options.advanced.delivery == "pull_request" else None


def repo_context(options: BuildOptions, surveyed: Surveyed) -> RepoContext | None:
    target = options.target
    if not target.existing or target.folder is None:
        return None
    delivery = "branch" if target.kind == "local" else options.advanced.delivery
    return RepoContext(kind=target.kind, label=target.label, folder=target.folder,  # type: ignore[arg-type]
                       base=target.base_branch or surveyed.base, delivery=delivery,
                       survey_md=surveyed.markdown)  # fmt: skip


def launch_spec(
    build: Build,
    agent: AgentPackage,
    settings: Settings,
    *,
    session_id: str,
    resume: bool = False,
    budget: float | None = None,
    resume_goal: str | None = None,
    stops: Any = None,
    surveyed: Surveyed = NO_SURVEY,
) -> LaunchSpec:
    """Everything the agent's process is started with. `resume_goal` (Continue) makes the
    short follow-up prompt; a build without a plan gets the "drafted later" placeholder.
    `surveyed` is the existing repository's survey (§7c), from `targets.survey_for`."""
    options = options_of(build)
    toolchains = resolve_toolchains(agent, build, surveyed)
    tools = allowed_tools(
        agent.base_tools,
        toolchains,
        options.allow_web,
        options.advanced.extra_commands,
        folder=options.target.folder,
    )
    model = resolve_model(agent, options, settings)
    effort = resolve_effort(agent, options, settings)
    branch = branch_of(options)
    argv = agent_argv(
        settings.claude_bin, model, session_id=session_id, resume=resume,
        allowed_tools=tools, brief=agent.brief, budget=budget,
        coauthor=options.claude_attribution, effort=effort,
    )  # fmt: skip
    prompt = kickoff_prompt(build, build.plan, build.stops if stops is None else stops,
                            resume_goal=resume_goal, branch=branch,
                            repository=repo_context(options, surveyed))  # fmt: skip
    return LaunchSpec(argv=argv, prompt=prompt, model=model, effort=effort,
                      allowed_tools=tools, toolchains=toolchains, branch=branch)  # fmt: skip


def elide_brief(argv: list[str]) -> list[str]:
    """`argv` with the `--append-system-prompt` value shown as `<agent brief>`."""
    out = list(argv)
    if _BRIEF_FLAG in out and out.index(_BRIEF_FLAG) + 1 < len(out):
        out[out.index(_BRIEF_FLAG) + 1] = BRIEF_PLACEHOLDER
    return out
