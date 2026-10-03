/**
 * Builds wire shapes (docs/BUILDS.md §3; backend/app/schemas/builds.py). A build turns a
 * paper into a git repository: a plan you approve, then an agent run that commits each
 * milestone. The vocabularies mirror `BuildState`, `StopReason` and the visibility enum.
 */

export const BUILD_STATES = ['planning', 'planned', 'building', 'stopping', 'done', 'stopped', 'failed'] as const;
export type BuildState = (typeof BUILD_STATES)[number];

export const STOP_REASONS = ['goal_reached', 'max_minutes', 'max_commits', 'max_budget', 'user', 'agent_gave_up', 'error'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const BUILD_VISIBILITIES = ['private', 'public', 'local'] as const;
export type BuildVisibility = (typeof BUILD_VISIBILITIES)[number];

/** `BuildOptions`: where the repo goes and how commits read. */
export interface BuildOptions {
  /** `^[A-Za-z0-9._-]{1,100}$`. */
  repo_name: string;
  visibility: BuildVisibility;
  /** Org or user (`^[A-Za-z0-9-]{1,39}$`); null = the `gh` account. */
  owner: string | null;
  /** A Co-Authored-By trailer on the agent's commits. */
  claude_attribution: boolean;
  /** The README names and links the paper. */
  link_paper: boolean;
  /** "PyTorch", "Astro + D3"…; the preset's default. */
  stack: string | null;
  /** WebFetch / WebSearch for the agent. */
  allow_web: boolean;
  /** What of the paper the planner and the agent read, plus your notes (§7). */
  context: BuildContextOptions;
  /** ≤ 20 links or shelf papers, written to `docs/REFERENCES.md`. */
  references: BuildReference[];
  /** The knobs the defaults hide (§7); every field has a default. */
  advanced: BuildAdvanced;
}

/** Options as asked for (`BuildOptionsInput`): anything left out comes from the settings and the preset. */
export type BuildOptionsInput = Partial<BuildOptions>;

/* ── Context, references and advanced control (docs/BUILDS.md §7) ─────────────── */

/** The sections of `docs/PAPER.md`, in the order they appear. */
export const CONTEXT_SECTION_KEYS = ['tldr', 'question', 'core_ideas', 'how_it_works', 'equations', 'setup', 'results', 'claims', 'limitations'] as const;
export type ContextSectionKey = (typeof CONTEXT_SECTION_KEYS)[number];

export const CONTEXT_SECTION_LABELS: Record<ContextSectionKey, string> = {
  tldr: 'TL;DR',
  question: 'The question',
  core_ideas: 'Core ideas',
  how_it_works: 'How it works',
  equations: 'Equations',
  setup: 'Setup',
  results: 'Results',
  claims: 'Claims',
  limitations: 'Limitations',
};

export interface BuildContextOptions {
  /** The section keys to keep; null keeps them all. */
  sections: ContextSectionKey[] | null;
  /** ≤ 8000 characters → `docs/NOTES.md`. */
  notes: string | null;
}

export type BuildReferenceKind = 'url' | 'shelf';

export interface BuildReference {
  kind: BuildReferenceKind;
  /** http(s); kind `url` only. */
  url: string | null;
  /** Kind `shelf`: a paper on the shelf, whose brief the agent gets. */
  document_id: string | null;
  /** ≤ 200. */
  title: string;
  /** ≤ 500: why it matters, how to use it. */
  note: string | null;
  /** Kind `url` only: the runner fetches it and saves the readable text. */
  snapshot: boolean;
}

export const BUILD_MODELS = ['auto', 'haiku', 'sonnet', 'opus'] as const;
/** `auto`: the agent's own tier. */
export type BuildModel = (typeof BUILD_MODELS)[number];

export const BUILD_EFFORTS = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type BuildEffort = (typeof BUILD_EFFORTS)[number];

export const BUILD_TOOLCHAINS = ['python', 'node', 'static'] as const;
export type BuildToolchain = (typeof BUILD_TOOLCHAINS)[number];

export type CommitStyle = 'milestone' | 'small';
export type TestsPolicy = 'each_milestone' | 'smoke' | 'none';
export type BuildLicense = 'none' | 'MIT' | 'Apache-2.0';
/** `pull_request`: work on `build/<repo>` and open a PR at the end. */
export type BuildDelivery = 'push_main' | 'pull_request';
export type PushCadence = 'each_commit' | 'at_end';

export interface BuildAdvanced {
  model: BuildModel;
  effort: BuildEffort;
  /** The model of the plan-build run. */
  plan_model: BuildModel;
  /** null: the preset's, else inferred. */
  toolchains: BuildToolchain[] | null;
  /** ≤ 10, `^[a-z0-9][a-z0-9 ._-]{0,40}$`; each becomes `Bash(<cmd>:*)`. */
  extra_commands: string[];
  /** ≤ 4000, appended to the kickoff. */
  instructions: string | null;
  commit_style: CommitStyle;
  tests: TestsPolicy;
  license: BuildLicense;
  delivery: BuildDelivery;
  push: PushCadence;
  /** The GitHub repo description (≤ 350); null: the plan's summary. */
  description: string | null;
  /** ≤ 10 GitHub topics, `^[a-z0-9][a-z0-9-]{0,49}$`. */
  topics: string[];
}

export const ADVANCED_DEFAULTS: BuildAdvanced = {
  model: 'auto',
  effort: 'auto',
  plan_model: 'auto',
  toolchains: null,
  extra_commands: [],
  instructions: null,
  commit_style: 'milestone',
  tests: 'each_milestone',
  license: 'none',
  delivery: 'push_main',
  push: 'each_commit',
  description: null,
  topics: [],
};

/** The advanced fields your settings hold a default for (`builds.advanced`). */
export const ADVANCED_SETTING_KEYS = ['model', 'effort', 'plan_model', 'commit_style', 'tests', 'license', 'delivery', 'push'] as const;
export type AdvancedDefaults = Pick<BuildAdvanced, (typeof ADVANCED_SETTING_KEYS)[number]>;

export interface ContextSection {
  key: ContextSectionKey;
  title: string;
  markdown: string;
  words: number;
}

/** Where a suggested reference comes from. */
export type ReferenceSource = 'code' | 'data' | 'paper' | 'cited' | 'shelf';

export interface SuggestedReference {
  kind: BuildReferenceKind;
  url: string | null;
  document_id: string | null;
  title: string;
  source: ReferenceSource;
}

/** `GET /papers/{ref}/builds/context`: the paper brief in sections, and references worth adding. */
export interface ContextPreview {
  sections: ContextSection[];
  /** What tops `docs/PAPER.md` (the title, and the link when `link_paper`). */
  header: string;
  suggested_references: SuggestedReference[];
}

export interface ContextFile {
  path: string;
  content: string;
  words: number;
}

/**
 * Exactly what the planner and the agent read: `POST …/context/render` for a build not yet
 * created, `GET /builds/{id}/context` for one that exists (its workspace files once seeded).
 */
export interface BuildContextView {
  files: ContextFile[];
  kickoff: string;
  agent_brief: string;
  allowed_tools: string[];
  /** The CLI argv, the brief and the prompt elided. */
  command: string[];
  model: string;
  effort: string;
  plan_input: Record<string, unknown> | null;
  source: 'workspace' | 'rendered';
}

/** `BuildStops`: the limits the runner enforces, plus the agent's own *done when*. */
export interface BuildStops {
  /** 5..720, default 90. */
  max_minutes: number;
  /** 1..200, default 30. */
  max_commits: number;
  /** 0.5..200; null: no cap. */
  max_budget_usd: number | null;
  /** ≤ 10 lines, each ≤ 300 characters. */
  done_when: string[];
}

export interface BuildMilestone {
  title: string;
  /** A Conventional Commit subject: `feat(model): …`. */
  commit: string;
  deliverable: string;
  done_when: string;
}

export interface BuildLayoutEntry {
  path: string;
  purpose: string;
}

/** `BuildPlan` (skills/plan-build/schema.json). */
export interface BuildPlan {
  summary: string;
  stack: string[];
  repo_name: string;
  /** 3..12. */
  milestones: BuildMilestone[];
  layout: BuildLayoutEntry[];
  out_of_scope: string[];
  risks: string[];
  /** What the planner would ask you; may be empty. */
  questions: string[];
}

/** Who wrote a plan: the planner skill, or you by hand. */
export type PlanOrigin = 'skill' | 'human';

/** `GET /builds/{id}/plans` (§7b), newest first: every plan a build ever had. */
export interface BuildPlanVersion {
  /** 1, 2, 3… in the order they were written. */
  version: number;
  plan: BuildPlan;
  origin: PlanOrigin;
  /** The replan feedback that produced it. */
  feedback: string | null;
  /** The version it revised; null for v1. */
  based_on: number | null;
  /** For a planner draft: the model that ran. */
  model: string | null;
  created_at: string;
  /** The build's plan now (`builds.plan_version`). */
  current: boolean;
}

export type BuildEventKind = 'text' | 'tool' | 'commit' | 'system' | 'error';

export interface BuildEvent {
  at: string;
  kind: BuildEventKind;
  text: string;
}

export interface BuildCommit {
  sha: string;
  subject: string;
  at: string;
}

export type BuildReportStatus = 'goal_reached' | 'partial' | 'gave_up';

/** The agent's final word. */
export interface BuildReport {
  status: BuildReportStatus;
  done: string[];
  not_done: string[];
  next_steps: string[];
  /** How to run what was built (a command or a few lines). */
  run_it: string;
}

/** A list row (`GET /papers/{ref}/builds`): a build without plan, events and report. */
export interface BuildSummary {
  id: string;
  document_id: string;
  agent: string;
  preset: string | null;
  goal: string;
  options: BuildOptions;
  stops: BuildStops;
  plan_origin: PlanOrigin | null;
  plan_feedback: string | null;
  /** The current plan's version (§7b); null before the first plan. */
  plan_version: number | null;
  /** How many plan versions the build has had (0 before the first plan). */
  plan_versions_count: number;
  state: BuildState;
  stop_reason: StopReason | null;
  stop_requested: boolean;
  repo_url: string | null;
  /** The pull request a `pull_request` delivery opened, once it has. */
  pr_url: string | null;
  /** Oldest first. */
  commits: BuildCommit[];
  cost_usd: number | null;
  error: string | null;
  plan_job_id: string | null;
  run_job_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  /** Seconds the run has worked so far (or worked in all, once finished). */
  elapsed_seconds: number | null;
}

/** `GET /builds/{id}`. */
export interface BuildPublic extends BuildSummary {
  plan: BuildPlan | null;
  /** The last 200, oldest first. */
  events: BuildEvent[];
  report: BuildReport | null;
}

/** Stops as asked for (`BuildStopsInput`): a missing or null field is left to the preset, then your settings. */
export type BuildStopsInput = { [K in keyof BuildStops]?: BuildStops[K] | null };

/** `GET /builds/presets`: a starting point for the form. */
export interface BuildPreset {
  key: string;
  label: string;
  description: string;
  goal: string;
  stack: string | null;
  toolchains: string[];
  stops: BuildStopsInput;
}

export interface PreflightCheck {
  key: string;
  ok: boolean;
  level: 'error' | 'warning';
  message: string;
  /** What to do about it (often a command); null when there is nothing to do. */
  fix: string | null;
}

/** `GET /builds/preflight`. `ready`: no failing error. */
export interface Preflight {
  ready: boolean;
  checks: PreflightCheck[];
}

/** `POST /papers/{ref}/builds`. A blank `repo_name` takes the plan's suggestion at approve. */
export interface BuildCreate {
  goal: string;
  preset?: string | null;
  options: BuildOptions;
  stops: BuildStops;
}

/** `POST /builds/{id}/approve`: a last override of options and stops. */
export interface BuildApprove {
  options?: BuildOptions;
  stops?: BuildStops;
}

/** `POST /builds/{id}/continue`. `goal`, when sent, is 10..4000 characters. */
export interface BuildContinue {
  goal?: string;
  stops: BuildStopsInput;
}

/** `GET /settings` → `builds`; `PATCH /settings {builds}`. */
export interface BuildDefaults {
  owner: string | null;
  visibility: BuildVisibility;
  claude_attribution: boolean;
  link_paper: boolean;
  max_minutes: number;
  max_commits: number;
  max_budget_usd: number | null;
  /** Defaults for the advanced options (§7). */
  advanced: AdvancedDefaults;
}
