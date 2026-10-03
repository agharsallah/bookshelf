# Agents: the contract

An agent package is a system brief for an **agentic run**: Claude Code working with tools,
for minutes to hours, in a workspace of its own, judged by what it leaves behind (commits)
rather than by one JSON answer (docs/BUILDS.md B3). Python owns the run (workspace, tool
allowlist, limits, git remote, pushing); the agent owns the work inside the repository.

```
agents/<name>/
  AGENT.md       frontmatter (name, description) + the brief appended to the system prompt
  meta.yaml      version, tier, base tools
  presets.yaml   starting goals the reader picks from, with default limits
```

Loaded by `backend/app/builds/agents.py` into `AgentPackage` and `Preset`.

## How it differs from a skill

| | Skill (`skills/<name>/`) | Agent (`agents/<name>/`) |
|---|---|---|
| Run | one `claude -p` call, JSON in, JSON out | a long `claude -p --output-format stream-json` session, resumable |
| Tools | none | an explicit `--allowedTools` allowlist, `--permission-mode dontAsk` |
| Output | validated against `schema.json`, stored as an artifact | commits in a git repo, plus a final `BuildReport` JSON block |
| Limits | the job's timeout | minutes, commits, budget, enforced by the watcher; *done when* judged by the agent |
| Input | the selector's JSON, appended as `## Input` | files seeded in the repo (`docs/PAPER.md`, `docs/PLAN.md`) + a kickoff prompt on stdin |

A plan or verdict that fits JSON in, JSON out stays a skill (`plan-build` plans; the
`build-from-paper` agent builds).

## meta.yaml

```yaml
name: build-from-paper      # == directory name; stored in builds.agent
version: 1                  # bump on any AGENT.md or presets change
description: One line for humans.
tier: reason                # explore | distil | reason (app/pipeline/models.py)
base_tools: [Read, Write, Edit, Glob, Grep, TodoWrite]
```

`base_tools` are always allowed. The run adds the git patterns (`Bash(git add:*)`,
`Bash(git commit:*)`, …) and the `Bash(…)` patterns of each toolchain the preset names
(`app/builds/toolchains.py`), and `WebFetch`/`WebSearch` only when the build's `allow_web`
is on. `git push`, `gh` and anything global are never on the list.

## AGENT.md

YAML frontmatter (`name` == directory name, `description`), then the brief, passed as
`--append-system-prompt` with the frontmatter stripped. It states the role, the work loop,
the git and boundary rules, how to judge *done when*, and how to end: the final message
closes with exactly one fenced `json` block that `app/builds/events.py` parses:

```ts
BuildReport { status: 'goal_reached' | 'partial' | 'gave_up',
              done: string[], not_done: string[], next_steps: string[], run_it: string }
```

Run-specific facts (the goal, the limits, the reader's *done when*) go in the kickoff prompt
(`app/builds/prompting.py`), never in AGENT.md: the brief is the same for every run.

## presets.yaml

A YAML list, served as-is by `GET /builds/presets`:

```yaml
- key: minimal-implementation      # unique, kebab-case; stored in builds.preset
  label: Minimal implementation    # the card's title
  description: One sentence on what you get.
  goal: >-                         # editable starting text, 10..4000 chars, no placeholders
    A minimal, readable implementation of this paper's core method…
  stack: PyTorch                   # default BuildOptions.stack, free text
  toolchains: [python]             # python | node | static
  stops:                           # Partial<BuildStops>: the form's defaults
    max_minutes: 90                # 5..720
    max_commits: 15                # 1..200
    max_budget_usd: 10             # 0.5..200, optional
    done_when: [ … ]               # ≤ 10, each ≤ 300 chars, each checkable by running something
```

Write goals generic enough for any paper ("this paper's core method"), and *done when*
items the agent can verify with a command, not taste.

## Adding an agent

1. Create `agents/<name>/` with the three files above.
2. Add any new toolchain to `app/builds/toolchains.py`.
3. A build names its agent in `builds.agent` (default `build-from-paper`); route a new
   kind of build to the new folder there, and document it in docs/BUILDS.md.
