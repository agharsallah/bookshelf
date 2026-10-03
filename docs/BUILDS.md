# Builds — from a paper to a repository

**Status**: building · **Date**: 2026-10-03 · **Extends**: [PAPERS.md](PAPERS.md), [ARCHITECTURE.md](ARCHITECTURE.md)

A paper's **Build** tab turns what the shelf already knows about a paper (its card, claims,
results, explainer) into a fresh git repository, then lets a Claude Code agent build what you
asked for in it: *"a minimal PyTorch transformer for learning"*, *"an interactive website
explaining attention"*. You read and approve a plan first; the agent then works milestone by
milestone and commits each step as a Conventional Commit. You set the stopping conditions:
time, commits, budget, and your own *done when* criteria.

---

## 1. Decisions

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| B1 | **Two phases: plan, then build** | You check what will be built before anything gets created or pushed | `build_plan` (a utility skill, single-shot JSON) and `build_run` (agentic) are separate jobs |
| B2 | **The plan is a utility skill** (`skills/plan-build`) | It fits the skill contract exactly: JSON in, validated JSON out, no tools | It runs inline through `run_structured`, like `synthesize-papers` |
| B3 | **The build is an *agent package*, not a skill** (`agents/<name>/`) | An agentic run has tools, a long life and no output schema; the skill contract does not fit it | `agents/<name>/AGENT.md + meta.yaml + presets.yaml`, loaded by `app/builds/agents.py`. New agent kinds are new folders |
| B4 | **The CLI stays the runtime** (D18) | No API key; the subscription covers the cost | `claude -p --output-format stream-json`, detached, with its NDJSON output streamed to a file |
| B5 | **The agent never touches the network or GitHub** | A controlled experiment, and no credentials for the model | `--permission-mode dontAsk` plus an explicit `--allowedTools` allowlist; `git push` and `gh` are not on it. The **runner** creates the repo and pushes |
| B6 | **Stops are enforced outside the model** | A model can talk itself past a limit | Budget → `--max-budget-usd`; minutes and commits → the watcher kills the process group. *Done when* criteria are the only stops the agent judges for itself |
| B7 | **The workspace lives outside this repo** | `claude` reads every parent CLAUDE.md; a nested repo would also confuse git | `BOOKSHELF_BUILD_WORKSPACE`, default `~/.bookshelf/builds/<build-id>/` |
| B8 | **The repo carries the paper's ideas, not its apparatus** | The user asked for the core ideas only: no citations, no anchors | `app/builds/context.py` writes `docs/PAPER.md` from the card, claims, results and explainer, with every `cites` stripped |
| B9 | **GitHub is optional** | Some experiments should stay local | Visibility `private` (default), `public` or `local` (no remote) |
| B10 | **Preflight before anything** | Missing `gh` auth or an unapproved card should be said up front, with the fix | `GET /builds/preflight` lists checks; errors block the build, warnings don't |

---

## 2. Lifecycle

```
POST /papers/{ref}/builds ──► planning ──(build_plan job)──► planned ──approve──► building ──► done
                                 │                              │  ▲                 │   │
                                 └──────► failed ◄──────────────┘  └─ replan / edit  │   └─► stopped (a limit, or you)
                                                                                     └─────► failed
done | stopped ──continue──► building   (same session: claude --resume)
```

States (`BuildState`): `planning · planned · building · stopping · done · stopped · failed`.
`stop_reason` (`StopReason`): `goal_reached · max_minutes · max_commits · max_budget · user ·
agent_gave_up · error`.

---

## 3. Data

Migration `supabase/migrations/<ts>_builds.sql`. RLS is on and there are no policies, as for
every other table.

