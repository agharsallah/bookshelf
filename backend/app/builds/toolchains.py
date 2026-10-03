"""What a build agent may run (docs/BUILDS.md B5): `--allowedTools` patterns.

    base tools (meta.yaml)  Read, Write, Edit…
    BASE_BASH               local git and read-only shell, for every build (no `find`:
                            `-exec`/`-delete` reach past the repo; Glob and Grep search)
    TOOLCHAINS[name]        a preset's language tooling (python, node, static)
    WEB_TOOLS               only when the build allows the web
    extra commands          `options.advanced.extra_commands` → `Bash(<cmd>:*)` (B14), checked
                            here twice: by the schema, and again when the argv is built

Nothing here reaches GitHub or deletes recursively: no `git push`, no `gh`, no `curl`,
no `rm`. The runner, not the agent, creates the repo and pushes.
"""

from collections.abc import Iterable

BASE_BASH: tuple[str, ...] = (
    "Bash(git add:*)",
    "Bash(git commit:*)",
    "Bash(git status:*)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
    "Bash(git mv:*)",
    "Bash(git rm:*)",
    "Bash(ls:*)",
    "Bash(mkdir:*)",
    "Bash(cat:*)",
    "Bash(head:*)",
    "Bash(tail:*)",
    "Bash(wc:*)",
    "Bash(rg:*)",
)

TOOLCHAINS: dict[str, tuple[str, ...]] = {
    "python": (
        "Bash(uv:*)",
        "Bash(python:*)",
        "Bash(python3:*)",
        "Bash(pytest:*)",
    ),
    "node": (
        "Bash(pnpm:*)",
        "Bash(node:*)",
        "Bash(npx:*)",
    ),
    "static": ("Bash(python3 -m http.server:*)",),
}

WEB_TOOLS: tuple[str, ...] = ("WebFetch", "WebSearch")

# Defence in depth: a pattern containing one of these never reaches `--allowedTools`.
FORBIDDEN: tuple[str, ...] = ("git push", "gh ", "Bash(gh", "curl", "wget", "rm -rf", "Bash(rm")


# Commands an extra command may neither be nor open the way to: `git` would allow `git push`.
DENIED_COMMANDS: tuple[str, ...] = (
    "git push", "git remote", "git config", "gh", "curl", "wget", "rm", "sudo", "ssh", "scp",
    "rsync", "nc", "chmod", "chown", "dd", "eval", "exec", "sh", "bash", "zsh",
)  # fmt: skip


class UnknownToolchainError(ValueError):
    """A preset names a toolchain this module does not define."""


def extra_pattern(command: str) -> str:
    return f"Bash({' '.join(command.split())}:*)"


def extra_command_problem(command: str) -> str | None:
    """Why `command` cannot be an extra command, or None. A pattern hitting `FORBIDDEN`, a
    denied command, or a prefix of one (`git`, `r`) is refused."""
    words = " ".join(command.split())
    pattern = extra_pattern(words)
    denied = next(
        (d for d in DENIED_COMMANDS
         if words == d or words.startswith(f"{d} ") or d.startswith(words)),
        None,
    )  # fmt: skip
    if any(f in pattern for f in FORBIDDEN) or denied is not None:
        return (
            f"extra command {command!r} is not allowed: the agent never pushes, calls GitHub, "
            "reaches the network or deletes recursively"
            + (f" (it would allow `{denied}`)" if denied and denied != words else "")
        )
    return None


def allowed_tools(
    base_tools: Iterable[str],
    toolchains: Iterable[str],
    allow_web: bool,
    extra_commands: Iterable[str] = (),
) -> list[str]:
    """The agent's allowlist, in order, each pattern once. Raises `UnknownToolchainError`,
    or `ValueError` for a forbidden pattern or extra command."""
    patterns = [*base_tools, *BASE_BASH]
    for name in toolchains:
        if name not in TOOLCHAINS:
            raise UnknownToolchainError(f"unknown toolchain {name!r}")
        patterns.extend(TOOLCHAINS[name])
    for command in extra_commands:  # defence in depth: the schema checked them already
        if problem := extra_command_problem(command):
            raise ValueError(problem)
        patterns.append(extra_pattern(command))
    if allow_web:
        patterns.extend(WEB_TOOLS)
    unique = list(dict.fromkeys(patterns))
    if bad := [p for p in unique if any(f in p for f in FORBIDDEN)]:
        raise ValueError(f"forbidden tool patterns: {', '.join(bad)}")
    return unique
