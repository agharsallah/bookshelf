/**
 * Building into an existing repository (docs/BUILDS.md §7c): where a build lands
 * (`options.target`), the repositories you can pick, and what an inspection of one finds.
 */
import type { BuildToolchain, PreflightCheck } from './builds';

/** `new`: a repository of its own (as before); `github` / `local`: a folder of one you have. */
export const BUILD_TARGET_KINDS = ['new', 'github', 'local'] as const;
export type BuildTargetKind = (typeof BUILD_TARGET_KINDS)[number];

/** What happens when a commit touches a path outside the folder. */
export type ConfineMode = 'warn' | 'stop';

/** `options.target`; absent on a build means kind `new`. */
export interface BuildTarget {
  kind: BuildTargetKind;
  /** github: `owner/name`. */
  repo: string | null;
  /** local: the absolute path to a git repository. */
  path: string | null;
  /** null: the repo's default branch (github) / its current HEAD branch (local). */
  base_branch: string | null;
  /** Relative, no `..`, no leading `/` (`papers/attention`). Required for github and local. */
  folder: string | null;
  /** null: `build/<folder slug>`. */
  branch: string | null;
  /** Read the repo's CLAUDE.md / AGENTS.md into the kickoff. */
  use_repo_instructions: boolean;
  confine: ConfineMode;
  /** local only: also push the branch to `origin`. */
  push_branch: boolean;
}

/** `GET /builds/repos?q=`: a repository you (or your orgs) have, from `gh repo list`. */
export interface RepoChoice {
  full_name: string;
  description: string | null;
  /** As `gh` says it: `PUBLIC`, `PRIVATE`, `INTERNAL`. */
  visibility: string;
  default_branch: string;
  updated_at: string;
  /** WRITE, MAINTAIN or ADMIN: a build can push there. */
  can_push: boolean;
}

export interface RepoInstructionFile {
  path: string;
  text: string;
}

/** What the planner and the agent are told about the repository (B20). */
export interface RepoSurvey {
  /** The tree to depth 2, at most 200 entries, paths relative to the root (`src`, `src/app.py`). */
  tree: string[];
  /** Detected stack markers: `pyproject.toml`, `package.json`… */
  stack: string[];
  readme: string | null;
  /** The repo's own CLAUDE.md / AGENTS.md. */
  instructions: RepoInstructionFile[];
  toolchains: BuildToolchain[];
}

/** `POST /builds/target/inspect`: the same checks preflight runs, plus what the form fills from. */
export interface TargetInspection {
  ok: boolean;
  problems: PreflightCheck[];
  default_branch: string | null;
  branches: string[];
  folder_exists: boolean;
  folder_empty: boolean;
  /** null when the repository could not be read. */
  survey: RepoSurvey | null;
}