```sql
create table builds (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents on delete cascade,
  agent         text not null default 'build-from-paper',   -- agents/<name>
  preset        text,                                       -- presets.yaml key, or null (free)
  goal          text not null check (length(goal) between 10 and 4000),
  options       jsonb not null,   -- BuildOptions (below)
  stops         jsonb not null,   -- BuildStops (below)
  plan          jsonb,            -- BuildPlan (skills/plan-build/schema.json)
  plan_origin   text check (plan_origin in ('skill', 'human')),
  plan_feedback text,             -- the last "replan with this feedback"
  state         text not null default 'planning' check (state in (...BuildState)),
  stop_reason   text check (stop_reason in (...StopReason)),
  stop_requested boolean not null default false,
  repo_url      text,             -- https://github.com/<owner>/<name>, null when local
  workspace     text,             -- absolute path of the git checkout
  session_id    uuid,             -- the claude session, for --resume
  commits       jsonb not null default '[]',  -- [{sha, subject, at}], oldest first
  events        jsonb not null default '[]',  -- the last 200 BuildEvent, oldest first
  report        jsonb,            -- BuildReport, the agent's final word
  cost_usd      numeric(10, 4),
  error         text,
  plan_job_id   uuid references jobs on delete set null,
  run_job_id    uuid references jobs on delete set null,
  started_at    timestamptz, finished_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- index on document_id; touch_updated_at trigger; RLS on.
```

`jobs_kind_check` gains `build_plan` and `build_run`. `build_run` is an `own_slot_kinds()` kind and runs on
its own single-slot runner (like `narrate`), so it never holds a skill CLI slot.

### JSON shapes (pydantic in `app/schemas/builds.py`, TS mirror in `lib/api/types/builds.ts`)

```ts
BuildOptions  { repo_name: string            // ^[A-Za-z0-9._-]{1,100}$
                visibility: 'private' | 'public' | 'local'
                owner: string | null         // org or user; null = the gh account
                claude_attribution: boolean  // Co-Authored-By trailer on commits (default off)
                link_paper: boolean          // README names and links the paper
                stack: string | null         // "PyTorch", "Astro + D3"… free text, the preset's default
                allow_web: boolean }         // WebFetch/WebSearch for the agent (default false)

BuildStops    { max_minutes: int (5..720, default 90)
                max_commits: int (1..200, default 30)
                max_budget_usd: number | null (0.5..200)   // null: no cap
                done_when: string[] (≤ 10, each ≤ 300 chars) }

BuildPlan     { summary: string                    // two or three sentences
                stack: string[]                    // languages, libraries
                repo_name: string                  // suggestion
                milestones: [{ title, commit: "feat(model): …", deliverable, done_when }]  // 3..12
                layout: [{ path, purpose }]        // the files the repo will have
                out_of_scope: string[]
                risks: string[]
                questions: string[] }              // what the planner would ask you; may be []

BuildEvent    { at: iso, kind: 'text' | 'tool' | 'commit' | 'system' | 'error', text: string }

BuildReport   { status: 'goal_reached' | 'partial' | 'gave_up',
                done: string[], not_done: string[], next_steps: string[], run_it: string }

BuildPublic   { id, document_id, agent, preset, goal, options, stops, plan, plan_origin,
                plan_feedback, state, stop_reason, stop_requested, repo_url, commits,
                events, report, cost_usd, error, plan_job_id, run_job_id,
                started_at, finished_at, created_at, updated_at, elapsed_seconds }
BuildSummary  = BuildPublic without plan, events, report   // list rows

Preset        { key, label, description, goal, stack, toolchains: string[],
                stops: Partial<BuildStops> }

PreflightCheck { key, ok: boolean, level: 'error' | 'warning', message, fix: string | null }
Preflight      { ready: boolean /* no failing error */, checks: PreflightCheck[] }
```

---

## 4. API (`/api/v1`)

| Method | Path | Body → result | Notes |
|---|---|---|---|
| GET | `/builds/presets` | → `Preset[]` | from `agents/build-from-paper/presets.yaml` |
| GET | `/builds/preflight?document=<ref>&visibility=` | → `Preflight` | `visibility=local` skips the gh checks |
| GET | `/papers/{ref}/builds` | → `BuildSummary[]`, newest first | |
| POST | `/papers/{ref}/builds` | `{goal, preset?, options, stops}` → 202 `BuildPublic` | Preflight errors → 409 with the checks in `details`; queues `build_plan` |
| GET | `/builds/{id}` | → `BuildPublic` | the UI polls it every 3 s while `planning · building · stopping` |
| PUT | `/builds/{id}/plan` | `{plan}` → `BuildPublic` | only in `planned`; `plan_origin = human` |
| POST | `/builds/{id}/replan` | `{feedback}` → 202 `BuildPublic` | `planned · failed` → `planning` |
| POST | `/builds/{id}/approve` | `{options?, stops?}` → 202 `BuildPublic` | `planned` → `building`; queues `build_run`; may override options and stops one last time |
| POST | `/builds/{id}/stop` | → `BuildPublic` | `building` → `stopping`; the watcher kills the run and pushes what is committed |
| POST | `/builds/{id}/continue` | `{goal?, stops}` → 202 `BuildPublic` | `done · stopped` → `building`, same repo and session (`claude --resume`) |
| DELETE | `/builds/{id}` | → 204 | not while `building · stopping`; leaves the GitHub repo alone |

Mutating routes need the API key. Wrong-state transitions return 409.

User defaults live in `app_settings.data.builds` and come back in `GET /settings` as
`builds: {owner, visibility, claude_attribution, link_paper, max_minutes, max_commits,
max_budget_usd}`. You change them with `PATCH /settings {builds: {...}}`.

Env (`BOOKSHELF_`): `BUILD_WORKSPACE` (`~/.bookshelf/builds`), `GH_BIN` (`gh`), `GIT_BIN`
(`git`), `BUILD_HARD_CAP_MINUTES` (720), `API_BUILD_RUNNER` (true: the API lifespan runs the
build runner).

---

## 5. Backend layout (`backend/app/builds/`)

| Module | Role |
|---|---|
| `context.py` | paper data (`papers/selectors/sets._paper` + explainer) → `PaperBrief`; `paper_sections` (the nine keyed sections, word counts) and `render_paper_md(…, sections)`, citations stripped |
| `context_sections.py` | pure: one renderer per PAPER.md section, and the cite / anchor / `[n]` stripping |
| `references.py` | suggested references (code, data, the paper's pages, cited works, cited papers on the shelf), `docs/REFERENCES.md`, snapshots through an injected fetcher (`services/fetch.py` + trafilatura) |
| `workspace_files.py` | **the one renderer** (B11): `context_files` (the preview: PAPER, REFERENCES, references/, NOTES, LICENSE; snapshots pending) and `seed_files` (the same, snapshots fetched, plus README, PLAN, .gitignore) |
| `licenses.py` | the MIT and Apache-2.0 texts for `advanced.license` |
| `launch.py` | the toolchains, model, effort and branch a run resolves to, and `launch_spec` (argv + kickoff): one function for the runner and the context view |
| `publish.py` | seed, create the GitHub repo (description, topics), first push, the PR branch; `open_pull_request` at the end |
| `context_view.py` | the three context endpoints: preview, the unsaved draft, the rendered or workspace view |
| `agents.py` | loads `agents/<name>/` (meta, AGENT.md, presets.yaml) into `AgentPackage`, `Preset` |
| `toolchains.py` | toolchain → allowed `Bash(…)` patterns; the base allowlist |
| `preflight.py` | the checks, each a small function over injectable `Probe`s (which, run) |
| `github.py` | `GitHub` protocol + `GhCli` (`gh api user`, `gh repo create`, `gh repo view`, `gh repo edit --add-topic`, `gh pr create`) |
| `git.py` | `Git` helper: init, commit (with or without the trailer), log since, branches, push |
| `seed.py` | the README / PLAN / .gitignore renderers; `seed_repo` writes the `seed_files` and makes the first commit `chore: seed from <paper>` |
| `prompting.py` | the kickoff prompt (goal, plan, stops, rules) and the CLI argv |
| `events.py` | pure: stream-json NDJSON line → `BuildEvent` / final result (cost, report JSON) |
| `watch.py` | the watch loop: tail events, sync commits, push, enforce stops, heartbeat |
| `service.py` | create, replan, approve, stop, continue, delete; state machine checks |
| `planning.py` | the `build_plan` handler body: input → `run_structured(plan-build)` → plan |
| `runner.py` | the `build_run` handler body: prepare (`publish`), launch (`launch`), watch, deliver the PR, finish |

Handlers register in `app/pipeline/handlers/builds.py`. Each external effect (gh, git, the
claude process, the clock) sits behind a small seam, so the tests fake them and stay fast.

### The agent run

```
claude -p --model <reason tier> --output-format stream-json --verbose
  --session-id <uuid> (or --resume <uuid> to continue)
  --safe-mode --strict-mcp-config --permission-mode dontAsk --permission-prompts none
  --allowedTools Read Write Edit Glob Grep TodoWrite "Bash(git add:*)" "Bash(git commit:*)" … <toolchain patterns> [WebFetch WebSearch]   (app/builds/toolchains.py)
  --settings '{"includeCoAuthoredBy": <attr>, "attribution": {...}}'
  --append-system-prompt <AGENT.md>
  [--max-budget-usd N]
cwd = <workspace>/repo, stdin = kickoff prompt, stdout → <workspace>/events.ndjson
```

The agent ends with one fenced `json` block, a `BuildReport`. `events.py` takes it from the
final `result` event.

---

## 6. Frontend

- **A `build` tab** in `PAPER_TABS` (`types: []`, readiness "data"), plus a *Build from this
  paper →* call to action at the foot of every paper tab.
- **Islands** (`components/builds/`):
  - `BuildStudio.tsx`: the run list plus the active run.
  - `BuildForm.tsx`: preset cards, goal, *done when* list, limits, repo options; preflight
    shown inline with its fixes.
  - `PlanReview.tsx`: milestones you can edit, Approve, Replan with feedback.
  - `RunView.tsx`: state, a progress bar against each limit, commits linked to GitHub, the
    event tail (full detail in workshop mode), Stop, Continue.
- **Settings → Builds** (`BuildsSection.tsx`): the GitHub owner, default visibility,
  attribution, link to paper, default limits.

---

## 7. Context, references and advanced control

You see **exactly** what the planner and the agent read, choose which of it goes in, add your
own references and notes, and, if you want, take over the knobs the defaults hide.

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| B11 | **What is shown is what is sent** | A preview that drifts from the real input is worse than none | One renderer (`context.py` + `references.py`) feeds both the preview endpoint and the seed; once a workspace exists, `/builds/{id}/context` reads its real files |
| B12 | **Context is sectioned, and each section can be switched off** | Equations or claims can steer a learning build the wrong way; you decide | `options.context.sections`: the keys to keep; `null` keeps them all |
| B13 | **References are snapshotted by the runner, not fetched by the agent** | The agent stays offline (B5) but can still read a blog post or an API page | `snapshot: true` → `services/fetch.py` (trafilatura) at seed time → `docs/references/NN-<slug>.md`; a failed fetch becomes a link-only entry plus a warning event |
| B14 | **Advanced options are opt-in and validated as strictly as the rest** | More control should not mean a weaker sandbox | `extra_commands` become `Bash(<cmd>:*)` and go through `toolchains.FORBIDDEN` |

### Shapes (additions to `BuildOptions`, all optional on input)

```ts
BuildContextOptions { sections: ContextSectionKey[] | null      // null = all
                      notes: string | null }                    // ≤ 8000 chars → docs/NOTES.md
ContextSectionKey = 'tldr' | 'question' | 'core_ideas' | 'how_it_works' | 'equations'
                  | 'setup' | 'results' | 'claims' | 'limitations'

BuildReference { kind: 'url' | 'shelf'
                 url: string | null          // http(s), kind url
                 document_id: uuid | null    // kind shelf: a paper on the shelf → its brief
                 title: string               // ≤ 200
                 note: string | null         // ≤ 500, "why it matters / how to use it"
                 snapshot: boolean }         // url only: fetch and save readable text
// options.references: BuildReference[] (≤ 20)

BuildAdvanced { model: 'auto' | 'haiku' | 'sonnet' | 'opus'     // auto = the agent's tier
                effort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
                plan_model: same as model                        // for the plan-build run
                toolchains: ('python' | 'node' | 'static')[] | null   // null = preset / inferred
                extra_commands: string[]   // ≤ 10, ^[a-z0-9][a-z0-9 ._-]{0,40}$, → Bash(cmd:*)
                instructions: string | null      // ≤ 4000, appended to the kickoff
                commit_style: 'milestone' | 'small'
                tests: 'each_milestone' | 'smoke' | 'none'
                license: 'none' | 'MIT' | 'Apache-2.0'
                delivery: 'push_main' | 'pull_request'   // PR: work on build/<repo>, open a PR at the end
                push: 'each_commit' | 'at_end'
                description: string | null       // GitHub repo description (≤ 350), else the plan summary
                topics: string[] }               // ≤ 10 GitHub topics, ^[a-z0-9][a-z0-9-]{0,49}$
// options.advanced: BuildAdvanced (all defaults: auto, auto, auto, null, [], null, milestone,
// each_milestone, none, push_main, each_commit, null, [])
```

### Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/papers/{ref}/builds/context?link_paper=` | `ContextPreview {sections: [{key, title, markdown, words}], header: string, suggested_references: [{kind, url, document_id, title, source: 'code' \| 'data' \| 'paper' \| 'cited' \| 'shelf'}]}`. The suggestions come from `paper_meta.code_urls` / `data_urls`, the paper's arXiv / DOI links, up to 10 bibliography entries with an arXiv id or DOI (`cited`), and on-shelf papers it cites (`shelf`) |
| POST | `/papers/{ref}/builds/context/render` | body `{options}` (a partial `BuildOptionsInput`) → `BuildContextView` for a build not yet created, the form's live preview |
| GET | `/builds/{id}/context` | `BuildContextView {files: [{path, content, words}], kickoff: string, agent_brief: string, allowed_tools: string[], command: string[], model: string, effort: string, plan_input: object \| null, source: 'workspace' \| 'rendered'}`. `command` is the CLI argv with the brief and prompt elided |

Settings: `builds.advanced` holds the defaults for `model, effort, plan_model, commit_style, tests,
license, delivery, push`.

### Notes on the implementation

- **`pr_url` has no column.** The runner records the PR as a `system` event
  `Pull request: <url>`; `BuildPublic.pr_url` is computed from the last such event. No
  migration, and a PR is opened once: a Continue pushes the branch and does not open another.
- **`ContextFile.pending`** (an addition): a snapshot listed in a preview, fetched only at
  seed time. Its content is a placeholder; if the fetch then fails, the reference stays a link
  and the run gets an `error` event.
- **`POST …/context/render`** also takes optional `goal`, `preset` and `stops` beside
  `options`. It saves nothing, so it needs no API key. Options are filled as a create would
  fill them.
- **Extra commands** are refused when they hit `FORBIDDEN`, when they are or begin a denied
  command (`gh`, `curl`, `rm`, `sudo`, `git push`…), or when they are a prefix of one: `git`
  would allow `git push`. They are checked by the schema (422) and again when the argv is
  built.
- **Shelf references and cited works**: a cited work that is on the shelf is suggested as
  a `shelf` reference, not as its link. A shelf reference must name a paper (422 otherwise).
- **Local builds**: a `pull_request` delivery that comes from the settings falls back to
  `push_main`. One asked for explicitly is a 422.
- **The repo description** is `advanced.description`, else the plan's summary, else the goal,
  cut at 350 characters. `claude_attribution` now defaults to off in `BuildOptions` too.

### UI

- **"What the agent will read"**, a disclosure in the form, closed by default. Its summary line
  reads `Paper brief · 1 840 words · 7 of 9 sections · 3 references · notes`. Open, it shows one
  row per section: a switch, the title, a word count, and an expandable preview. Below that,
  the references editor, then the notes. A **Preview files** button opens the rendered files
  in a tabbed viewer (`docs/PAPER.md`, `docs/REFERENCES.md`, `docs/NOTES.md`, the kickoff,
  the agent brief, the allowed tools).
- **References editor**: one-click chips for the suggestions, *Add a link* (URL, title,
  note, snapshot switch) and *Add from shelf* (searches papers). Without *allow web*, a hint
  says that link-only references are names to the agent, so snapshot them.
- **Advanced**, a second disclosure. Its summary line counts the non-default values
  (`Advanced · 3 changed`); *Reset to defaults* puts them back. Grouped: Model · Tools ·
  Workflow · Repository.
- **The plan review and the run view** show the same viewer, read-only, as a **Context** tab:
  what this build actually received.

## 7b. Plan versions

Replanning or editing never loses a plan. Every plan a build ever had is a numbered version.
You can read, compare and restore any of them while the build is `planned`.

| # | Decision | Rationale | Consequence |
|---|---|---|---|
| B15 | **Plan versions live in their own append-only table** | The same pattern as `paper_syntheses`; a jsonb array on `builds` would grow and could not be queried | `build_plans (build_id, version)`; `builds.plan` stays the *current* plan (a copy), `builds.plan_version` names it |
| B16 | **Restoring points at a version; it does not copy it** | A restore that writes a new version would hide which plan you went back to | `builds.plan_version` moves; the next edit or replan appends `max + 1`, with `based_on` = the version it started from |

```sql
create table build_plans (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid not null references builds on delete cascade,
  version     int  not null check (version >= 1),
  plan        jsonb not null,                 -- BuildPlan
  origin      text not null check (origin in ('skill', 'human')),
  feedback    text,                           -- the replan feedback that produced it
  based_on    int,                            -- the version it revised (null for v1)
  model       text,                           -- for skill drafts: what ran
  created_at  timestamptz not null default now(),
  unique (build_id, version)
);
alter table builds add column plan_version int;
-- backfill: each build with a plan gets v1 (origin = builds.plan_origin), and plan_version = 1. RLS on.
```

Writes: a planner draft (first or replan) and `PUT /plan` each append a version and make it
current. Wire shape: `BuildPlanVersion {version, plan, origin, feedback, based_on, model,
created_at, current: boolean}`. `BuildPublic` gains `plan_version` and `plan_versions_count`.

| Method | Path | Result |
|---|---|---|
| GET | `/builds/{id}/plans` | `BuildPlanVersion[]`, newest first |
| POST | `/builds/{id}/plans/{version}/restore` | `BuildPublic`; only in `planned` (409 otherwise; 404 for an unknown version) |

The build runs, seeds `docs/PLAN.md` from, and shows in Context, the *current* version. The
seeded PLAN.md names it: `Plan v3 (edited by you, from v2)`.

Notes on the implementation (`app/builds/plans.py`, model `BuildPlanRecord`):

- **`based_on` needs no column.** `builds.plan_version` does not move while a build is
  `planning` (edit and restore need `planned`), so the planner records the version current
  when the replan was asked. A first draft, or a retry of a first draft that failed, has
  `based_on` and `feedback` null, exactly when the planner input has no `previous_plan`.
- **Extra checks**: `based_on < version`, `plan_version >= 1`, `feedback` ≤ 4000 chars.
- **Backfill**: a v1 row takes `coalesce(plan_origin, 'skill')`, `created_at` =
  `builds.updated_at` (the best guess at when that plan was written), and `model` null.
- **The count**: `GET /builds/{id}` counts one build's versions; the list uses one grouped
  count for all its rows (`plans.versions_counts`), no N+1. `BuildSummary.of(build,
  plan_versions_count=…)` builds the wire shape.
- **PLAN.md**: the heading sits in italics under `# Plan`; replan feedback is whitespace-
  collapsed and cut at 120 characters (`seed.plan_heading`).

**UI**: in the plan review, a version strip above the plan, e.g. `v1 Drafted · v2 Replanned ·
v3 Edited · current`. Each pill shows its origin, and hovering or focusing it shows the replan
feedback. Picking an older version shows it read-only, with a banner: *Viewing v1 · Use this
version · Back to current*. A **Compare** toggle diffs that version against the current one,
milestone by milestone (added, removed, changed fields marked; matched by position, then by
title), plus the summary, the stack and the out-of-scope list. Once the build has started,
the strip stays as read-only history and marks the version that was built.

## 8. Next (not built yet)

- **Results check**: a `reproduce-results` preset whose report compares measured numbers
  with the paper's `results_table`, row by row.
- **Issues mode**: one GitHub issue per milestone, closed by its commit.
- **Checkpoints**: pause after each milestone for your review before the next.
- **Builds over a paper set**: one repo from several papers (`paper_sets`).
- **Back to the shelf**: approve a build's README as study material; the repo URL joins
  `paper_meta.code_urls` as *yours*.
- **Run telemetry**: each run as a `model_runs` row, so cost per preset is measurable.
